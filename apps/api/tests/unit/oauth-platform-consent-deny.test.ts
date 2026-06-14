/**
 * Black-box tests for the OAuth-consent DENY endpoint (feature 115, T015 — US3).
 *
 *   DELETE /platform/organizations/:slug/oauth/authorizations/:id
 *
 * Separate file from the approve tests so it can run in parallel. Harness
 * mirrors oauth-platform-consent.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

const sessionStoreMock = vi.hoisted(() => ({
  getAuthSession: vi.fn(),
  consumeAuthSession: vi.fn(),
}));
const auditValuesSpy = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/oauth-auth-sessions-store.js', () => sessionStoreMock);
vi.mock('../../src/services/oauth-codes-store.js', () => ({ issueCode: vi.fn() }));
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
  client_website: '',
  client_icon: null,
  client_domain: 'localhost',
  redirect_uri: 'http://localhost:9999/callback',
  state: 'st-1',
  code_challenge: 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
  code_challenge_method: 'S256' as const,
  scopes: ['projects:read'],
  created_at: '2026-06-08T00:00:00.000Z',
  expires_at: '2026-06-08T00:10:00.000Z',
};

const URL_PATH = `/platform/organizations/org_abc/oauth/authorizations/${SESSION.auth_id}`;

async function buildApp(
  opts: { authed?: boolean; orgAllowed?: boolean } = {},
): Promise<FastifyInstance> {
  const { authed = true, orgAllowed = true } = opts;
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
    if (!orgAllowed) throw new AppError(403, 'forbidden', 'not allowed');
    return 'owner' as const;
  });
  const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
  await app.register(platformMiscRoutes);
  return app;
}

beforeEach(() => {
  sessionStoreMock.consumeAuthSession.mockReset();
  auditValuesSpy.mockReset();
});

describe('DELETE /platform/organizations/:slug/oauth/authorizations/:id (deny)', () => {
  it('200 { id } + oauth.consent.denied audit (happy)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: URL_PATH });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ id: SESSION.auth_id });
    await new Promise((r) => setTimeout(r, 10));
    expect(auditValuesSpy).toHaveBeenCalledWith(
      expect.objectContaining({ action: 'oauth.consent.denied', actorUserId: 'u1' }),
    );
    await app.close();
  });

  it('403 — not an owner/administrator of the org (sad)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(SESSION);
    const app = await buildApp({ orgAllowed: false });
    const res = await app.inject({ method: 'DELETE', url: URL_PATH });
    expect(res.statusCode).toBe(403);
    expect(sessionStoreMock.consumeAuthSession).not.toHaveBeenCalled();
    await app.close();
  });

  it('404 — session missing/already consumed (sad)', async () => {
    sessionStoreMock.consumeAuthSession.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'DELETE', url: URL_PATH });
    expect(res.statusCode).toBe(404);
    await app.close();
  });
});
