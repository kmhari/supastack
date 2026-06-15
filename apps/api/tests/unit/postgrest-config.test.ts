/**
 * Unit tests for GET/PATCH /v1/projects/:ref/postgrest (US3 — feature 113)
 *
 * Mocks:
 *   - project-store.js        (getProjectByRef)
 *   - runtime-config-store.js (getConfig, patchConfig)
 *   - @supastack/db            (db() fluent chain — returns empty encryptedSecrets)
 *   - @supastack/crypto        (decryptJson, loadMasterKey)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef:
    vi.fn<(userId: string, ref: string) => Promise<Record<string, unknown> | null>>(),
}));

const configStoreMock = vi.hoisted(() => ({
  getConfig: vi.fn<(ref: string, surface: string) => Promise<Record<string, unknown>>>(),
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

vi.mock('drizzle-orm', () => ({ and: () => ({}), eq: () => ({}), desc: () => ({}) }));

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({ limit: async () => [] }),
      }),
    }),
  }),
  schema: { supabaseInstances: {} },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: vi.fn(() => ({})),
  loadMasterKey: vi.fn(() => Buffer.alloc(32)),
  generateRef: vi.fn(() => 'abcdefghijklmnopqrst'),
}));

// ─── Helpers ─────────────────────────────────────────────────────────────────

const FAKE_INST = { ref: 'ref123', status: 'running' };

async function buildApp(authenticated = true): Promise<FastifyInstance> {
  const app = Fastify();
  const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
  const { AppError } = await import('@supastack/shared');
  await app.register(mgmtApiErrorsPlugin);
  app.decorate('requireAuth', (_req: FastifyRequest) => {
    if (!authenticated) throw new AppError(401, 'unauthenticated', 'Unauthorized');
    return { id: 'user-1', email: 'test@example.com', role: 'owner' as const };
  });
  app.decorate('authorize', () => {});
  app.decorate('authorizeOrg', async () => 'owner' as const);
  const { postgrestConfigRoutes } = await import('../../src/routes/management/postgrest-config.js');
  await app.register(
    fp(async (scope) => {
      await scope.register(postgrestConfigRoutes);
    }),
  );
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /projects/:ref/postgrest', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 with defaults — no stored config, no secrets → returns config with jwt_secret: ""', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    configStoreMock.getConfig.mockResolvedValue({ max_rows: 1000, db_schema: 'public' });

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/postgrest',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body).toMatchObject({ max_rows: 1000, db_schema: 'public' });
    expect(body.jwt_secret).toBe('');
  });

  it('200 with stored config — returns merged config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    configStoreMock.getConfig.mockResolvedValue({ max_rows: 500, db_schema: 'public,private' });

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/postgrest',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ max_rows: 500 });
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/postgrest',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/postgrest',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('PATCH /projects/:ref/postgrest', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — patchConfig called and returns updated config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    configStoreMock.patchConfig.mockResolvedValue({ max_rows: 200 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/postgrest',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { max_rows: 200 },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ max_rows: 200 });
    expect(configStoreMock.patchConfig).toHaveBeenCalledWith(
      'ref123',
      'postgrest',
      { max_rows: 200 },
      { userId: 'user-1' },
    );
  });

  it('409 — project not running', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: 'ref123', status: 'paused' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/postgrest',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { max_rows: 200 },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'project_not_running' });
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/unknown/postgrest',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(404);
  });
});
