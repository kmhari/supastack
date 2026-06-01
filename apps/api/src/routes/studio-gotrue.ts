/**
 * GoTrue-compatible shim for Supabase Studio IS_PLATFORM=true.
 *
 * Studio sets NEXT_PUBLIC_GOTRUE_URL=https://<apex>/api/v1 and sends all
 * auth calls to that base URL. This plugin implements the minimal GoTrue
 * surface needed for Studio to sign in, get user info, and sign out.
 *
 * Auth flow:
 *   1. POST /token?grant_type=password  — validate email+password, mint a
 *      session PAT (source='studio'), return it as access_token.
 *   2. GET  /user                       — requireAuth on Bearer PAT, return
 *      GoTrue-shaped user object.
 *   3. POST /logout                     — revoke the session PAT.
 *   4. GET  /settings                   — stub GoTrue settings (captcha off).
 *
 * The returned access_token is a real Supastack PAT (sbp_…) stored in
 * api_tokens with source='studio'. requireAuth already handles PAT Bearer
 * tokens, so all proxy routes continue to work after login.
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq, and, isNull } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { verifyPassword } from '@supastack/crypto';
import { errors } from '@supastack/shared';
import { mintApiToken } from '../services/api-tokens.js';
import { sha256 } from '../plugins/auth.js';

const STUDIO_TOKEN_LABEL = 'studio-session';

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

    if (grantType === 'refresh_token') {
      // Studio tries to refresh on page reload. Re-authenticate using the
      // refresh_token (which we store as the same PAT raw value).
      const body = req.body as Record<string, unknown>;
      const refreshToken = body?.refresh_token as string | undefined;
      if (!refreshToken) throw errors.unauthenticated('missing refresh_token');

      const tokenHash = sha256(refreshToken);
      const [row] = await db()
        .select({
          id: schema.apiTokens.id,
          userId: schema.apiTokens.userId,
        })
        .from(schema.apiTokens)
        .where(
          and(
            eq(schema.apiTokens.tokenSha256, tokenHash),
            isNull(schema.apiTokens.revokedAt),
          ),
        )
        .limit(1);

      if (!row) throw errors.unauthenticated('invalid or expired refresh_token');

      const [user] = await db()
        .select({ email: schema.users.email, role: schema.orgMembers.role })
        .from(schema.users)
        .innerJoin(schema.orgMembers, eq(schema.orgMembers.userId, schema.users.id))
        .where(eq(schema.users.id, row.userId))
        .limit(1);

      if (!user) throw errors.unauthenticated('user not found');

      return reply.send(buildTokenResponse(refreshToken, refreshToken, row.userId, user.email, user.role));
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

    // Revoke any existing studio sessions for this user to keep it tidy.
    await db()
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(
        and(
          eq(schema.apiTokens.userId, row.id),
          eq(schema.apiTokens.source, 'studio'),
          isNull(schema.apiTokens.revokedAt),
        ),
      );

    const { raw } = await mintApiToken(db(), row.id, STUDIO_TOKEN_LABEL, 'studio');

    return reply.send(buildTokenResponse(raw, raw, row.id, email, row.role));
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

  // ── Logout — revoke the session PAT ──────────────────────────────────────
  app.post('/logout', async (req, reply) => {
    try {
      const user = app.requireAuth(req);
      // Revoke all studio-source tokens for this user on explicit logout.
      await db()
        .update(schema.apiTokens)
        .set({ revokedAt: new Date() })
        .where(
          and(
            eq(schema.apiTokens.userId, user.id),
            eq(schema.apiTokens.source, 'studio'),
            isNull(schema.apiTokens.revokedAt),
          ),
        );
    } catch {
      // Even if auth fails, respond 204 — Studio treats it as signed-out.
    }
    return reply.status(204).send();
  });

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
