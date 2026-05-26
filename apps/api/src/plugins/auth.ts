import { createHash } from 'node:crypto';
import { and, eq, isNull } from 'drizzle-orm';
import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import fastifyCookie from '@fastify/cookie';
import fastifySession from '@fastify/session';
import { Redis } from 'ioredis';
import RedisStore from 'connect-redis';
import { db, schema } from '@selfbase/db';
import { errors, type Role } from '@selfbase/shared';
import { loadMasterKey } from '@selfbase/crypto';
import {
  verifyAccessToken,
  isRevoked,
  ExpiredTokenError,
  InvalidSignatureError,
  InvalidIssuerError,
  InvalidAudienceError,
  MalformedTokenError,
} from '@selfbase/oauth';

declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      role: Role;
      /**
       * UUID of the `api_tokens` row that authenticated this request, IFF
       * authentication came from a Bearer PAT. Undefined for session-cookie
       * auth (no PAT involved). Currently used by feature 012 for per-PAT
       * rate-limit keying + audit logging of `cli/login-role` rotations.
       */
      tokenId?: string;
      /**
       * UUID of the `oauth_clients` row whose JWT bearer authenticated this
       * request, IFF the credential was an OAuth 2.1 access token. Undefined
       * for PAT or session-cookie auth. Used by feature 014 for revoke
       * targeting + audit logging.
       */
      oauthClientId?: string;
      /**
       * JWT `jti` claim — set IFF this request was authenticated via an
       * OAuth access token. Used to revoke this specific token without
       * affecting other tokens issued under the same (user, client) grant.
       */
      oauthJti?: string;
    };
  }
  interface Session {
    userId?: string;
  }
}

export const authPlugin: FastifyPluginAsync = fp(async function authPlugin(app) {
  const redisUrl = process.env.REDIS_URL!;
  const sessionSecret = process.env.SESSION_SECRET!;

  await app.register(fastifyCookie);
  const redis = new Redis(redisUrl);
  // Cookie `Secure` is set per-request based on the inbound protocol
  // (`X-Forwarded-Proto` from Caddy → Fastify `req.protocol`; `trustProxy: true`
  // in server.ts honors the header). HTTP requests get a non-secure cookie
  // (covers the fresh-install setup wizard before HTTPS is wired); HTTPS
  // requests get `Secure`. Eliminates the chicken-and-egg with COOKIE_SECURE=1
  // during initial setup, no operator env flip needed.
  //
  // `COOKIE_SECURE` env is still honored as an override: if set to '1' it
  // forces Secure unconditionally (useful behind a TLS-terminating proxy
  // that doesn't set X-Forwarded-Proto). If set to '0' it forces non-secure
  // (escape hatch for dev). Unset → 'auto'.
  const cookieSecureEnv = process.env.COOKIE_SECURE;
  const cookieSecure: boolean | 'auto' =
    cookieSecureEnv === '1' || cookieSecureEnv === 'true'
      ? true
      : cookieSecureEnv === '0' || cookieSecureEnv === 'false'
        ? false
        : 'auto';
  await app.register(fastifySession, {
    secret: sessionSecret,
    cookieName: 'sb_sid',
    cookie: { httpOnly: true, sameSite: 'lax', secure: cookieSecure },
    saveUninitialized: false,
    store: new RedisStore({ client: redis, prefix: 'selfbase:sess:' }),
  });

  // Feature 014 — OAuth 2.1 JWT bearer support. Lazily resolved so tests
  // without OAuth env vars don't error at plugin load time.
  const apex = process.env.SELFBASE_APEX;
  const oauthIssuer = apex ? `https://api.${apex}` : null;
  const oauthAudience = apex ? `https://mcp.${apex}/mcp` : null;

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    // 1. Bearer token — try PAT first (sbp_ prefix), then OAuth JWT
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const raw = auth.slice('Bearer '.length).trim();

      // 1a. PAT path (legacy, still primary credential)
      if (raw.startsWith('sbp_')) {
        const sha = sha256(raw);
        const rows = await db()
          .select({
            tokenId: schema.apiTokens.id,
            userId: schema.apiTokens.userId,
            email: schema.users.email,
            role: schema.orgMembers.role,
          })
          .from(schema.apiTokens)
          .innerJoin(schema.users, eq(schema.users.id, schema.apiTokens.userId))
          .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.apiTokens.userId))
          .where(and(eq(schema.apiTokens.tokenSha256, sha), isNull(schema.apiTokens.revokedAt)))
          .limit(1);
        if (rows[0]) {
          req.user = {
            id: rows[0].userId,
            email: rows[0].email,
            role: rows[0].role as Role,
            tokenId: rows[0].tokenId,
          };
          // Best-effort last_used_at update — fire-and-forget
          await db()
            .update(schema.apiTokens)
            .set({ lastUsedAt: new Date() })
            .where(eq(schema.apiTokens.tokenSha256, sha));
          return;
        }
      } else if (oauthIssuer && oauthAudience && raw.split('.').length === 3) {
        // 1b. OAuth JWT path (feature 014)
        try {
          const claims = verifyAccessToken({
            masterKey: loadMasterKey(),
            token: raw,
            expectedIss: oauthIssuer,
            expectedAud: oauthAudience,
          });
          // Redis revocation check — SC-004 (<5s propagation)
          if (await isRevoked(redis, claims.jti)) {
            return; // 401 via requireAuth (no user set)
          }
          // FR-010a: re-resolve user status on every JWT request — covers SC-007
          // (removed-user revocation propagates within one request)
          const rows = await db()
            .select({
              userId: schema.users.id,
              email: schema.users.email,
              role: schema.orgMembers.role,
            })
            .from(schema.users)
            .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
            .where(eq(schema.users.id, claims.sub))
            .limit(1);
          if (rows[0]) {
            req.user = {
              id: rows[0].userId,
              email: rows[0].email,
              role: rows[0].role as Role,
              oauthClientId: claims.azp,
              oauthJti: claims.jti,
            };
            return;
          }
          // sub claim references a user no longer in org_members → reject (FR-010a)
        } catch (err) {
          // Expected verification failures: silently fall through to session
          // cookie path / no-auth state. The 401 emerges from requireAuth().
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
    }
    // 2. Session cookie
    if (req.session?.userId) {
      const rows = await db()
        .select({
          userId: schema.users.id,
          email: schema.users.email,
          role: schema.orgMembers.role,
        })
        .from(schema.users)
        .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
        .where(eq(schema.users.id, req.session.userId))
        .limit(1);
      if (rows[0]) {
        req.user = { id: rows[0].userId, email: rows[0].email, role: rows[0].role as Role };
      }
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
