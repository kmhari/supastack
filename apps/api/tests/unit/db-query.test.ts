import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * T008 — route-level tests for POST /v1/projects/:ref/database/query.
 * Uses in-process Fastify (app.inject), mocking @selfbase/db, project-store,
 * and per-instance-pg so no real PG connection is opened.
 */

// ─── Mocks (must be declared before importing the route) ────────────────────

const auditInserts: Array<{ action: string; targetId: string; payload: unknown }> = [];

vi.mock('@selfbase/db', () => ({
  db: () => ({
    insert: () => ({
      values: async (vals: { action: string; targetId: string; payload: unknown }) => {
        auditInserts.push({ action: vals.action, targetId: vals.targetId, payload: vals.payload });
      },
    }),
  }),
  schema: { auditLog: {} },
}));

const projectStoreMock = vi.hoisted(() => ({
  getProjectByRef: vi.fn(),
}));
vi.mock('../../src/services/project-store.js', () => projectStoreMock);

const perInstancePgMock = vi.hoisted(() => ({
  withPerInstancePg: vi.fn(),
  InstanceNotFoundError: class InstanceNotFoundError extends Error {
    code = 'instance_not_found' as const;
  },
  InstanceNotRunningError: class InstanceNotRunningError extends Error {
    code = 'instance_not_running' as const;
    constructor(public readonly status: string) {
      super(`status ${status}`);
    }
  },
  PerInstancePgConnectError: class PerInstancePgConnectError extends Error {
    code = 'per_instance_pg_connect_error' as const;
  },
}));
vi.mock('../../src/services/per-instance-pg.js', () => perInstancePgMock);

// Now safe to import the route + plugin.
const { dbQueryRoutes } = await import('../../src/routes/management/db-query.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@selfbase/shared');

interface FakeUser {
  id: string;
  email: string;
  role: 'admin' | 'member';
  tokenId?: string;
}

async function buildApp(
  opts: {
    user: FakeUser | null;
    authorizeThrows?: boolean;
  } = { user: { id: 'u1', email: 'a@b.c', role: 'admin' } },
): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', (_req: unknown) => {
    if (!opts.user) {
      throw new AppError(401, 'unauthenticated', 'PAT required');
    }
    return opts.user;
  });
  app.decorate('authorize', (_req: unknown, _action: string) => {
    if (opts.authorizeThrows) {
      throw new AppError(403, 'forbidden', 'admin role required');
    }
  });

  await app.register(
    async (mgmt) => {
      await mgmt.register(mgmtApiErrorsPlugin);
      await mgmt.register(dbQueryRoutes);
    },
    { prefix: '/v1' },
  );

  return app;
}

const PROJ = { ref: 'aaaaaaaaaaaaaaaaaaaa', portDbDirect: 54321 };

beforeEach(() => {
  auditInserts.length = 0;
  projectStoreMock.getProjectByRef.mockReset();
  projectStoreMock.getProjectByRef.mockResolvedValue(PROJ);
  perInstancePgMock.withPerInstancePg.mockReset();
});

