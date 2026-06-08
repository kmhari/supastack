import fastifyCookie from '@fastify/cookie';
import { loadMasterKey, verifyGotrueJwt } from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import {
  ExpiredTokenError,
  InvalidAudienceError,
  InvalidIssuerError,
  InvalidSignatureError,
  isRevoked,
  MalformedTokenError,
  verifyAccessToken,
} from '@supastack/oauth';
import { errors, type Role } from '@supastack/shared';
import { and, eq, isNull } from 'drizzle-orm';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';
import { Redis } from 'ioredis';
import { createHash } from 'node:crypto';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      /**
       * Feature 084 — transitional "primary" role: the caller's HIGHEST role
       * across all their organizations. Org-scoped checks resolve the role in a
       * specific org via `authorize(req, action, orgId)`; this default keeps the
       * existing (not-yet-org-scoped) call sites working until US5.
       */
      role: Role;
      /** UUID of the `api_tokens` row, IFF auth came from a Bearer PAT. */
      tokenId?: string;
      /** `oauth_clients` row id, IFF the credential was an OAuth 2.1 access token. */
      oauthClientId?: string;
      /** JWT `jti`, IFF authenticated via an OAuth access token. */
      oauthJti?: string;
    };
  }
}

const ROLE_RANK: Record<Role, number> = {
  read_only: 0,
  developer: 1,
  administrator: 2,
  owner: 3,
};

/**
 * Resolve a user's transitional global role = the highest role they hold across
 * any organization. Zero-org users get `read_only` (they can still create an org
 * — that action is allowed for every role).
 */
async function resolveRole(userId: string): Promise<Role> {
  const rows = await db()
    .select({ role: schema.organizationMembers.role })
    .from(schema.organizationMembers)
    .where(eq(schema.organizationMembers.userId, userId));
  let best: Role = 'read_only';
  let bestRank = -1;
  for (const r of rows) {
    const rank = ROLE_RANK[r.role as Role] ?? -1;
    if (rank > bestRank) {
      bestRank = rank;
      best = r.role as Role;
    }
  }
  return best;
}

export const authPlugin: FastifyPluginAsync = fp(async function authPlugin(app) {
  const redisUrl = process.env.REDIS_URL!;
  await app.register(fastifyCookie);
  const redis = new Redis(redisUrl);

  // Feature 014 — OAuth 2.1 JWT bearer support (issuer/audience from apex).
  const apex = process.env.SUPASTACK_APEX;
  const oauthIssuer = apex ? `https://api.${apex}` : null;
  const oauthAudience = apex ? `https://mcp.${apex}/mcp` : null;

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    const auth = req.headers.authorization;
    if (!auth?.startsWith('Bearer ')) return;
    const raw = auth.slice('Bearer '.length).trim();

    // 1. PAT (sbp_) — primary machine credential (CLI / Management API).
    if (raw.startsWith('sbp_')) {
      const sha = sha256(raw);
      const rows = await db()
        .select({
          tokenId: schema.apiTokens.id,
          userId: schema.apiTokens.userId,
          email: schema.users.email,
        })
        .from(schema.apiTokens)
        .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
        .where(and(eq(schema.apiTokens.tokenSha256, sha), isNull(schema.apiTokens.revokedAt)))
        .limit(1);
      if (rows[0]) {
        req.user = {
          id: rows[0].userId,
          email: rows[0].email,
          role: await resolveRole(rows[0].userId),
          tokenId: rows[0].tokenId,
        };
        await db()
          .update(schema.apiTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiTokens.tokenSha256, sha));
      }
      return;
    }

    if (raw.split('.').length !== 3) return;

    // 2. OAuth 2.1 access JWT (feature 014 — MCP).
    if (oauthIssuer && oauthAudience) {
      try {
        const claims = verifyAccessToken({
          masterKey: loadMasterKey(),
          token: raw,
          expectedIss: oauthIssuer,
          expectedAud: oauthAudience,
        });
        if (await isRevoked(redis, claims.jti)) return;
        const u = await db()
          .select({ id: schema.users.id, email: schema.users.email })
          .from(schema.users)
          .where(eq(schema.users.id, claims.sub))
          .limit(1);
        if (u[0]) {
          req.user = {
            id: u[0].id,
            email: u[0].email,
            role: await resolveRole(u[0].id),
            oauthClientId: claims.azp,
            oauthJti: claims.jti,
          };
        }
        return;
      } catch (err) {
        // Not an OAuth token (wrong iss/aud/sig) → fall through to GoTrue.
        if (
          !(err instanceof ExpiredTokenError) &&
          !(err instanceof InvalidSignatureError) &&
          !(err instanceof InvalidIssuerError) &&
          !(err instanceof InvalidAudienceError) &&
          !(err instanceof MalformedTokenError)
        ) {
          throw err;
        }
      }
    }

    // 3. GoTrue access JWT (feature 084 — the dashboard human credential).
    try {
      const claims = verifyGotrueJwt(loadMasterKey(), raw);
      const u = await db()
        .select({ id: schema.users.id, email: schema.users.email })
        .from(schema.users)
        .where(eq(schema.users.id, claims.sub))
        .limit(1);
      if (u[0]) {
        req.user = { id: u[0].id, email: u[0].email, role: await resolveRole(u[0].id) };
      }
    } catch {
      // Invalid GoTrue JWT → no user set → 401 via requireAuth.
    }
  });

  app.decorate('requireAuth', function requireAuth(req: FastifyRequest): NonNullable<
    FastifyRequest['user']
  > {
    if (!req.user) throw errors.unauthenticated();
    return req.user;
  });
});

export function sha256(s: string): Buffer {
  return createHash('sha256').update(s, 'utf8').digest();
}

declare module 'fastify' {
  interface FastifyInstance {
    requireAuth(req: FastifyRequest): NonNullable<FastifyRequest['user']>;
  }
}
