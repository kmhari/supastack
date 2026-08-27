/**
 * Migrations endpoints — `supabase migration list/repair/fetch` (feature 006 US2).
 *
 *   GET    /v1/projects/:ref/database/migrations
 *   POST   /v1/projects/:ref/database/migrations
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
 * POST and PUT on the collection are upstream's `v1-apply-a-migration` and
 * `v1-upsert-a-migration`. They take the same body; POST executes the query and
 * records it, PUT only records it. POST is what the official Supabase MCP
 * server's `apply_migration` tool calls, so without it that tool 501s against a
 * self-hosted deployment.
 *
 * Our own `POST …/upsert` predates both and takes a different body — an explicit
 * `{version, statements[]}` rather than an opaque `{query}` the server stamps a
 * version for — so it is not an alias for either and all three are served.
 * Upstream's DELETE (`v1-rollback-migrations`) remains a deliberate 501: it
 * executes stored rollback scripts, and no client we know of calls it.
 *
 * Neither Supabase CLI reaches any of these — both the Go CLI and the TypeScript
 * rewrite read and write `supabase_migrations.schema_migrations` over direct
 * Postgres. Verified against supabase/cli at 2.101.0.
 *
 * Reads + writes the `supabase_migrations.schema_migrations` table on the
 * per-project Postgres via the shared `per-instance-pg.ts` helper.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { db, schema } from '@supastack/db';
import {
  applyMigration,
  deleteMigration,
  getMigration,
  listMigrations,
  MigrationVersionCollisionError,
  patchMigration,
  putMigration,
  upsertMigration,
  VERSION_REGEX,
  type MigrationWrite,
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

// Upstream's V1UpsertMigrationBody and V1CreateMigrationBody are the same three
// fields, so POST and PUT share one schema. Deliberately NOT `.strict()`:
// upstream does not set additionalProperties:false, so rejecting a field a newer
// client sends would break a client the real API accepts.
const WriteBody = z.object({
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

/**
 * `mapPgError`, plus the case only the applying POST has: the operator's own SQL
 * failed. That is a 400 carrying Postgres' SQLSTATE, severity, position and
 * hint — the same envelope POST …/database/query returns — because a 500 would
 * read as "our bug" for what is a syntax error in the submitted migration.
 */
function mapSqlError(err: unknown): never {
  const pgErr = err as {
    message?: string;
    code?: string;
    severity?: string;
    position?: string;
    hint?: string;
    detail?: string;
  } | null;
  if (pgErr && typeof pgErr.code === 'string' && /^[0-9A-Z]{5}$/.test(pgErr.code)) {
    throw new ManagementApiError(400, pgErr.message ?? 'postgres error', 'pg_error', {
      severity: pgErr.severity,
      code: pgErr.code,
      position: pgErr.position,
      hint: pgErr.hint,
      detail: pgErr.detail,
    });
  }
  mapPgError(err);
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

  // Shared preamble for POST and PUT on the collection — same auth, same RBAC,
  // same body, same header. Kept as one helper so the two cannot drift into
  // accepting different shapes for what upstream declares as one body.
  const resolveWrite = async (
    req: Parameters<typeof app.requireAuth>[0] & { params: { ref: string }; body?: unknown },
  ): Promise<MigrationWrite & { userId: string }> => {
    const user = app.requireAuth(req);
    const proj = await getProjectByRef(user.id, req.params.ref);
    if (!proj)
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    await app.authorizeOrg(req, 'database.write', proj.orgId); // SEC-003
    const parsed = WriteBody.safeParse(req.body);
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
    return {
      ...parsed.data,
      idempotencyKey,
      createdBy: user.email ?? user.id,
      userId: user.id,
    };
  };

  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/migrations',
    async (req, reply) => {
      const { userId, ...input } = await resolveWrite(req);
      const startedAt = Date.now();
      // Deferred through a promise so a synchronous failure in `db()` lands in
      // the catch too: an unavailable audit log must never be the reason a
      // migration that already committed reports as failed.
      const audit = (action: string, payload: Record<string, unknown>): void => {
        void Promise.resolve()
          .then(() =>
            db()
              .insert(schema.auditLog)
              .values({
                actorUserId: userId,
                action,
                targetKind: 'instance',
                targetId: req.params.ref,
                payload: {
                  ref: req.params.ref,
                  query: input.query,
                  name: input.name ?? null,
                  duration_ms: Date.now() - startedAt,
                  ...payload,
                },
              }),
          )
          .catch((err) => req.log.warn({ err, ref: req.params.ref }, 'migration audit failed'));
      };

      try {
        const row = await applyMigration(req.params.ref, input);
        audit('instance.db.migration.applied', { version: row.version });
        return reply.status(200).send(row);
      } catch (err) {
        audit('instance.db.migration.failed', {
          error_message: (err as Error).message ?? 'unknown',
        });
        mapSqlError(err);
      }
    },
  );

  app.put<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/migrations',
    async (req, reply) => {
      const { userId: _userId, ...input } = await resolveWrite(req);
      try {
        const row = await putMigration(req.params.ref, input);
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
