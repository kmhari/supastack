import { describe, expect, it, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// ─── Mocks ───────────────────────────────────────────────────────────────────

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef: vi.fn<(userId: string, ref: string) => Promise<{ ref: string } | null>>(),
}));

const configStoreMock = vi.hoisted(() => ({
  getConfig: vi.fn<(ref: string, surface: string) => Promise<Record<string, unknown>>>(),
  saveConfigOnly:
    vi.fn<
      (
        ref: string,
        surface: string,
        data: Record<string, unknown>,
        userId: string,
      ) => Promise<Record<string, unknown>>
    >(),
}));

vi.mock('../../src/services/project-store.js', () => projectStoreMock);
vi.mock('../../src/services/runtime-config-store.js', () => configStoreMock);

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function buildApp(role: 'owner' | 'developer' | null = 'owner'): Promise<FastifyInstance> {
  const app = Fastify();

  // mgmt-api-errors plugin (needed for ManagementApiError → scoped error handler)
  const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
  const { AppError } = await import('@supastack/shared');
  await app.register(mgmtApiErrorsPlugin);

  app.decorate('requireAuth', function requireAuth(_req: FastifyRequest) {
    if (role === null) {
      throw new AppError(401, 'unauthenticated', 'Unauthorized');
    }
    return { id: 'user-1', email: 'test@example.com', role };
  });
  // authorize is called as app.authorize(req, action) — no-op for owner; throw for read-only
  app.decorate('authorize', function authorize(_req: FastifyRequest, action: string) {
    if (role === 'developer' && action === 'data_api_config.write') {
      const err = new Error('Forbidden') as Error & { statusCode: number; code: string };
      err.statusCode = 403;
      err.code = 'forbidden';
      throw err;
    }
  });
  app.decorate('authorizeOrg', async function authorizeOrg(_req: FastifyRequest, action: string) {
    if (role === 'developer' && action === 'data_api_config.write') {
      const err = new Error('Forbidden') as Error & { statusCode: number; code: string };
      err.statusCode = 403;
      err.code = 'forbidden';
      throw err;
    }
    return role;
  });

  const { realtimeConfigRoutes } = await import('../../src/routes/management/realtime-config.js');
  // Register inside a scoped plugin so encapsulation mirrors how server.ts
  // registers management routes inside the /v1 scope with mgmtApiErrorsPlugin.
  await app.register(
    fp(async (scope) => {
      await scope.register(realtimeConfigRoutes);
    }),
  );

  return app;
}

const FAKE_INSTANCE = { ref: 'ref123' } as unknown as Parameters<
  typeof projectStoreMock.getProjectByRef
>[0];

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /projects/:ref/config/realtime', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp('owner');
  });

  it('returns defaults when no snapshot exists', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE as never);
    configStoreMock.getConfig.mockResolvedValue({ max_concurrent_users: 200 });

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/config/realtime',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ max_concurrent_users: 200 });
    expect(configStoreMock.getConfig).toHaveBeenCalledWith('ref123', 'realtime');
  });

  it('returns 404 when project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/config/realtime',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'not_found' });
  });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(null);

    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/config/realtime',
      headers: {},
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /projects/:ref/config/realtime', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp('owner');
  });

  it('saves valid body and returns merged config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE as never);
    configStoreMock.saveConfigOnly.mockResolvedValue({ max_concurrent_users: 500 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/realtime',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { max_concurrent_users: 500 },
    });

    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body)).toMatchObject({ max_concurrent_users: 500 });
    expect(configStoreMock.saveConfigOnly).toHaveBeenCalledWith(
      'ref123',
      'realtime',
      { max_concurrent_users: 500 },
      'user-1',
    );
  });

  it('accepts empty body (no-op patch)', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE as never);
    configStoreMock.saveConfigOnly.mockResolvedValue({ max_concurrent_users: 200 });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/realtime',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for negative max_concurrent_users', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE as never);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/realtime',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { max_concurrent_users: -1 },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('validation_failed');
    expect(body.details).toHaveProperty('max_concurrent_users');
  });

  it('returns 400 for unknown fields', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE as never);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/realtime',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { bogus_field: 'nope' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('returns 404 when project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/unknown/config/realtime',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { max_concurrent_users: 100 },
    });

    expect(res.statusCode).toBe(404);
  });
});
