/**
 * Unit tests for migrations endpoints (US3 — feature 113)
 *
 *   GET    /projects/:ref/database/migrations
 *   PUT    /projects/:ref/database/migrations
 *   POST   /projects/:ref/database/migrations/upsert
 *   GET    /projects/:ref/database/migrations/:version
 *   PATCH  /projects/:ref/database/migrations/:version
 *   DELETE /projects/:ref/database/migrations/:version
 *
 * Mocks:
 *   - project-store.js     (getProjectByRef)
 *   - migrations-service.js (list/upsert/put/get/patch/deleteMigration)
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

const migrationsMock = vi.hoisted(() => {
  // Real class, not a stub: the route maps it with `instanceof`, so a plain
  // object here would fall through to a 500 and the 409 test would pass for the
  // wrong reason.
  class MigrationVersionCollisionError extends Error {
    code = 'migration_version_collision' as const;
  }
  return {
    listMigrations: vi.fn<(ref: string) => Promise<unknown[]>>(),
    upsertMigration: vi.fn<(ref: string, data: unknown) => Promise<unknown>>(),
    putMigration: vi.fn<(ref: string, input: unknown) => Promise<unknown>>(),
    getMigration: vi.fn<(ref: string, version: string) => Promise<unknown>>(),
    patchMigration: vi.fn<(ref: string, version: string, patch: unknown) => Promise<unknown>>(),
    deleteMigration: vi.fn<(ref: string, version: string) => Promise<unknown>>(),
    MigrationVersionCollisionError,
    VERSION_REGEX: /^\d{14}$/,
  };
});

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

describe('PUT /projects/:ref/database/migrations', () => {
  // Upstream's v1-upsert-a-migration: record a migration WITHOUT applying it.
  const ROW = {
    version: '20260818120000',
    name: 'create_widgets',
    statements: ['create table public.widgets(id bigint primary key);'],
    rollback: ['drop table if exists public.widgets;'],
    created_by: 'test@example.com',
    idempotency_key: null,
  };

  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
  });

  it('200 — records the row and stamps created_by from the caller', async () => {
    migrationsMock.putMigration.mockResolvedValue(ROW);

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: ROW.statements[0], name: 'create_widgets', rollback: ROW.rollback[0] },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: '20260818120000' });
    const input = migrationsMock.putMigration.mock.calls[0]![1] as Record<string, unknown>;
    expect(input).toMatchObject({
      query: ROW.statements[0],
      name: 'create_widgets',
      rollback: ROW.rollback[0],
      createdBy: 'test@example.com',
      idempotencyKey: null,
    });
  });

  it('200 — Idempotency-Key is forwarded so a retry cannot stamp a second row', async () => {
    migrationsMock.putMigration.mockResolvedValue({ ...ROW, idempotency_key: 'key-1' });

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token', 'idempotency-key': 'key-1' },
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(200);
    const input = migrationsMock.putMigration.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.idempotencyKey).toBe('key-1');
  });

  it('200 — the caller does NOT supply a version; the server derives it', async () => {
    migrationsMock.putMigration.mockResolvedValue(ROW);

    await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: 'select 1;', version: '19990101000000' },
    });

    // `version` is not part of V1UpsertMigrationBody — zod strips it rather than
    // letting a client dictate a stamp the server owns.
    const input = migrationsMock.putMigration.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.version).toBeUndefined();
  });

  it('400 — missing query', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { name: 'no query here' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_request' });
    expect(migrationsMock.putMigration).not.toHaveBeenCalled();
  });

  it('400 — empty query is rejected, matching upstream minLength:1', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: '' },
    });

    expect(res.statusCode).toBe(400);
    expect(migrationsMock.putMigration).not.toHaveBeenCalled();
  });

  it('200 — an empty Idempotency-Key normalises to null, not to a shared "" key', async () => {
    // A blank header stored verbatim would occupy the unique idempotency_key
    // slot, and every later caller sending a blank one would collide with it.
    migrationsMock.putMigration.mockResolvedValue(ROW);

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token', 'idempotency-key': '   ' },
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(200);
    const input = migrationsMock.putMigration.mock.calls[0]![1] as Record<string, unknown>;
    expect(input.idempotencyKey).toBeNull();
  });

  it('409 — version collision surfaces as 409, not 500', async () => {
    migrationsMock.putMigration.mockRejectedValue(
      new migrationsMock.MigrationVersionCollisionError('no free version'),
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'migration_version_collision' });
  });

  it('409 — instance not running', async () => {
    migrationsMock.putMigration.mockRejectedValue(
      new perInstancePgMock.InstanceNotRunningError('paused'),
    );

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'project_not_running' });
  });

  it('404 — project not found', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PUT',
      url: '/projects/unknown/database/migrations',
      headers: { authorization: 'Bearer token' },
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(404);
    expect(migrationsMock.putMigration).not.toHaveBeenCalled();
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'PUT',
      url: '/projects/ref123/database/migrations',
      payload: { query: 'select 1;' },
    });

    expect(res.statusCode).toBe(401);
    expect(migrationsMock.putMigration).not.toHaveBeenCalled();
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

// The two verbs upstream defines on this path. We previously served only DELETE
// here, so a spec-conformant CLI/MCP client hit the 501 catch-all instead.
describe('GET /projects/:ref/database/migrations/:version', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — returns the V1GetMigrationResponse shape for one version', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.getMigration.mockResolvedValue({
      version: '20240101000000',
      name: 'init',
      statements: ['CREATE TABLE foo();'],
      rollback: ['DROP TABLE foo;'],
    });

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ version: '20240101000000', name: 'init' });
    expect(migrationsMock.getMigration).toHaveBeenCalledWith('ref123', '20240101000000');
  });

  it('404 — no such migration version (distinct from a missing project)', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.getMigration.mockResolvedValue(null);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('400 — version param format invalid', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations/not-a-version',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_version_format' });
    expect(migrationsMock.getMigration).not.toHaveBeenCalled();
  });

  it('409 — instance not running', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.getMigration.mockRejectedValue(
      new perInstancePgMock.InstanceNotRunningError('paused'),
    );

    const res = await app.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token' },
    });

    expect(res.statusCode).toBe(409);
    expect(res.json()).toMatchObject({ code: 'project_not_running' });
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'GET',
      url: '/projects/ref123/database/migrations/20240101000000',
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
  });
});

describe('PATCH /projects/:ref/database/migrations/:version', () => {
  let app: FastifyInstance;

  beforeEach(async () => {
    vi.clearAllMocks();
    app = await buildApp();
  });

  it('200 — patches name and rollback', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.patchMigration.mockResolvedValue({
      version: '20240101000000',
      name: 'create_widgets_table',
      statements: null,
      rollback: ['drop table if exists public.widgets;'],
    });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: {
        name: 'create_widgets_table',
        rollback: 'drop table if exists public.widgets;',
      },
    });

    expect(res.statusCode).toBe(200);
    expect(migrationsMock.patchMigration).toHaveBeenCalledWith('ref123', '20240101000000', {
      name: 'create_widgets_table',
      rollback: 'drop table if exists public.widgets;',
    });
  });

  it('200 — a name-only patch does not carry a rollback key through', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.patchMigration.mockResolvedValue({ version: '20240101000000', name: 'renamed' });

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { name: 'renamed' },
    });

    expect(res.statusCode).toBe(200);
    // An absent key must stay absent — the service distinguishes "omitted" from
    // "explicitly null", and a stray `rollback: undefined` would blank the column.
    const patch = migrationsMock.patchMigration.mock.calls[0]![2] as Record<string, unknown>;
    expect(Object.prototype.hasOwnProperty.call(patch, 'rollback')).toBe(false);
  });

  it('400 — unknown field is rejected, not silently ignored', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { nmae: 'typo' },
    });

    expect(res.statusCode).toBe(400);
    expect(migrationsMock.patchMigration).not.toHaveBeenCalled();
  });

  it('404 — no such migration version', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);
    migrationsMock.patchMigration.mockResolvedValue(null);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { name: 'x' },
    });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toMatchObject({ code: 'not_found' });
  });

  it('400 — version param format invalid', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(FAKE_INST);

    const res = await app.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/nope',
      headers: { authorization: 'Bearer token', 'content-type': 'application/json' },
      payload: { name: 'x' },
    });

    expect(res.statusCode).toBe(400);
    expect(res.json()).toMatchObject({ code: 'invalid_version_format' });
  });

  it('401 — unauthenticated', async () => {
    const unauthApp = await buildApp(false);
    const res = await unauthApp.inject({
      method: 'PATCH',
      url: '/projects/ref123/database/migrations/20240101000000',
      headers: { 'content-type': 'application/json' },
      payload: { name: 'x' },
    });
    expect(res.statusCode).toBe(401);
    await unauthApp.close();
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
