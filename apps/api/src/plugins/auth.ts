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

declare module 'fastify' {
  interface FastifyRequest {
    user?: { id: string; email: string; role: Role };
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
  // COOKIE_SECURE controls the `Secure` attribute on the session cookie.
  // It MUST be false while the dashboard is being driven over plain HTTP
  // (fresh install, bare-IP access before DNS/cert are set up) — otherwise
  // the browser stores the cookie but never sends it back and every
  // authenticated request 401s. Once an apex + HTTPS cert are in place,
  // the operator flips this to 1 and restarts the api.
  const cookieSecure = process.env.COOKIE_SECURE === '1' || process.env.COOKIE_SECURE === 'true';
  await app.register(fastifySession, {
    secret: sessionSecret,
    cookieName: 'sb_sid',
    cookie: { httpOnly: true, sameSite: 'lax', secure: cookieSecure },
    saveUninitialized: false,
    store: new RedisStore({ client: redis, prefix: 'selfbase:sess:' }),
  });

  app.addHook('preHandler', async (req: FastifyRequest, _reply: FastifyReply) => {
    // 1. Bearer token
    const auth = req.headers.authorization;
    if (auth?.startsWith('Bearer ')) {
      const raw = auth.slice('Bearer '.length).trim();
      const sha = sha256(raw);
      const rows = await db()
        .select({
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
        req.user = { id: rows[0].userId, email: rows[0].email, role: rows[0].role as Role };
        // Best-effort last_used_at update — fire-and-forget
        await db()
          .update(schema.apiTokens)
          .set({ lastUsedAt: new Date() })
          .where(eq(schema.apiTokens.tokenSha256, sha));
        return;
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
