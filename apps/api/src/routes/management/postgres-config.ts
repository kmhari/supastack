/**
 * Postgres config endpoints — GET/PUT /v1/projects/:ref/config/database/postgres.
 *
 * Powers step 3 of `supabase config push` (CLI ≥ v2.72). The upstream CLI
 * uses PUT (not PATCH); both are registered so curl + dashboard calls work.
 *
 * Feature 026 — supabase config push compat.
 */
import type { FastifyPluginAsync } from 'fastify';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getPostgresConfig, putPostgresConfig } from '../../services/postgres-config-store.js';

export const postgresConfigRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/config/database/postgres', async (req) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'database_config.read');
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) throw new ManagementApiError(404, 'Project not found', 'not_found', {});
    return getPostgresConfig(req.params.ref);
  });

  const putHandler = async (
    req: import('fastify').FastifyRequest<{ Params: { ref: string }; Body: unknown }>,
  ) => {
    const user = app.requireAuth(req);
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) throw new ManagementApiError(404, 'Project not found', 'not_found', {});
    await app.authorizeOrg(req, 'database_config.write', inst.orgId); // SEC-002: org-scoped role
    return putPostgresConfig(req.params.ref, req.body, { userId: user.id });
  };

  app.put<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/config/database/postgres',
    putHandler,
  );
  // Also accept PATCH for curl / dashboard convenience
  app.patch<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/config/database/postgres',
    putHandler,
  );
};
