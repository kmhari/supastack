/**
 * Black-box tests for the platform OAuth-consent endpoints (feature 115, T010 + T012).
 *
 *   GET    /platform/oauth/authorizations/:id                      (US1 — details)
 *   POST   /platform/organizations/:slug/oauth/authorizations/:id  (US1 — approve)
 *
 * Replay/expiry (US2, T012) are exercised here too. The deny path (DELETE, US3)
 * lives in oauth-platform-consent-deny.test.ts so it can run in parallel.
 *
 * Harness mirrors platform-misc-routes.test.ts: mock the heavy platform-misc
 * imports, decorate auth, register platformMiscRoutes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

// ─── Controllable mocks for the session store + code issuance ──────────────────
const sessionStoreMock = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  consumeAuthSession: vi.fn(),
}));
const codesMock = vi.hoisted(() => ({
  issueCode: vi.fn(),
}));
const auditValuesSpy = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/oauth-auth-sessions-store.js', () => sessionStoreMock);
vi.mock('../../src/services/oauth-codes-store.js', () => codesMock);

// ─── Heavy platform-misc dependency mocks (mirrors platform-misc-routes.test.ts) ─
vi.mock('../../src/services/project-store.js', () => ({
  getProjectByRef: vi.fn(),
  getPlaintextConfig: vi.fn(),
}));
vi.mock('../../src/services/runtime-config-store.js', () => ({
  getConfig: vi.fn(),
  getPlaintextConfig: vi.fn(),
  saveConfigOnly: vi.fn(),
  patchConfig: vi.fn(),
}));
vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  asc: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  isNull: () => ({}),
  sql: () => ({}),
}));
vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        innerJoin: () => ({ where: () => ({ limit: async () => [] }) }),
        where: () => ({ limit: async () => [] }),
      }),
    }),
    insert: () => ({ values: async (v: unknown) => auditValuesSpy(v) }),
    update: () => ({ set: () => ({ where: async () => undefined }) }),
    delete: () => ({ where: async () => undefined }),
  }),
  schema: {
    supabaseInstances: {},
    organizationMembers: {},
    organizations: {},
    apiTokens: {},
    auditLog: {},
  },
}));
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  encryptJson: () => Buffer.alloc(0),
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
  signSupabaseJwt: () => 'jwt',
}));
vi.mock('../../src/services/api-tokens.js', () => ({
  mintApiToken: async () => ({ raw: `sbp_${'a'.repeat(40)}`, id: 'tok', prefix: 'sbp_aaaa' }),
}));

const SESSION = {
  auth_id: '11111111-2222-4333-8444-555555555555',
  client_id: '00000000-0000-0000-0000-000000000001',
  client_name: 'Test MCP',
  client_website: 'https://claude.ai',
  client_icon: null,
  client_domain: 'localhost',
  redirect_uri: 'http://localhost:9999/callback',
  state: 'st-1',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256' as const,
  scopes: ['projects:read', 'projects:write'],
  created_at: '2026-06-08T00:00:00.000Z',
  expires_at: '2026-06-08T00:10:00.000Z',
};

async function buildApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  const { AppError } = await import('@supastack/shared');
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', (_req: FastifyRequest) => {
    if (!authed) throw new AppError(401, 'unauthenticated', 'Unauthorized');
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  app.decorate('authorize', function (this: FastifyInstance, req: FastifyRequest) {
    this.requireAuth(req);
  });
  app.decorate('authorizeOrg', async function (this: FastifyInstance, req: FastifyRequest) {
    this.requireAuth(req);
    return 'owner' as const;
  });
  const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  sessionStoreMock.getAuthSession.mockReset();
  sessionStoreMock.consumeAuthSession.mockReset();
  codesMock.issueCode.mockReset();
  auditValuesSpy.mockReset();
  codesMock.issueCode.mockResolvedValue({ code: 'CODE123' });
});

describe('GET /platform/oauth/authorizations/:id', () => {
  it('200 — returns the Studio-shaped details (happy)', async () => {
    sessionStoreMock.getAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp();
    const res = await app.inject({
      method: 'GET',
      url: `/platform/oauth/authorizations/${SESSION.auth_id}`,
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      name: 'Test MCP',
      website: 'https://claude.ai',
      icon: null,
      domain: 'localhost',
      scopes: ['projects:read', 'projects:write'],
      expires_at: '2026-06-08T00:10:00.000Z',
      approved_at: null,
      approved_organization_slug: null,
    });
    await app.close();
  });

  it('404 — unknown/expired session (sad)', async () => {
    sessionStoreMock.getAuthSession.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/platform/oauth/authorizations/nope' });
    expect(res.statusCode).toBe(404);
    expect(res.json().error).toBe('not_found');
    await app.close();
  });

  it('401 — unauthenticated (sad)', async () => {
    sessionStoreMock.getAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp(false);
    const res = await app.inject({
      method: 'GET',
      url: `/platform/oauth/authorizations/${SESSION.auth_id}`,
    });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('POST /platform/organizations/:slug/oauth/authorizations/:id (approve)', () => {
  const url = `/platform/organizations/org_abc/oauth/authorizations/${SESSION.auth_id}`;

  it('201 { url } with skip_browser_redirect=true + oauth.code.issued audit (happy)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `${url}?skip_browser_redirect=true` });
    expect(res.statusCode).toBe(201);
    expect(res.json().url).toBe('http://localhost:9999/callback?code=CODE123&state=st-1');
    expect(codesMock.issueCode).toHaveBeenCalledWith(
      expect.objectContaining({
        clientId: SESSION.client_id,
        userId: 'u1',
        redirectUri: SESSION.redirect_uri,
        codeChallenge: SESSION.code_challenge,
        scope: 'projects:read projects:write',
      }),
    );
    await new Promise((r) => setTimeout(r, 10)); // let the fire-and-forget audit flush
    expect(auditValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'oauth.code.issued', actorUserId: 'u1' }),
    );
    await app.close();
  });

  it('302 to the callback URL without the flag (happy)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url });
    expect(res.statusCode).toBe(302);
    expect(res.headers['location']).toBe('http://localhost:9999/callback?code=CODE123&state=st-1');
    await app.close();
  });

  it('404 — session missing/already consumed (sad)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `${url}?skip_browser_redirect=true` });
    expect(res.statusCode).toBe(404);
    expect(codesMock.issueCode).not.toHaveBeenCalled();
    await app.close();
  });

  // ── US2 (T012) — replay protection: approving the same auth_id twice ──────────
  it('replay — first approve 201, second 404 (US2, sad)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValueOnce(SESSION).mockResolvedValueOnce(null);
    const app = await buildApp();
    const first = await app.inject({ method: 'POST', url: `${url}?skip_browser_redirect=true` });
    const second = await app.inject({ method: 'POST', url: `${url}?skip_browser_redirect=true` });
    expect(first.statusCode).toBe(201);
    expect(second.statusCode).toBe(404);
    await app.close();
  });
});
