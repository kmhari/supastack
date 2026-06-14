/**
 * Realtime config endpoints — GET/PATCH /v1/projects/:ref/config/realtime.
 *
 * Store-only surface: no .env write, no container restart (deferred-apply
 * posture matching postgrest config). Config is persisted in
 * project_config_snapshots and returned on GET with defaults fallback.
 *
 * Spec: specs/112-fix-proxy-config/spec.md FR-003, FR-004.
 */
import type { FastifyPluginAsync } from 'fastify';
import { RealtimeConfigPatchSchema } from '@supastack/shared';
import { ZodError } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getConfig, saveConfigOnly } from '../../services/runtime-config-store.js';

export const realtimeConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/config/realtime', async (req) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'data_api_config.read');
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', {
        ref: req.params.ref,
      });
    }
    return getConfig(req.params.ref, 'realtime');
  });

  app.patch<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/config/realtime',
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
        parsed = RealtimeConfigPatchSchema.parse(req.body ?? {}) as Record<string, unknown>;
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
      return saveConfigOnly(req.params.ref, 'realtime', parsed, user.id);
    },
  );
};
