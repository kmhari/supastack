/**
 * Dashboard-internal mint endpoint for the CLI device-code login flow (feature 011).
 *
 *   POST /api/v1/cli/login
 *
 * Auth: session cookie required. Any role that can create a PAT may use this
 * (member or admin) — reuses the existing token-create permission semantics
 * (no explicit RBAC action needed; mint goes through the same `mintApiToken`
 * service the manual flow uses).
 *
 * On success:
 *   - 200 { device_code: <8 lowercase hex> }
 *   - A new api_tokens row with source='cli' (revocable from /settings/tokens)
 *   - A Redis bundle at selfbase:cli-login:<session_id> (TTL 300s)
 *
 * On replay (session_id reused): 409 session_in_use
 * On validation failure:        422 invalid_params
 * On no session:                401 unauthenticated (handled by the dashboard
 *                               wrapper before this point in normal flow)
 *
 * Spec: specs/011-cli-device-login/contracts/dashboard-mint-endpoint.md
 */

import type { FastifyPluginAsync } from 'fastify';
import { db } from '@supastack/db';
import { CliLoginMintRequestSchema } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';
import {
  encryptForClient,
  generateDeviceCode,
  validateClientPublicKey,
} from '../services/cli-login-crypto.js';
import { putSession, sessionExists } from '../services/cli-login-store.js';

export const cliLoginRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/cli/login', async (req, reply) => {
    const user = app.requireAuth(req);

    const parsed = CliLoginMintRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      const firstIssue = parsed.error.issues[0];
      const field = firstIssue?.path[0]?.toString() ?? 'unknown';
      return reply.status(422).send({
        error: {
          code: 'invalid_params',
          message: `Invalid ${field}`,
          details: { field },
        },
      });
    }

    const { session_id, token_name, public_key } = parsed.data;

    // Deeper public-key validation (curve point check).
    const pk = validateClientPublicKey(public_key);
    if (!pk.valid) {
      return reply.status(422).send({
        error: {
          code: 'invalid_params',
          message: `Invalid public_key: ${pk.reason}`,
          details: { field: 'public_key' },
        },
      });
    }

    // Replay check — single-use enforcement.
    if (await sessionExists(session_id)) {
      return reply.status(409).send({
        error: {
          code: 'session_in_use',
          message:
            'This CLI login session has already been used. Re-run `supabase login` in your terminal to get a fresh one.',
        },
      });
    }

    // Mint the PAT (source='cli') and encrypt it for the client.
    const { raw: patPlaintext } = await mintApiToken(db(), user.id, token_name, 'cli');
    const { accessTokenHex, publicKeyHex, nonceHex } = encryptForClient(patPlaintext, public_key);
    const device_code = generateDeviceCode();

    await putSession(session_id, {
      device_code,
      access_token: accessTokenHex,
      public_key: publicKeyHex,
      nonce: nonceHex,
      created_at: new Date().toISOString(),
      user_id: user.id,
    });

    return reply.status(200).send({ device_code });
  });
};
