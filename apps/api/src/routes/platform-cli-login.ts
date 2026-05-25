/**
 * CLI-facing polling endpoint for the device-code login flow (feature 011).
 *
 *   GET /platform/cli/login/:session_id?device_code=<8hex>
 *
 * NO authentication. Security comes from:
 *   - session_id is a UUID v4 (~122 bits of entropy, unguessable)
 *   - device_code is a per-session 32-bit secret
 *   - 5-minute TTL on the Redis bundle
 *
 * Response on match: 200 with { id, created_at, access_token, public_key, nonce }
 * matching the upstream CLI's AccessTokenResponse Go struct.
 *
 * On ANY failure (unknown session, malformed input, mismatched device_code,
 * TTL-expired): returns 404 with a uniform body to prevent enumeration
 * (SC-007). The body MUST be byte-identical across all failure modes.
 *
 * Single-use: matching response triggers Redis DEL.
 *
 * Spec: specs/011-cli-device-login/contracts/polling-endpoint.md
 */

import type { FastifyPluginAsync } from 'fastify';
import { getAndConsume } from '../services/cli-login-store.js';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const DEVICE_CODE_RE = /^[0-9a-f]{8}$/;
const NOT_FOUND_BODY = { message: 'session not found' } as const;

export const platformCliLoginRoutes: FastifyPluginAsync = async (app) => {
  app.get<{
    Params: { session_id: string };
    Querystring: { device_code?: string };
  }>('/platform/cli/login/:session_id', async (req, reply) => {
    const sessionId = req.params.session_id;
    const deviceCode = req.query.device_code ?? '';

    // Validate inputs. On ANY validation failure, return the SAME 404 body
    // as a true miss — no enumeration leak. We still go through the Redis
    // lookup unconditionally to avoid timing side-channels.
    const sessionIdValid = UUID_RE.test(sessionId);
    const deviceCodeValid = DEVICE_CODE_RE.test(deviceCode);

    let payload: Awaited<ReturnType<typeof getAndConsume>> = null;
    if (sessionIdValid && deviceCodeValid) {
      payload = await getAndConsume(sessionId, deviceCode);
    } else {
      // Unconditional Redis touch to keep timing roughly uniform.
      // We use a known-invalid UUID so we never accidentally match.
      await getAndConsume('00000000-0000-0000-0000-000000000000', '00000000').catch(() => null);
    }

    if (!payload) {
      return reply.status(404).send(NOT_FOUND_BODY);
    }

    return reply.status(200).send({
      id: sessionId,
      created_at: payload.created_at,
      access_token: payload.access_token,
      public_key: payload.public_key,
      nonce: payload.nonce,
    });
  });
};
