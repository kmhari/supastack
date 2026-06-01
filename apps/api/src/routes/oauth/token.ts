/**
 * POST /v1/oauth/token — OAuth 2.1 token endpoint.
 *
 * Handles both grant types:
 *   - authorization_code (with PKCE verification)
 *   - refresh_token      (with rotation + reuse-detection)
 *
 * Issues JWT access tokens via @supastack/oauth; rotates opaque refresh
 * tokens via oauth-refresh-store. RFC 6749 §5.2 error envelope.
 *
 * Spec: 014-mcp-http-oauth — FR-004, FR-008, FR-009,
 *   contracts/oauth-token-endpoint.md.
 */
import { loadMasterKey } from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import { signAccessToken } from '@supastack/oauth';
import { logger, OAuthTokenRequestSchema } from '@supastack/shared';
import type { FastifyPluginAsync } from 'fastify';

import { consumeCode } from '../../services/oauth-codes-store.js';
import { verifyChallenge } from '../../services/oauth-pkce.js';
import { issueRefresh, rotateRefresh } from '../../services/oauth-refresh-store.js';

const ACCESS_TOKEN_TTL_SEC = 3600; // 1 hour (matches Cloud gotrue defaults)

export const oauthTokenRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: unknown }>('/oauth/token', async (req, reply) => {
    // RFC 6749 — token endpoint MUST accept x-www-form-urlencoded. Fastify
    // body parser handles JSON by default; for content-type:
    // application/x-www-form-urlencoded we expect Fastify's formbody plugin
    // OR the client sends JSON. Both are common; spec-compliant clients send
    // form-urlencoded but the MCP SDK uses JSON. We accept both via Zod.
    const parsed = OAuthTokenRequestSchema.safeParse(req.body);
    if (!parsed.success) {
      reply.header('Cache-Control', 'no-store');
      return reply.status(400).send({
        error: 'invalid_request',
        error_description: parsed.error.issues[0]?.message ?? 'malformed body',
      });
    }
    const body = parsed.data;

    const apex = process.env.SUPASTACK_APEX;
    if (!apex) {
      return reply
        .status(503)
        .send({ error: 'server_error', error_description: 'apex not configured' });
    }
    const iss = `https://api.${apex}`;
    const aud = `https://mcp.${apex}/mcp`;

    if (body.grant_type === 'authorization_code') {
      const consumed = await consumeCode(body.code, body.redirect_uri, body.client_id);
      if (!consumed.ok) {
        return reply.status(400).send({
          error: 'invalid_grant',
          error_description: `authorization_code ${consumed.error}`,
        });
      }
      // PKCE verify
      if (!verifyChallenge(body.code_verifier, consumed.codeChallenge)) {
        return reply
          .status(400)
          .send({ error: 'invalid_grant', error_description: 'PKCE verification failed' });
      }

      const { token, jti } = signAccessToken({
        masterKey: loadMasterKey(),
        sub: consumed.userId,
        azp: body.client_id,
        aud,
        scope: consumed.scope,
        iss,
        ttlSec: ACCESS_TOKEN_TTL_SEC,
      });
      const refresh = await issueRefresh({
        clientId: body.client_id,
        userId: consumed.userId,
        scope: consumed.scope,
      });

      void emitAudit(consumed.userId, body.client_id, 'oauth.token.issued', {
        client_id: body.client_id,
        scope: consumed.scope,
        jti,
        expires_in: ACCESS_TOKEN_TTL_SEC,
      });

      reply.header('Cache-Control', 'no-store');
      return reply.status(200).send({
        access_token: token,
        token_type: 'Bearer',
        expires_in: ACCESS_TOKEN_TTL_SEC,
        refresh_token: refresh,
        scope: consumed.scope,
      });
    }

    // grant_type === 'refresh_token'
    const result = await rotateRefresh(body.refresh_token, body.client_id);
    if (!result.ok) {
      return reply
        .status(400)
        .send({ error: 'invalid_grant', error_description: `refresh ${result.error}` });
    }
    const { token, jti } = signAccessToken({
      masterKey: loadMasterKey(),
      sub: result.userId,
      azp: body.client_id,
      aud,
      scope: result.scope,
      iss,
      ttlSec: ACCESS_TOKEN_TTL_SEC,
    });
    void emitAudit(result.userId, body.client_id, 'oauth.token.refreshed', {
      client_id: body.client_id,
      jti,
    });
    reply.header('Cache-Control', 'no-store');
    return reply.status(200).send({
      access_token: token,
      token_type: 'Bearer',
      expires_in: ACCESS_TOKEN_TTL_SEC,
      refresh_token: result.newToken,
      scope: result.scope,
    });
  });
};

async function emitAudit(
  userId: string,
  clientId: string,
  action: 'oauth.token.issued' | 'oauth.token.refreshed',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db().insert(schema.auditLog).values({
      actorUserId: userId,
      action,
      targetKind: 'oauth_client',
      targetId: clientId,
      payload,
    });
  } catch (err) {
    logger.warn({ err, action }, 'oauth token audit emit failed');
  }
}
