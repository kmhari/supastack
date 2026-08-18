/**
 * Migrations endpoints — `supabase migration list/repair/fetch` (feature 006 US2).
 *
 *   GET    /v1/projects/:ref/database/migrations
 *   PUT    /v1/projects/:ref/database/migrations
 *   POST   /v1/projects/:ref/database/migrations/upsert
 *   GET    /v1/projects/:ref/database/migrations/:version
 *   PATCH  /v1/projects/:ref/database/migrations/:version
 *   DELETE /v1/projects/:ref/database/migrations/:version
 *
 * The GET/PATCH pair on :version is upstream's contract for that path
 * (`v1-get-a-migration` / `v1-patch-a-migration`). We previously served only
 * DELETE there, so a spec-conformant CLI or MCP client fell through to the 501
 * catch-all on the two verbs upstream actually defines.
 *
 * PUT on the collection is upstream's `v1-upsert-a-migration`. Our own
 * `POST …/upsert` predates it and takes a different body — an explicit
 * `{version, statements[]}` rather than an opaque `{query}` the server stamps a
 * version for — so the two are not aliases and both are served. Upstream's POST
 * (`v1-apply-a-migration`, which EXECUTES the query) and DELETE
 * (`v1-rollback-migrations`) on this path remain deliberate 501s.
 *
 * Reads + writes the `supabase_migrations.schema_migrations` table on the
 * per-project Postgres via the shared `per-instance-pg.ts` helper.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import {
  deleteMigration,
  getMigration,
  listMigrations,
  MigrationVersionCollisionError,
  patchMigration,
  putMigration,
  upsertMigration,
  VERSION_REGEX,
} from '../../services/migrations-service.js';
import {
  InstanceNotFoundError,
  InstanceNotRunningError,
  PerInstancePgConnectError,
} from '../../services/per-instance-pg.js';

const VersionSchema = z.string().regex(VERSION_REGEX, 'version must match ^\\d{14}$');

const UpsertBody = z.object({
  version: VersionSchema,
  name: z.string().nullable().optional(),
  statements: z.array(z.string()).nullable().optional(),
});

// Upstream's V1PatchMigrationBody. `.strict()` so a typo'd field is a 400 rather
// than a silent no-op that leaves the caller believing the rename landed.
const PatchBody = z
  .object({
    name: z.string().nullable().optional(),
    rollback: z.string().nullable().optional(),
  })
  .strict();

// Upstream's V1UpsertMigrationBody. Deliberately NOT `.strict()`: upstream does
// not set additionalProperties:false, so rejecting a field a newer client sends
// would break a client the real API accepts.
const PutBody = z.object({
  query: z.string().min(1),
  name: z.string().nullable().optional(),
  rollback: z.string().nullable().optional(),
});

function mapPgError(err: unknown): never {
  if (err instanceof MigrationVersionCollisionError) {
    throw new ManagementApiError(409, err.message, 'migration_version_collision');
  }
  if (err instanceof InstanceNotFoundError) {
    throw new ManagementApiError(404, err.message, 'not_found');
  }
  if (err instanceof InstanceNotRunningError) {
    throw new ManagementApiError(409, err.message, 'project_not_running', { status: err.status });
  }
  if (err instanceof PerInstancePgConnectError) {
    throw new ManagementApiError(502, err.message, 'per_instance_pg_connect_error');
  }
  throw err;
}

export const migrationsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/database/migrations', async (req) => {
    const user = app.requireAuth(req);
    const proj = await getProjectByRef(user.id, req.params.ref);
    if (!proj)
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    await app.authorizeOrg(req, 'instance.read', proj.orgId); // SEC-003
    try {
      const migrations = await listMigrations(req.params.ref);
      return { migrations };
    } catch (err) {
      mapPgError(err);
    }
  });

  app.put<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/migrations',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj)
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      await app.authorizeOrg(req, 'database.write', proj.orgId); // SEC-003
      const parsed = PutBody.safeParse(req.body);
      if (!parsed.success) {
        throw new ManagementApiError(400, 'invalid request body', 'invalid_request', {
          issues: parsed.error.issues,
        });
      }
      // Node collapses duplicate request headers into one comma-joined string, so
      // the array arm is unreachable in practice and only satisfies the type.
      // An EMPTY header is not: it must normalise to null, or the first caller
      // stores '' as their key and the unique index rejects everyone else's.
      const rawKey = req.headers['idempotency-key'];
      const idempotencyKey = (Array.isArray(rawKey) ? rawKey[0] : rawKey)?.trim() || null;
      try {
        const row = await putMigration(req.params.ref, {
          ...parsed.data,
          idempotencyKey,
          createdBy: user.email ?? user.id,
        });
        return reply.status(200).send(row);
      } catch (err) {
        mapPgError(err);
      }
    },
  );

  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/migrations/upsert',
    async (req, reply) => {
      const user = app.requireAuth(req);
      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj)
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      await app.authorizeOrg(req, 'database.write', proj.orgId); // SEC-003
      const parsed = UpsertBody.safeParse(req.body);
      if (!parsed.success) {
        const versionIssue = parsed.error.issues.find((i) => i.path[0] === 'version');
        throw new ManagementApiError(
          400,
          versionIssue?.message ?? 'invalid request body',
          versionIssue ? 'invalid_version_format' : 'invalid_request',
          { issues: parsed.error.issues },
        );
      }
      try {
        const row = await upsertMigration(req.params.ref, parsed.data);
        return reply.status(200).send(row);
      } catch (err) {
        mapPgError(err);
      }
    },
  );

  // Shared preamble for the :version routes — resolve, authorize, validate the
  // version. Kept as one helper so GET and PATCH cannot drift apart on which
  // action they authorize.
  const resolveVersionRoute = async (
    req: Parameters<typeof app.requireAuth>[0] & { params: { ref: string; version: string } },
    action: 'instance.read' | 'database.write',
  ): Promise<string> => {
    const user = app.requireAuth(req);
    const proj = await getProjectByRef(user.id, req.params.ref);
    if (!proj)
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    await app.authorizeOrg(req, action, proj.orgId);
    const versionParse = VersionSchema.safeParse(req.params.version);
    if (!versionParse.success) {
      throw new ManagementApiError(
        400,
        versionParse.error.issues[0]!.message,
        'invalid_version_format',
        { received: req.params.version },
      );
    }
    return versionParse.data;
  };

  app.get<{ Params: { ref: string; version: string } }>(
    '/projects/:ref/database/migrations/:version',
    async (req) => {
      const version = await resolveVersionRoute(req, 'instance.read');
      try {
        const row = await getMigration(req.params.ref, version);
        if (!row) {
          throw new ManagementApiError(404, 'Migration not found', 'not_found', { version });
        }
        return row;
      } catch (err) {
        if (err instanceof ManagementApiError) throw err;
        mapPgError(err);
      }
    },
  );

  app.patch<{ Params: { ref: string; version: string }; Body: unknown }>(
    '/projects/:ref/database/migrations/:version',
    async (req) => {
      const version = await resolveVersionRoute(req, 'database.write');
      const parsed = PatchBody.safeParse(req.body ?? {});
      if (!parsed.success) {
        throw new ManagementApiError(400, 'invalid request body', 'invalid_request', {
          issues: parsed.error.issues,
        });
      }
      try {
        const row = await patchMigration(req.params.ref, version, parsed.data);
        if (!row) {
          throw new ManagementApiError(404, 'Migration not found', 'not_found', { version });
        }
        return row;
      } catch (err) {
        if (err instanceof ManagementApiError) throw err;
        mapPgError(err);
      }
    },
  );

  app.delete<{ Params: { ref: string; version: string } }>(
    '/projects/:ref/database/migrations/:version',
    async (req) => {
      const user = app.requireAuth(req);
      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj)
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      await app.authorizeOrg(req, 'database.write', proj.orgId); // SEC-003
      const versionParse = VersionSchema.safeParse(req.params.version);
      if (!versionParse.success) {
        throw new ManagementApiError(
          400,
          versionParse.error.issues[0]!.message,
          'invalid_version_format',
          {
            received: req.params.version,
          },
        );
      }
      try {
        return await deleteMigration(req.params.ref, versionParse.data);
      } catch (err) {
        mapPgError(err);
      }
    },
  );
};
