import type { FastifyPluginAsync } from 'fastify';
import { reloadCaddy } from '../services/caddy-reload.js';

/**
 * Internal endpoint the worker hits to trigger a Caddy reload. Bound to the
 * Docker internal network only (sibling of /internal/tls/ask). No auth.
 */
export const caddyInternalRoutes: FastifyPluginAsync = async (app) => {
  app.post('/internal/caddy/reload', async (_req, reply) => {
    try {
      await reloadCaddy();
      return reply.status(204).send();
    } catch (err) {
      app.log.warn({ err }, 'caddy reload via internal endpoint failed');
      return reply
        .status(503)
        .send({ error: { code: 'internal', message: 'caddy reload failed' } });
    }
  });
};
