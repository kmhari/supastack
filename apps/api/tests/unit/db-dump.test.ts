import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * T015 — route-level tests for POST /v1/projects/:ref/database/dump.
 * Mocks @selfbase/db, project-store, per-instance-pg, and pg-dump-exec so
 * no real PG or Docker socket is touched.
 */

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

const pgDumpExecMock = vi.hoisted(() => ({
  streamPgDump: vi.fn(),
  PgDumpFailedError: class PgDumpFailedError extends Error {
    code = 'pg_dump_failed' as const;
    constructor(
      public readonly exitCode: number,
      public readonly stderr: string,
    ) {
      super(`pg_dump exited ${exitCode}: ${stderr}`);
    }
  },
  DockerExecFailedError: class DockerExecFailedError extends Error {
    code = 'docker_exec_failed' as const;
  },
}));
vi.mock('../../src/services/pg-dump-exec.js', () => pgDumpExecMock);

const { dbDumpRoutes } = await import('../../src/routes/management/db-dump.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@selfbase/shared');

async function buildApp(opts: {
  user?: { id: string; email: string; role: 'admin' | 'member' } | null;
  authorizeThrows?: boolean;
} = {}): Promise<FastifyInstance> {
  const user = opts.user === undefined ? { id: 'u1', email: 'a@b.c', role: 'admin' as const } : opts.user;
  const app = Fastify();
  app.decorate('requireAuth', () => {
    if (!user) throw new AppError(401, 'unauthenticated', 'PAT required');
    return user;
  });
  app.decorate('authorize', () => {
    if (opts.authorizeThrows) throw new AppError(403, 'forbidden', 'admin role required');
  });
  await app.register(async (mgmt) => {
    await mgmt.register(mgmtApiErrorsPlugin);
    await mgmt.register(dbDumpRoutes);
  }, { prefix: '/v1' });
  return app;
}

const PROJ = { ref: 'aaaaaaaaaaaaaaaaaaaa' };

beforeEach(() => {
  auditInserts.length = 0;
  projectStoreMock.getProjectByRef.mockReset();
  projectStoreMock.getProjectByRef.mockResolvedValue(PROJ);
  perInstancePgMock.withPerInstancePg.mockReset();
  pgDumpExecMock.streamPgDump.mockReset();
  // Default schemas enumeration returns 2 schemas.
  perInstancePgMock.withPerInstancePg.mockImplementation(async (_ref, fn) => {
    return fn({
      async query() {
        return { rows: [{ nspname: 'public' }, { nspname: 'auth' }] };
      },
    });
  });
});

describe('POST /v1/projects/:ref/database/dump', () => {
  it('returns 201 + dry_run JSON summary when dry_run: true', async () => {
    pgDumpExecMock.streamPgDump.mockImplementation(async (_ref, _flags, output) => {
      output.write(Buffer.from('-- 100 bytes of dump output'));
      output.end();
      return { exitCode: 0, bytesWritten: 27, aborted: false };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: { dry_run: true },
    });
    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(body).toMatchObject({
      dry_run: true,
      schemas_dumped: ['public', 'auth'],
    });
    expect(body.bytes_estimated).toBeGreaterThan(0);
    expect(auditInserts).toHaveLength(1);
    expect(auditInserts[0]!.action).toBe('instance.db.dump');
    expect(auditInserts[0]!.payload).toMatchObject({ dry_run: true });
  });

  it('streams dump bytes to response on non-dry-run', async () => {
    pgDumpExecMock.streamPgDump.mockImplementation(async (_ref, _flags, output) => {
      output.write(Buffer.from('-- dump start\n'));
      output.write(Buffer.from('INSERT INTO t VALUES (1);\n'));
      output.end();
      return { exitCode: 0, bytesWritten: 40, aborted: false };
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: {},
    });
    expect(res.statusCode).toBe(201);
    expect(res.headers['content-type']).toContain('application/octet-stream');
    expect(res.body).toContain('INSERT INTO t');
  });

  it('returns 400 invalid_params when data_only AND schema_only', async () => {
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: { data_only: true, schema_only: true },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('invalid_params');
  });

  it('returns 403 for member role', async () => {
    const app = await buildApp({ authorizeThrows: true });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: { dry_run: true },
    });
    expect(res.statusCode).toBe(403);
  });

  it('returns 502 pg_dump_failed when streamPgDump throws PgDumpFailedError (dry_run path)', async () => {
    pgDumpExecMock.streamPgDump.mockImplementation(async () => {
      throw new pgDumpExecMock.PgDumpFailedError(1, 'pg_dump: error: connection failed');
    });
    const app = await buildApp();
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: { dry_run: true },
    });
    expect(res.statusCode).toBe(502);
    expect(res.json().code).toBe('pg_dump_failed');
    expect(res.json().details).toMatchObject({ exit_code: 1 });
  });

  it('passes user-supplied schemas through to streamPgDump', async () => {
    let receivedSchemas: string[] | undefined;
    pgDumpExecMock.streamPgDump.mockImplementation(async (_ref, flags, output) => {
      receivedSchemas = flags.schemas;
      output.end();
      return { exitCode: 0, bytesWritten: 0, aborted: false };
    });
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: { dry_run: true, schemas: ['public', 'storage'] },
    });
    expect(receivedSchemas).toEqual(['public', 'storage']);
  });

  it('does NOT audit when aborted mid-stream', async () => {
    pgDumpExecMock.streamPgDump.mockImplementation(async (_ref, _flags, output) => {
      output.write(Buffer.from('partial'));
      output.end();
      return { exitCode: -1, bytesWritten: 7, aborted: true };
    });
    const app = await buildApp();
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${PROJ.ref}/database/dump`,
      payload: {},
    });
    expect(auditInserts).toHaveLength(0);
  });
});
