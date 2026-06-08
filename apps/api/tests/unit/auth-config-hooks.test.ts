import { describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// GET/PATCH /platform/auth/:ref/config/hooks (feature 085 + 082): a scoped view/
// write over the hook_* subset of the auth config. The bridge re-injects to
// /v1/projects/:ref/config/auth; we stub it (incl. feature-082-style enabled-
// without-URI rejection) to exercise the bridge's filter + translation.

vi.mock('drizzle-orm', () => ({ and: () => ({}), desc: () => ({}), eq: () => ({}), isNull: () => ({}), sql: () => ({}) }));
vi.mock('@supastack/db', () => ({
  db: () => ({}),
  schema: { supabaseInstances: {}, organizationMembers: {}, organizations: {}, organizationInvitations: {}, authUsers: {}, users: {}, apiTokens: {}, installation: {} },
}));
vi.mock('@supastack/crypto', () => ({ decryptJson: () => ({}), loadMasterKey: () => Buffer.alloc(32), generateRef: () => 'abcdefghijklmnopqrst' }));

const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');

const patches: Array<Record<string, unknown>> = [];

async function buildApp(): Promise<FastifyInstance> {
  patches.length = 0;
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.dev', role: 'developer' as const }));
  app.decorate('authorizeOrg', async () => 'developer' as const);
  app.decorate('authorize', () => {});
  // Full config (mix of hook + non-hook fields); the bridge GET must return ONLY hooks, upper-cased.
  app.get('/v1/projects/:ref/config/auth', async (_req, reply) =>
    reply.send({ site_url: 'https://x', hook_custom_access_token_enabled: false, hook_mfa_verification_attempt_enabled: false, hook_send_email_enabled: false, _supastack: { fieldStatus: {} } }),
  );
  app.patch('/v1/projects/:ref/config/auth', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    patches.push(body);
    // feature-082 cross-field: hook enabled without a URI → 400
    if (body.hook_custom_access_token_enabled === true && !body.hook_custom_access_token_uri) {
      return reply.status(400).send({ message: 'hook enabled without uri', code: 'validation', details: { hook_custom_access_token_uri: 'required when enabled' } });
    }
    return reply.send({ ...body });
  });
  await app.register(platformMiscRoutes);
  return app;
}

const REF = 'tbnqljlgozpxzhkjxats';

describe('GET /platform/auth/:ref/config/hooks (US4)', () => {
  it('happy: returns ONLY the hook_* subset, UPPERCASE, loads with all disabled', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: `/platform/auth/${REF}/config/hooks`, headers: { authorization: 'Bearer x' } });
    expect(res.statusCode).toBe(200);
    const b = res.json();
    expect(b.HOOK_CUSTOM_ACCESS_TOKEN_ENABLED).toBe(false);
    expect(b.HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED).toBe(false);
    expect(b.SITE_URL).toBeUndefined(); // non-hook fields excluded
    expect(b._supastack).toBeUndefined(); // meta not part of the hook subset
    await app.close();
  });
});

describe('PATCH /platform/auth/:ref/config/hooks (US4)', () => {
  it('happy: enable a hook with a valid pg-functions:// URI → 200, /v1 gets LOWERCASE keys', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH', url: `/platform/auth/${REF}/config/hooks`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: true, HOOK_CUSTOM_ACCESS_TOKEN_URI: 'pg-functions://postgres/public/my_hook' },
    });
    expect(res.statusCode).toBe(200);
    expect(patches[0]).toEqual({ hook_custom_access_token_enabled: true, hook_custom_access_token_uri: 'pg-functions://postgres/public/my_hook' });
    expect(res.json().HOOK_CUSTOM_ACCESS_TOKEN_ENABLED).toBe(true);
    await app.close();
  });

  it('sad: enabled without a URI → 400 with the offending field named (UPPERCASE)', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'PATCH', url: `/platform/auth/${REF}/config/hooks`,
      headers: { authorization: 'Bearer x', 'content-type': 'application/json' },
      payload: { HOOK_CUSTOM_ACCESS_TOKEN_ENABLED: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().details).toHaveProperty('HOOK_CUSTOM_ACCESS_TOKEN_URI');
    await app.close();
  });
});
