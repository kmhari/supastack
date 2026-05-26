/**
 * POST /v1/oauth/register — RFC 7591 Dynamic Client Registration.
 *
 * Per-IP rate-limited (10/hour) to prevent registration floods. Returns 201
 * with a fresh client_id; no client_secret (public clients only — auth via
 * PKCE only).
 *
 * Spec: 014-mcp-http-oauth — FR-005, contracts/oauth-register-endpoint.md.
 */
import type { FastifyPluginAsync } from 'fastify';
import { db, schema } from '@selfbase/db';
import { OAuthRegisterRequestSchema } from '@selfbase/shared';
import { logger } from '@selfbase/shared';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { registerClient } from '../../services/oauth-clients-store.js';
import { tryConsume } from '../../services/oauth-register-bucket.js';

const RATE_LIMIT = 10;
const WINDOW_MS = 60 * 60 * 1000; // 1 hour

export const oauthRegisterRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>('/oauth/register', async (req, reply) => {
    // Rate limit by source IP
    const ip = req.ip ?? 'unknown';
    const consumeRes = tryConsume(ip, RATE_LIMIT, WINDOW_MS);
    if (!consumeRes.allowed) {
      reply.header('Retry-After', String(consumeRes.retryAfterSeconds));
      throw new ManagementApiError(429, 'registration rate limit exceeded', 'rate_limited', {
        retry_after_seconds: consumeRes.retryAfterSeconds,
      });
    }

    const parsed = OAuthRegisterRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ManagementApiError(
        400,
        parsed.error.issues[0]?.message ?? 'invalid client metadata',
        'invalid_client_metadata',
        { issues: parsed.error.issues },
      );
    }
    const body = parsed.data;

    const client = await registerClient({
      clientName: body.client_name,
      redirectUris: body.redirect_uris,
      metadata: {
        ...(body.logo_uri ? { logo_uri: body.logo_uri } : {}),
        ...(body.tos_uri ? { tos_uri: body.tos_uri } : {}),
        ...(body.policy_uri ? { policy_uri: body.policy_uri } : {}),
      },
      createdByIp: ip,
    });

    // Audit
    try {
      await db()
        .insert(schema.auditLog)
        .values({
          action: 'oauth.client.registered',
          targetKind: 'oauth_client',
          targetId: client.id,
          payload: {
            client_id: client.id,
            client_name: client.clientName,
            redirect_uris: client.redirectUris,
            requesting_ip: ip,
          },
        });
    } catch (err) {
      logger.warn({ err }, 'oauth.client.registered audit emit failed');
    }

    return reply.status(201).send({
      client_id: client.id,
      client_name: client.clientName,
      redirect_uris: client.redirectUris,
      token_endpoint_auth_method: 'none',
      grant_types: body.grant_types ?? ['authorization_code', 'refresh_token'],
      response_types: body.response_types ?? ['code'],
      client_id_issued_at: Math.floor(client.createdAt.getTime() / 1000),
    });
  });
};
