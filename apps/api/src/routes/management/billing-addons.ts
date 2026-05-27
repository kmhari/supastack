/**
 * Billing addons stub — `GET /v1/projects/:ref/billing/addons`.
 *
 * selfbase has no addon concept. Returns an honest empty response so
 * `supabase config push` (CLI ≥ v2.72) doesn't bomb at step 1 with a 501.
 *
 * Upstream shape: { available_addons: Addon[], selected_addons: Addon[] }
 * Ref: https://api.supabase.com/api/v1-json (GET /v1/projects/{ref}/billing/addons)
 */
import type { FastifyPluginAsync } from 'fastify';
import { getProjectByRef } from '../../services/project-store.js';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';

export const billingAddonsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/billing/addons', async (req) => {
    const user = app.requireAuth(req);
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', {
        ref: req.params.ref,
      });
    }
    return { available_addons: [], selected_addons: [] };
  });
};
