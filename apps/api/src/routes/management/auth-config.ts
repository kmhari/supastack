/**
 * Auth config endpoints — `GET/PATCH /v1/projects/:ref/config/auth`.
 *
 * Powers `supabase config get/update --auth-*` (feature 009 US1).
 *
 * Spec: specs/009-runtime-config-tunables/spec.md FR-003, FR-004, FR-008.
 * Contract: specs/009-runtime-config-tunables/contracts/auth-config.md
 */
import type { FastifyPluginAsync } from 'fastify';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getConfig, patchConfig } from '../../services/runtime-config-store.js';

export const authConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/config/auth', async (req) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'auth_config.read');
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', {
        ref: req.params.ref,
      });
    }
    // GET is served from the persisted snapshot (or defaults). Project
    // state is informational only — paused projects still return their
    // last-known config (spec edge case).
    return getConfig(req.params.ref, 'auth');
  });

  app.patch<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/config/auth',
    async (req) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'auth_config.write');
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
      return patchConfig(req.params.ref, 'auth', req.body ?? {}, { userId: user.id });
    },
  );
};
