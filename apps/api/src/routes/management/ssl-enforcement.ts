/**
 * SSL enforcement endpoints — GET/PUT /v1/projects/:ref/ssl-enforcement.
 *
 * Powers step 4 of `supabase config push` (CLI ≥ v2.72).
 *
 * Feature 026 — supabase config push compat.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { getSslEnforcement, putSslEnforcement } from '../../services/ssl-enforcement-store.js';

const SslEnforcementRequestSchema = z.object({
  requestedConfig: z.object({ database: z.boolean() }),
});

export const sslEnforcementRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/ssl-enforcement', async (req) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'database_config.read');
    const inst = await getProjectByRef(user.id, req.params.ref);
    if (!inst) throw new ManagementApiError(404, 'Project not found', 'not_found', {});
    return getSslEnforcement(req.params.ref);
  });

  app.put<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/ssl-enforcement',
    async (req) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'database_config.write');
      const inst = await getProjectByRef(user.id, req.params.ref);
      if (!inst) throw new ManagementApiError(404, 'Project not found', 'not_found', {});

      const parsed = SslEnforcementRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ManagementApiError(400, 'Validation failed', 'validation_failed', {
          requestedConfig: 'required object with database boolean',
        });
      }

      return putSslEnforcement(req.params.ref, parsed.data.requestedConfig.database);
    },
  );
};
