/**
 * GET /v1/projects + GET /v1/projects/:ref
 *
 * Spec: contracts/management-api.yaml. The CLI calls list during
 * `supabase projects list` and `supabase link` (to pick a ref interactively),
 * and the per-ref endpoint to verify a ref before persisting the link.
 */
import type { FastifyPluginAsync } from 'fastify';
import type { Project } from '@selfbase/shared';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef, listProjectsForUser } from '../../services/project-store.js';
import { instanceToProject } from '../../services/mgmt-api-mapping.js';

export const projectsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/projects', async (req): Promise<Project[]> => {
    const user = app.requireAuth(req);
    const rows = await listProjectsForUser(user.id);
    return rows.map(instanceToProject);
  });

  app.get<{ Params: { ref: string } }>('/projects/:ref', async (req): Promise<Project> => {
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row) {
      // 404 for both "doesn't exist" and "exists but not accessible" — avoids
      // leaking project existence across org boundaries.
      throw new ManagementApiError(404, 'Project not found', 'not_found', {
        ref: req.params.ref,
      });
    }
    return instanceToProject(row);
  });
};
