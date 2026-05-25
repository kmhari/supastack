/**
 * Postgrest config endpoints — `GET/PATCH /v1/projects/:ref/postgrest`.
 *
 * Powers `supabase postgres-config get/update` (feature 009 US2).
 *
 * Spec: specs/009-runtime-config-tunables/spec.md FR-001, FR-002, FR-008.
 * Contract: specs/009-runtime-config-tunables/contracts/postgrest-config.md
 */
import type { FastifyPluginAsync } from 'fastify';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getConfig, patchConfig } from '../../services/runtime-config-store.js';

export const postgrestConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>(
    '/projects/:ref/postgrest',
    async (req) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'data_api_config.read');
      const inst = await getProjectByRef(user.id, req.params.ref);
      if (!inst) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      }
      return getConfig(req.params.ref, 'postgrest');
    },
  );

  app.patch<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/postgrest',
    async (req) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'data_api_config.write');
      const inst = await getProjectByRef(user.id, req.params.ref);
      if (!inst) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      }
      if (inst.status !== 'running') {
        throw new ManagementApiError(
          409,
          `Project ${req.params.ref} is ${inst.status}; runtime config can only be updated while running.`,
          'project_not_running',
          { ref: req.params.ref, status: inst.status },
        );
      }
      return patchConfig(req.params.ref, 'postgrest', req.body ?? {}, { userId: user.id });
    },
  );
};
