import type { FastifyPluginAsync } from 'fastify';
import { acmeChallengeTokens } from '../services/acme.js';

/**
 * HTTP-01 ACME challenge endpoint (feature 005 Option B — per-project certs).
 *
 * Let's Encrypt issues per-project certs for db.<ref>.<apex> via HTTP-01:
 *   1. api opens an ACME order, gets a challenge token + keyAuth
 *   2. api stores token → keyAuth in `acmeChallengeTokens` (in-memory map)
 *   3. LE hits http://db.<ref>.<apex>/.well-known/acme-challenge/<token>
 *      Caddy forwards this to api:3001 (caddy-config + Caddyfile route)
 *   4. This route looks up the token, returns the keyAuth as text/plain
 *   5. LE validates, returns the cert
 *
 * Registered at root (NOT under /api/v1) so the path matches what LE expects.
 */
export const acmeChallengeRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { token: string } }>(
    '/.well-known/acme-challenge/:token',
    async (req, reply) => {
      const entry = acmeChallengeTokens.get(req.params.token);
      if (!entry || entry.expiresAt < Date.now()) {
        return reply.status(404).type('text/plain').send('not found');
      }
      return reply.type('text/plain').send(entry.keyAuth);
    },
  );
};
