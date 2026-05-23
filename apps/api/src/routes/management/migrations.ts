/**
 * Migrations endpoints — `supabase migration list/repair/fetch` (feature 006 US2).
 *
 *   GET    /v1/projects/:ref/database/migrations
 *   POST   /v1/projects/:ref/database/migrations/upsert
 *   DELETE /v1/projects/:ref/database/migrations/:version
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
  listMigrations,
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

async function ensureProject<T extends { ref: string }>(
  app: Parameters<FastifyPluginAsync>[0],
  req: Parameters<Parameters<FastifyPluginAsync>[0]['get']>[1] extends infer F
    ? F extends (req: infer R, ...rest: unknown[]) => unknown
      ? R
      : never
    : never,
  ref: string,
): Promise<void> {
  const user = app.requireAuth(req);
  const proj = await getProjectByRef(user.id, ref);
  if (!proj) {
    throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
  }
}

function mapPgError(err: unknown): never {
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
  app.get<{ Params: { ref: string } }>(
    '/projects/:ref/database/migrations',
    async (req) => {
      const user = app.requireAuth(req);
      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
      try {
        const migrations = await listMigrations(req.params.ref);
        return { migrations };
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
      if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
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

  app.delete<{ Params: { ref: string; version: string } }>(
    '/projects/:ref/database/migrations/:version',
    async (req) => {
      const user = app.requireAuth(req);
      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
      const versionParse = VersionSchema.safeParse(req.params.version);
      if (!versionParse.success) {
        throw new ManagementApiError(400, versionParse.error.issues[0]!.message, 'invalid_version_format', {
          received: req.params.version,
        });
      }
      try {
        return await deleteMigration(req.params.ref, versionParse.data);
      } catch (err) {
        mapPgError(err);
      }
    },
  );
};
