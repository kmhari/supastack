/**
 * GoTrue-compatible shim for Supabase Studio IS_PLATFORM=true.
 *
 * Studio sets NEXT_PUBLIC_GOTRUE_URL=https://<apex>/api/v1 and sends all
 * auth calls to that base URL. This plugin implements the minimal GoTrue
 * surface needed for Studio to sign in, get user info, and sign out.
 *
 * Auth flow:
 *   1. POST /token?grant_type=password  — validate email+password, issue a
 *      Studio session JWT (HS256, HKDF-derived key). Studio decodes the JWT
 *      client-side to read user claims. All subsequent API calls send it as
 *      Authorization: Bearer <jwt>. requireAuth verifies it via the studio
 *      JWT path in auth.ts.
 *   2. GET  /user      — requireAuth (accepts studio JWT), return GoTrue user.
 *   3. POST /logout    — no-op (JWT expiry is the revocation mechanism).
 *   4. GET  /settings  — stub GoTrue settings (captcha off).
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { loadMasterKey, verifyPassword } from '@supastack/crypto';
import { errors } from '@supastack/shared';
import { signStudioJwt, verifyStudioJwt } from '../plugins/auth.js';

function issueStudioJwt(userId: string, email: string, role: string, iss: string): string {
  return signStudioJwt(loadMasterKey(), {
    sub: userId,
    email,
    supastack_role: role,
    aud: 'authenticated',
    iss,
  });
}

export const studioGotrueRoutes: FastifyPluginAsync = async (app) => {
  // ── Settings — must respond before sign-in form renders ──────────────────
  // captcha.enabled=false so Studio skips HCaptcha and sends the request directly.
  app.get('/settings', async (_req, reply) => {
    return reply.send({
      external: {
        email: true,
        phone: false,
        apple: false, azure: false, bitbucket: false, discord: false,
        facebook: false, figma: false, github: false, gitlab: false,
        google: false, keycloak: false, linkedin: false, notion: false,
        slack: false, spotify: false, twitch: false, twitter: false,
        workos: false, zoom: false,
      },
      disable_signup: true,
      autoconfirm: true,
      mailer_autoconfirm: true,
      phone_autoconfirm: true,
      sms_provider: '',
      mfa_enabled: false,
      saml_enabled: false,
      captcha: { enabled: false, provider: '' },
      security: { captcha: { enabled: false, provider: '' } },
    });
  });

  // ── Password grant — mint a session PAT and return GoTrue-shaped response ─
  app.post<{ Querystring: { grant_type?: string } }>('/token', async (req, reply) => {
    const grantType = req.query.grant_type ?? (req.body as Record<string, unknown>)?.grant_type;

    const apex = process.env.SUPASTACK_APEX ?? 'localhost';
    const iss = `https://${apex}`;

    if (grantType === 'refresh_token') {
      // Studio tries to refresh on page reload. Verify the refresh_token as a
      // studio session JWT and re-issue a fresh one.
      const body = req.body as Record<string, unknown>;
      const refreshToken = body?.refresh_token as string | undefined;
      if (!refreshToken) throw errors.unauthenticated('missing refresh_token');

      let claims: ReturnType<typeof verifyStudioJwt>;
      try {
        claims = verifyStudioJwt(loadMasterKey(), refreshToken, iss);
      } catch {
        throw errors.unauthenticated('invalid or expired refresh_token');
      }

      const [user] = await db()
        .select({ email: schema.users.email, role: schema.orgMembers.role })
        .from(schema.users)
        .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
        .where(eq(schema.users.id, claims.sub))
        .limit(1);
      if (!user) throw errors.unauthenticated('user not found');

      const newJwt = issueStudioJwt(claims.sub, user.email, user.role, iss);
      return reply.send(buildTokenResponse(newJwt, newJwt, claims.sub, user.email, user.role));
    }

    // password grant
    if (grantType !== 'password') {
      throw errors.unauthenticated(`unsupported grant_type: ${grantType}`);
    }

    const body = req.body as Record<string, unknown>;
    const email = body?.email as string | undefined;
    const password = body?.password as string | undefined;

    if (!email || !password) throw errors.unauthenticated('missing email or password');

    const [row] = await db()
      .select({
        id: schema.users.id,
        hash: schema.users.hashedPassword,
        role: schema.orgMembers.role,
      })
      .from(schema.users)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
      .where(eq(schema.users.email, email))
      .limit(1);

    const ok = row !== undefined && (await verifyPassword(row.hash, password));
    if (!ok || !row) throw errors.unauthenticated('invalid credentials');

    const jwt = issueStudioJwt(row.id, email, row.role, iss);
    return reply.send(buildTokenResponse(jwt, jwt, row.id, email, row.role));
  });

  // ── Current user ──────────────────────────────────────────────────────────
  app.get('/user', async (req, reply) => {
    const user = app.requireAuth(req);
    return reply.send(buildUser(user.id, user.email, user.role));
  });

  // ── Update user (Studio may PATCH profile) ────────────────────────────────
  app.put('/user', async (req, reply) => {
    const user = app.requireAuth(req);
    return reply.send(buildUser(user.id, user.email, user.role));
  });

  // ── Logout — JWTs expire naturally; just respond 204 ─────────────────────
  app.post('/logout', async (_req, reply) => reply.status(204).send());

  // ── MFA assurance level — Studio checks this after login ─────────────────
  app.get('/mfa/authenticator/assurance-level', async (_req, reply) => {
    return reply.send({ currentLevel: 'aal1', nextLevel: 'aal1' });
  });

  // ── Factors list ──────────────────────────────────────────────────────────
  app.get('/factors', async (_req, reply) => reply.send([]));
};

function buildUser(id: string, email: string, role: string) {
  const now = new Date().toISOString();
  return {
    id,
    aud: 'authenticated',
    role: 'authenticated',
    email,
    email_confirmed_at: now,
    confirmed_at: now,
    last_sign_in_at: now,
    app_metadata: { provider: 'email', providers: ['email'], supastack_role: role },
    user_metadata: {},
    identities: [],
    created_at: now,
    updated_at: now,
  };
}

function buildTokenResponse(
  accessToken: string,
  refreshToken: string,
  userId: string,
  email: string,
  role: string,
) {
  return {
    access_token: accessToken,
    token_type: 'bearer',
    expires_in: 86400,
    expires_at: Math.floor(Date.now() / 1000) + 86400,
    refresh_token: refreshToken,
    user: buildUser(userId, email, role),
  };
}
