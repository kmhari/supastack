/**
 * Black-box tests for notifications, available-versions, and auth hooks config (US4 — feature 113)
 *
 * Notifications and available-versions are static stubs — only auth guards needed.
 *
 * Auth hooks (GET/PATCH /platform/auth/:ref/config/hooks) call app.inject() internally
 * to delegate to /v1/projects/:ref/config/auth. Both platformMiscRoutes AND
 * authConfigRoutes must be registered in the same test app (with authConfigRoutes at
 * prefix /v1) so the internal delegation resolves correctly without needing to mock
 * app.inject (research Decision 8).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef:
    vi.fn<(userId: string, ref: string) => Promise<Record<string, unknown> | null>>(),
  // getPlaintextConfig may be imported by some paths
  getPlaintextConfig: vi.fn(),
}));

const configStoreMock = vi.hoisted(() => ({
  getConfig: vi.fn<(ref: string, surface: string) => Promise<Record<string, unknown>>>(),
  getPlaintextConfig: vi.fn(),
  saveConfigOnly:
    vi.fn<
      (
        ref: string,
        surface: string,
        data: unknown,
        userId: string,
      ) => Promise<Record<string, unknown>>
    >(),
  patchConfig:
    vi.fn<
      (
        ref: string,
        surface: string,
        body: unknown,
        opts: unknown,
      ) => Promise<Record<string, unknown>>
    >(),
}));

vi.mock('../../src/services/project-store.js', () => projectStoreMock);
vi.mock('../../src/services/runtime-config-store.js', () => configStoreMock);

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
        innerJoin: () => ({
          where: () => ({ limit: async () => [] }),
        }),
        where: () => ({ limit: async () => [] }),
      }),
    }),
    insert: () => ({ values: async () => undefined }),
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
  loadMasterKey: () => Buffer.alloc(32),
  generateRef: () => 'abcdefghijklmnopqrst',
}));

vi.mock('../../src/services/api-tokens.js', () => ({
  mintApiToken: async () => ({ raw: `sbp_${'a'.repeat(40)}`, id: 'tok-new', prefix: 'sbp_aaaa' }),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_INST = { ref: 'ref123', status: 'running' };

async function buildBasicApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );
  app.decorate('requireAuth', () => {
    if (!authed) throw Object.assign(new Error('unauthorized'), { statusCode: 401 });
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  app.decorate('authorizeOrg', async () => 'owner' as const);
  const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
  await app.register(platformMiscRoutes);
  return app;
}

async function buildHooksApp(authed = true): Promise<FastifyInstance> {
  const app = Fastify();
  const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
  const { AppError } = await import('@supastack/shared');

  app.setErrorHandler((err, _req, reply) =>
    reply.status((err as { statusCode?: number }).statusCode ?? 500).send({ error: err.message }),
  );

  app.decorate('requireAuth', (_req: FastifyRequest) => {
    if (!authed) throw new AppError(401, 'unauthenticated', 'Unauthorized');
    return { id: 'u1', email: 'op@x.dev', role: 'owner' as const };
  });
  app.decorate('authorizeOrg', async () => 'owner' as const);
  app.decorate('authorize', () => {});

  // platformMiscRoutes registered at root (hooks call app.inject to /v1/…)
  const { platformMiscRoutes } = await import('../../src/routes/platform-misc.js');
  await app.register(platformMiscRoutes);

  // authConfigRoutes registered at /v1 so internal app.inject resolves correctly
  const { authConfigRoutes } = await import('../../src/routes/management/auth-config.js');
  await app.register(
    async (scope) => {
      await scope.register(mgmtApiErrorsPlugin);
      await scope.register(authConfigRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}

// ─── Notifications ────────────────────────────────────────────────────────────

describe('GET /platform/notifications', () => {
  it('200 — returns empty array', async () => {
    const app = await buildBasicApp();
    const res = await app.inject({ method: 'GET', url: '/platform/notifications' });
    expect(res.statusCode).toBe(200);
    expect(Array.isArray(res.json())).toBe(true);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const app = await buildBasicApp(false);
    const res = await app.inject({ method: 'GET', url: '/platform/notifications' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

describe('PATCH /platform/notifications', () => {
  it('204 — mark-read succeeds', async () => {
    const app = await buildBasicApp();
    const res = await app.inject({
      method: 'PATCH',
      url: '/platform/notifications',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(204);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const app = await buildBasicApp(false);
    const res = await app.inject({ method: 'PATCH', url: '/platform/notifications', payload: {} });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ─── Available versions ───────────────────────────────────────────────────────

describe('GET /platform/projects/available-versions', () => {
  it('200 — returns array of version objects', async () => {
    const app = await buildBasicApp();
    const res = await app.inject({ method: 'GET', url: '/platform/projects/available-versions' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as unknown[];
    expect(Array.isArray(body)).toBe(true);
    expect(body.length).toBeGreaterThan(0);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const app = await buildBasicApp(false);
    const res = await app.inject({ method: 'GET', url: '/platform/projects/available-versions' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});

// ─── Auth hooks config ────────────────────────────────────────────────────────

describe('GET /platform/auth/:ref/config/hooks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildHooksApp();
  });

  it('200 — returns hook-related fields from config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    configStoreMock.getConfig.mockResolvedValue({
      hook_mfa_verification_attempt_enabled: false,
      hook_custom_access_token_enabled: false,
      hook_send_email_enabled: false,
      hook_send_sms_enabled: false,
    });

    const res = await app.inject({
      method: 'GET',
      url: '/platform/auth/ref123/config/hooks',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json() as Record<string, unknown>;
    // Response should contain hook fields (translated to UPPERCASE by auth-config-case.ts)
    expect(Object.keys(body).some((k) => k.startsWith('HOOK_') || k.startsWith('hook_'))).toBe(
      true,
    );
    await app.close();
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/platform/auth/unknown/config/hooks',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildHooksApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/platform/auth/ref123/config/hooks',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('PATCH /platform/auth/:ref/config/hooks', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildHooksApp();
  });

  it('200 — delegates to auth-config and returns hook fields', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    configStoreMock.patchConfig.mockResolvedValue({
      hook_mfa_verification_attempt_enabled: true,
      hook_custom_access_token_enabled: false,
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/platform/auth/ref123/config/hooks',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED: true },
    });

    expect(res.statusCode).toBe(200);
    await app.close();
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/platform/auth/unknown/config/hooks',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildHooksApp(false);
    const res = await unauthApp.inject({
      method: 'PATCH',
      url: '/platform/auth/ref123/config/hooks',
      headers: { 'content-type': 'application/json' },
      payload: {},
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});
