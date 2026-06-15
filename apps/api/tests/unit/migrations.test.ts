/**
 * Unit tests for migrations endpoints (US3 — feature 113)
 *
 *   GET    /projects/:ref/database/migrations
 *   POST   /projects/:ref/database/migrations/upsert
 *   DELETE /projects/:ref/database/migrations/:version
 *
 * Mocks:
 *   - project-store.js     (getProjectByRef)
 *   - migrations-service.js (listMigrations, upsertMigration, deleteMigration)
 *   - per-instance-pg.js   (error classes — via vi.hoisted so instanceof works)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify';
import fp from 'fastify-plugin';

// ─── Mocks ────────────────────────────────────────────────────────────────────

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef:
    vi.fn<(userId: string, ref: string) => Promise<Record<string, unknown> | null>>(),
}));

const migrationsMock = vi.hoisted(() => ({
  listMigrations: vi.fn<(ref: string) => Promise<unknown[]>>(),
  upsertMigration: vi.fn<(ref: string, data: unknown) => Promise<unknown>>(),
  deleteMigration: vi.fn<(ref: string, version: string) => Promise<unknown>>(),
  VERSION_REGEX: /^\d{14}$/,
}));

const perInstancePgMock = vi.hoisted(() => {
  class InstanceNotFoundError extends Error {
    code = 'instance_not_found' as const;
    constructor() {
      super('Instance not found');
    }
  }
  class InstanceNotRunningError extends Error {
    code = 'instance_not_running' as const;
    constructor(public readonly status: string) {
      super(`Project is in state '${status}'`);
    }
  }
  class PerInstancePgConnectError extends Error {
    code = 'per_instance_pg_connect_error' as const;
    constructor(message: string) {
      super(message);
    }
  }
  return { InstanceNotFoundError, InstanceNotRunningError, PerInstancePgConnectError };
});

vi.mock('../../src/services/project-store.js', () => projectStoreMock);
vi.mock('../../src/services/migrations-service.js', () => migrationsMock);
vi.mock('../../src/services/per-instance-pg.js', () => perInstancePgMock);

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
  app.decorate('authorizeOrg', async () => 'owner' as const); // SEC-003: org-scoped gate
  const { migrationsRoutes } = await import('../../src/routes/management/migrations.js');
  await app.register(
    fp(async (scope) => {
      await scope.register(migrationsRoutes);
    }),
  );
  return app;
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('GET /projects/:ref/database/migrations', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — returns migration list', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.listMigrations.mockResolvedValue([{ version: '20240101000000', name: 'init' }]);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ migrations: [{ version: '20240101000000' }] });
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/unknown/database/migrations',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('409 — instance not running', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.listMigrations.mockRejectedValue(
      new perInstancePgMock.InstanceNotRunningError('paused'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'project_not_running' });
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('POST /projects/:ref/database/migrations/upsert', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — upserts a migration', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.upsertMigration.mockResolvedValue({ version: '20240101000000', name: 'init' });

    const res = await app.inject({
      method: 'POST',
      url: '/projects/ref123/database/migrations/upsert',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { version: '20240101000000', name: 'init', statements: ['CREATE TABLE foo();'] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: '20240101000000' });
  });

  it('400 — missing version field', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'POST',
      url: '/projects/ref123/database/migrations/upsert',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { name: 'no-version' },
    });

    expect(res.statusCode).toBe(400);
  });

  it('400 — version does not match \\d{14}', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'POST',
      url: '/projects/ref123/database/migrations/upsert',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { version: 'bad-version', name: 'init' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_version_format' });
  });
});

describe('DELETE /projects/:ref/database/migrations/:version', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — deletes a migration', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.deleteMigration.mockResolvedValue({ version: '20240101000000' });

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
  });

  it('400 — version param format invalid', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'DELETE',
      url: '/projects/ref123/database/migrations/not-a-version',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_version_format' });
  });
});
