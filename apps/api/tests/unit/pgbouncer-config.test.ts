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

async function buildApp(authenticated = true): Promise<FastifyInstance> {
  const app = Fastify();

  const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
  const { AppError } = await import('@supastack/shared');
  await app.register(mgmtApiErrorsPlugin);

  app.decorate('requireAuth', function requireAuth(_req: FastifyRequest) {
    if (!authenticated) {
      throw new AppError(401, 'unauthenticated', 'Unauthorized');
    }
    return { id: 'user-1', email: 'test@example.com', role: 'owner' as const };
  });
  app.decorate('authorize', function authorize() {});
  app.decorate('authorizeOrg', async () => 'owner' as const);

  const { pgbouncerConfigRoutes } = await import('../../src/routes/management/pgbouncer-config.js');
  await app.register(
    fp(async (scope) => {
      await scope.register(pgbouncerConfigRoutes);
    }),
  );

  return app;
}

const FAKE_INSTANCE = { ref: 'ref123' } as never;

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /projects/:ref/config/database/pgbouncer', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(true);
  });

  it('returns pgbouncer config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);
    configStoreMock.getConfig.mockResolvedValue({
      pool_mode: 'transaction',
      default_pool_size: 15,
      ignore_startup_parameters: 'extra_float_digits',
      max_client_conn: 200,
      connection_string: '',
    });

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/config/database/pgbouncer',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pool_mode).toBe('transaction');
    expect(body.default_pool_size).toBe(15);
    expect(configStoreMock.getConfig).toHaveBeenCalledWith('ref123', 'pgbouncer');
  });

  it('returns 404 when project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/config/database/pgbouncer',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'not_found' });
  });

  it('returns 401 when not authenticated', async () => {
    const unauthApp = await buildApp(false);

    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/config/database/pgbouncer',
    });

    expect(res.statusCode).toBe(401);
  });
});

describe('PATCH /projects/:ref/config/database/pooler', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp(true);
  });

  it('saves valid body and returns merged config', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);
    configStoreMock.saveConfigOnly.mockResolvedValue({
      pool_mode: 'session',
      default_pool_size: 25,
      ignore_startup_parameters: 'extra_float_digits',
      max_client_conn: 200,
      connection_string: '',
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/database/pooler',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { pool_mode: 'session', default_pool_size: 25 },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.pool_mode).toBe('session');
    expect(body.default_pool_size).toBe(25);
    expect(configStoreMock.saveConfigOnly).toHaveBeenCalledWith(
      'ref123',
      'pgbouncer',
      { pool_mode: 'session', default_pool_size: 25 },
      'user-1',
    );
  });

  it('accepts empty body (no-op patch)', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);
    configStoreMock.saveConfigOnly.mockResolvedValue({ pool_mode: 'transaction' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/database/pooler',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: {},
    });

    expect(res.statusCode).toBe(200);
  });

  it('returns 400 for invalid pool_mode', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/database/pooler',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { pool_mode: 'round-robin' },
    });

    expect(res.statusCode).toBe(400);
    const body = JSON.parse(res.body);
    expect(body.code).toBe('validation_failed');
    expect(body.details).toHaveProperty('pool_mode');
  });

  it('returns 400 for negative default_pool_size', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/database/pooler',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { default_pool_size: -5 },
    });

    expect(res.statusCode).toBe(400);
    expect(JSON.parse(res.body)).toMatchObject({ code: 'validation_failed' });
  });

  it('returns 404 when project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/unknown/config/database/pooler',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { pool_mode: 'transaction' },
    });

    expect(res.statusCode).toBe(404);
  });

  it('asymmetric paths: GET uses /pgbouncer, PATCH uses /pooler', async () => {
    // Verify the route isn't accidentally at /pgbouncer (upstream shape difference)
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INSTANCE);
    configStoreMock.saveConfigOnly.mockResolvedValue({ pool_mode: 'transaction' });

    const patchRes = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/config/database/pgbouncer',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { pool_mode: 'session' },
    });
    expect(patchRes.statusCode).toBe(404);

    const poolerRes = await app.inject({
      method: 'GET',
      url: '/projects/ref123/config/database/pooler',
      headers: { authorization: 'Bearer token' },
    });
    expect(poolerRes.statusCode).toBe(404);
  });
});
