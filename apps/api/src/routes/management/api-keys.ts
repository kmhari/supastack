/**
 * GET /v1/projects/:ref/api-keys — per-instance anon + service_role JWTs.
 *
 * Spec: contracts/management-api.yaml `operationId: listApiKeys`.
 * Decrypts the instance's encryptedSecrets blob to surface the legacy
 * HS256-signed anon and service_role keys. The CLI calls this for
 * `supabase projects api-keys` and during a few link-time flows.
 */
import type { FastifyPluginAsync } from 'fastify';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import type { ApiKey } from '@supastack/shared';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { instanceApiKeys } from '../../services/mgmt-api-mapping.js';
import type { InstanceSecrets } from '../../services/instance-secrets.js';

export const apiKeysRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>(
    '/projects/:ref/api-keys',
    async (req): Promise<ApiKey[]> => {
      const user = app.requireAuth(req);
      const row = await getProjectByRef(user.id, req.params.ref);
      if (!row) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      }
      const secrets = decryptJson<InstanceSecrets>(row.encryptedSecrets, loadMasterKey());
      return instanceApiKeys(secrets);
    },
  );

  app.delete<{ Params: { ref: string; id: string } }>(
    '/projects/:ref/api-keys/:id',
    async (req) => {
      const user = app.requireAuth(req);
      const row = await getProjectByRef(user.id, req.params.ref);
      if (!row)
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      throw new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id });
    },
  );

  app.patch<{ Params: { ref: string; id: string } }>('/projects/:ref/api-keys/:id', async (req) => {
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, req.params.ref);
    if (!row)
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    throw new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id });
  });
};
