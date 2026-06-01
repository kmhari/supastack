/**
 * Secrets endpoints — per-project runtime env management.
 *
 *   GET    /v1/projects/:ref/secrets    — list (name + redacted sha256)
 *   POST   /v1/projects/:ref/secrets    — bulk set (array of {name, value})
 *   DELETE /v1/projects/:ref/secrets    — bulk delete (array of names)
 *
 * Spec: contracts/management-api.yaml, FR-015..FR-020.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { SecretSetBodySchema } from '@supastack/shared';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { deleteSecrets, listSecrets, setSecrets } from '../../services/secret-store.js';

const DeleteBodySchema = z.array(z.string());

export const secretsRoutes: FastifyPluginAsync = async (app) => {
  async function ensureProject(
    req: Parameters<NonNullable<typeof app.requireAuth>>[0],
    ref: string,
  ): Promise<string> {
    const user = app.requireAuth(req);
    const row = await getProjectByRef(user.id, ref);
    if (!row) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
    }
    return user.id;
  }

  app.get<{ Params: { ref: string } }>('/projects/:ref/secrets', async (req) => {
    await ensureProject(req, req.params.ref);
    return listSecrets(req.params.ref);
  });

  app.post<{ Params: { ref: string } }>('/projects/:ref/secrets', async (req, reply) => {
    const userId = await ensureProject(req, req.params.ref);
    const body = SecretSetBodySchema.parse(req.body);
    await setSecrets(req.params.ref, body, { userId });
    return reply.status(201).send({ message: 'All secrets stored' });
  });

  app.delete<{ Params: { ref: string } }>('/projects/:ref/secrets', async (req, reply) => {
    const userId = await ensureProject(req, req.params.ref);
    const body = DeleteBodySchema.parse(req.body);
    await deleteSecrets(req.params.ref, body, { userId });
    return reply.status(200).send({ message: 'Secrets removed' });
  });
};