describe('POST /v1/projects/:ref/database/query', () => {
  it('returns 201 + result rows on a SELECT', async () => {
    perInstancePgMock.withPerInstancePg.mockImplementation(async (_ref, fn) => {
      return fn({
        async query() {
          return { rows: [{ '?column?': 1 }] };
        },
      });
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(201);
    expect(res.json()).toEqual([{ '?column?': 1 }]);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.action).toBe('instance.db.query.executed');
    expect(auditInserts[0]!.payload).toMatchObject({
      ref: PROJ.ref,
      query: 'SELECT 1',
      row_count: 1,
    });
  });

  it('passes parameters through to pg.client.query', async () => {
    let receivedSql: string | null = null;
    let receivedParams: unknown[] | undefined;
    perInstancePgMock.withPerInstancePg.mockImplementation(async (_ref, fn) => {
      return fn({
        async query(sql: string, params?: unknown[]) {
          receivedSql = sql;
          receivedParams = params;
          return { rows: [{ x: 42 }] };
        },
      });
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT $1::int as x', parameters: [42] },
    });
    expect(res.statusCode).toBe(201);
    expect(receivedSql).toBe('SELECT $1::int as x');
    expect(receivedParams).toEqual([42]);
  });

  it('propagates readOnly option to withPerInstancePg', async () => {
    let receivedOpts: unknown = null;
    perInstancePgMock.withPerInstancePg.mockImplementation(async (_ref, fn, opts) => {
      receivedOpts = opts;
      return fn({
        async query() {
          return { rows: [] };
        },
      });
    });
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1', read_only: true },
    });
    expect(receivedOpts).toMatchObject({ readOnly: true, timeoutMs: null });
  });

  it('returns 400 read_only_violation on SQLSTATE 25006', async () => {
    perInstancePgMock.withPerInstancePg.mockImplementation(async () => {
      const err = new Error('cannot execute INSERT in a read-only transaction') as Error & {
        code: string;
        severity: string;
      };
      err.code = '25006';
      err.severity = 'ERROR';
      throw err;
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'INSERT INTO t VALUES (1)', read_only: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('read_only_violation');
    expect(auditInserts[0]!.action).toBe('instance.db.query.failed');
  });

  it('returns 400 pg_error on malformed SQL with SQLSTATE details', async () => {
    perInstancePgMock.withPerInstancePg.mockImplementation(async () => {
      const err = new Error('relation "nope" does not exist') as Error & {
        code: string;
        severity: string;
        position: string;
      };
      err.code = '42P01';
      err.severity = 'ERROR';
      err.position = '15';
      throw err;
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT * FROM nope' },
    });
    expect(res.statusCode).toBe(400);
    const body = res.json();
    expect(body.code).toBe('pg_error');
    expect(body.details).toMatchObject({ severity: 'ERROR', code: '42P01', position: '15' });
  });

  it('returns 400 multi_statement_not_supported for SELECT 1; SELECT 2', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1; SELECT 2' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('multi_statement_not_supported');
    expect(auditInserts[0]!.action).toBe('instance.db.query.failed');
    expect(auditInserts[0]!.payload).toMatchObject({ error_code: 'multi_statement_not_supported' });
  });

  it('returns 401 when no auth (no audit emitted)', async () => {
    const app = await buildApp({ user: null });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(401);
    expect(auditInserts).toHaveLength(0);
  });

  it('returns 403 for member role + audits the denial', async () => {
    const app = await buildApp({
      user: { id: 'u1', email: 'm@b.c', role: 'member' },
      authorizeThrows: true,
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(403);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.payload).toMatchObject({ error_code: 'forbidden' });
  });

  it('returns 404 when project not visible to user', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().code).toBe('not_found');
  });

  it('returns 409 project_not_runnable when InstanceNotRunningError', async () => {
    perInstancePgMock.withPerInstancePg.mockImplementation(async () => {
      throw new perInstancePgMock.InstanceNotRunningError('paused');
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1' },
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project_not_runnable');
    expect(res.json().details).toEqual({ status: 'paused' });
  });

  it('returns 400 invalid_params on empty body', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: {},
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_params');
    expect(auditInserts[0]!.action).toBe('instance.db.query.failed');
  });

  it('truncates large parameters in audit log payload', async () => {
    perInstancePgMock.withPerInstancePg.mockImplementation(async (_ref, fn) => {
      return fn({
        async query() {
          return { rows: [] };
        },
      });
    });
    const bigParam = 'x'.repeat(500);
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/query`,
      payload: { query: 'SELECT 1', parameters: [bigParam, 'short'] },
    });
    const payload = auditInserts[0]!.payload as { parameters: unknown[] };
    expect(payload.parameters[0]).toMatchObject({ truncated: true, original_size: 500 });
    expect(payload.parameters[1]).toBe('short');
  });
});
