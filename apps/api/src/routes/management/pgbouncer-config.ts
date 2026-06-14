/**
 * PgBouncer config endpoints:
 *   GET  /v1/projects/:ref/config/database/pgbouncer
 *   PATCH /v1/projects/:ref/config/database/pooler
 *
 * Store-only surface: no .env write, no container restart (deferred-apply
 * posture — applying config to the running Supavisor/pgbouncer process is
 * out of scope). Config is persisted in project_config_snapshots with
 * defaults fallback.
 *
 * Spec: specs/112-fix-proxy-config/spec.md FR-007, FR-008.
 */
import type { FastifyPluginAsync } from 'fastify';
import { PgbouncerConfigPatchSchema } from '@supastack/shared';
import { ZodError } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getConfig, saveConfigOnly } from '../../services/runtime-config-store.js';

export const pgbouncerConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/config/database/pgbouncer', async (req) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'data_api_config.read');
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', {
        ref: req.params.ref,
      });
    }
    return getConfig(req.params.ref, 'pgbouncer');
  });

  app.patch<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/config/database/pooler',
    async (req) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'data_api_config.write');
      const inst = await getProjectByRef(user.id, req.params.ref);
      if (!inst) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      }
      let parsed: Record<string, unknown>;
      try {
        parsed = PgbouncerConfigPatchSchema.parse(req.body ?? {}) as Record<string, unknown>;
      } catch (err) {
        if (err instanceof ZodError) {
          const details: Record<string, string> = {};
          for (const issue of err.issues) {
            const key = issue.path.join('.') || '_root';
            details[key] = issue.message;
          }
          throw new ManagementApiError(400, 'Validation failed', 'validation_failed', details);
        }
        throw err;
      }
      return saveConfigOnly(req.params.ref, 'pgbouncer', parsed, user.id);
    },
  );
};
