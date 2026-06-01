/**
 * Dashboard MCP-clients management — feature 014 US3.
 *
 * GET    /api/v1/oauth/clients              — list operator's authorized clients
 * DELETE /api/v1/oauth/clients/:client_id   — revoke ALL grants for (operator, client)
 *
 * Auth: existing session cookie OR PAT (NOT OAuth JWT — revocation must not
 * be self-issuable by a client trying to invalidate other clients' grants;
 * the dashboard surface requires session/PAT).
 *
 * Spec: 014-mcp-http-oauth — FR-020, FR-021, FR-021a, SC-004.
 */
import type { FastifyPluginAsync } from 'fastify';
import { Redis } from 'ioredis';
import { and, desc, eq, sql } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { errors, logger } from '@supastack/shared';
import { revoke as revokeJti } from '@supastack/oauth';

interface ClientListRow {
  client_id: string;
  client_name: string;
  authorized_at: string;
  last_used_at: string;
  scope: string;
}

// Per-process Redis client. Reuses the same REDIS_URL the auth plugin uses.
let redisSingleton: Redis | null = null;
function getRedis(): Redis {
  if (!redisSingleton) {
    redisSingleton = new Redis(process.env.REDIS_URL ?? 'redis://redis:6379');
  }
  return redisSingleton;
}

export const oauthClientsDashboardRoutes: FastifyPluginAsync = async (app) => {
  // List authorized clients for the current operator
  app.get('/api/v1/oauth/clients', async (req) => {
    const user = app.requireAuth(req);

    // Join oauth_refresh_tokens (active grants) with oauth_clients (display
    // metadata). Operators see only their own (user_id = self).
    const rows = await db()
      .select({
        clientId: schema.oauthClients.id,
        clientName: schema.oauthClients.clientName,
        scope: schema.oauthRefreshTokens.scope,
        issuedAt: schema.oauthRefreshTokens.issuedAt,
        lastUsedAt: schema.oauthRefreshTokens.lastUsedAt,
      })
      .from(schema.oauthRefreshTokens)
      .innerJoin(
        schema.oauthClients,
        eq(schema.oauthClients.id, schema.oauthRefreshTokens.clientId),
      )
      .where(
        and(
          eq(schema.oauthRefreshTokens.userId, user.id),
          sql`${schema.oauthRefreshTokens.revokedAt} IS NULL`,
        ),
      )
      .orderBy(desc(schema.oauthRefreshTokens.lastUsedAt));

    // Collapse multiple grants for the same (operator, client) into one row,
    // showing the most-recent timestamps + the union of granted scopes.
    const byClient = new Map<
      string,
      { name: string; firstIssued: Date; lastUsed: Date; scopes: Set<string> }
    >();
    for (const r of rows) {
      const e = byClient.get(r.clientId);
      if (!e) {
        byClient.set(r.clientId, {
          name: r.clientName,
          firstIssued: r.issuedAt,
          lastUsed: r.lastUsedAt,
          scopes: new Set([r.scope]),
        });
      } else {
        if (r.issuedAt < e.firstIssued) e.firstIssued = r.issuedAt;
        if (r.lastUsedAt > e.lastUsed) e.lastUsed = r.lastUsedAt;
        e.scopes.add(r.scope);
      }
    }

    const out: ClientListRow[] = [];
    for (const [client_id, agg] of byClient) {
      out.push({
        client_id,
        client_name: agg.name,
        authorized_at: agg.firstIssued.toISOString(),
        last_used_at: agg.lastUsed.toISOString(),
        scope: [...agg.scopes].sort().join(' '),
      });
    }
    return out;
  });

  // Revoke ALL grants for the operator's (self, client) pair.
  app.delete<{ Params: { client_id: string } }>('/api/v1/oauth/clients/:client_id', async (req) => {
    const user = app.requireAuth(req);
    const clientId = req.params.client_id;

    // Find live refresh tokens for this (operator, client). We don't have
    // access tokens DB-side (they're JWTs); but we know their jtis from the
    // most recent oauth.token.issued / oauth.token.refreshed audit entries.
    // For v1: capture every audit-recorded jti for this (user, client) and
    // blacklist them in Redis. Older tokens are likely expired anyway (1h
    // TTL); the natural-expiry path handles the rest.
    const refreshRows = await db()
      .select({ token: schema.oauthRefreshTokens.token })
      .from(schema.oauthRefreshTokens)
      .where(
        and(
          eq(schema.oauthRefreshTokens.userId, user.id),
          eq(schema.oauthRefreshTokens.clientId, clientId),
        ),
      );

    if (refreshRows.length === 0) {
      // Nothing to revoke — either already revoked, or no grant exists.
      // Still a clean success (idempotent).
      return { revoked: 0 };
    }

    // Look up the most recent access-token jtis from audit for this
    // (operator, client) pair so we can blacklist them in Redis with TTL
    // matching their remaining lifetime (1h max).
    const recentTokenAudit = await db()
      .select({
        payload: schema.auditLog.payload,
        createdAt: schema.auditLog.createdAt,
      })
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.actorUserId, user.id),
          eq(schema.auditLog.targetId, clientId),
          sql`${schema.auditLog.action} IN ('oauth.token.issued', 'oauth.token.refreshed')`,
          sql`${schema.auditLog.createdAt} > now() - interval '1 hour'`,
        ),
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(50);

    const redis = getRedis();
    const now = Date.now();
    const oneHourMs = 60 * 60 * 1000;
    let blacklistedJtis = 0;
    for (const row of recentTokenAudit) {
      const payload = row.payload as Record<string, unknown> | null;
      const jti = payload?.jti as string | undefined;
      if (!jti) continue;
      // TTL = remaining lifetime of the access token. Audit row's created_at
      // is approximately the token's iat; access tokens live 1h. Compute
      // remaining seconds; floor at 1 (revoke for at least 1s).
      const ageMs = now - row.createdAt.getTime();
      const remainingSec = Math.max(1, Math.floor((oneHourMs - ageMs) / 1000));
      if (remainingSec > 0) {
        await revokeJti(redis, jti, remainingSec);
        blacklistedJtis++;
      }
    }

    // Delete all refresh tokens for this (operator, client). Captured count
    // is the deleted-grants count returned to the dashboard.
    const deleted = await db()
      .delete(schema.oauthRefreshTokens)
      .where(
        and(
          eq(schema.oauthRefreshTokens.userId, user.id),
          eq(schema.oauthRefreshTokens.clientId, clientId),
        ),
      )
      .returning({ token: schema.oauthRefreshTokens.token });

    // Audit
    try {
      await db()
        .insert(schema.auditLog)
        .values({
          actorUserId: user.id,
          action: 'oauth.token.revoked',
          targetKind: 'oauth_client',
          targetId: clientId,
          payload: {
            client_id: clientId,
            deleted_refresh_count: deleted.length,
            blacklisted_jti_count: blacklistedJtis,
            reason: 'operator_action',
          },
        });
    } catch (err) {
      logger.warn({ err }, 'oauth.token.revoked audit emit failed');
    }

    return { revoked: deleted.length, blacklisted_jtis: blacklistedJtis };
  });
};

// Suppress unused import for `errors` if it ever stops being referenced
void errors;
