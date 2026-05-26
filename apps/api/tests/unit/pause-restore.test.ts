import { describe, expect, it, beforeEach, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

/**
 * T066 — route-level tests for POST /v1/projects/:ref/{pause,restore}.
 */

const projectStoreMock = vi.hoisted(() => ({ getProjectByRef: vi.fn() }));
vi.mock('../../src/services/project-store.js', () => projectStoreMock);

const queueMock = vi.hoisted(() => ({ add: vi.fn() }));
vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => queueMock),
}));
vi.mock('ioredis', () => ({
  Redis: vi.fn().mockImplementation(() => ({})),
}));

const dbUpdates: Array<Record<string, unknown>> = [];
const dbInserts: Array<{ action: string; payload?: unknown }> = [];
const backupStore = { row: null as null | { id: string } };

vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (backupStore.row ? [backupStore.row] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          dbUpdates.push(vals);
        },
      }),
    }),
    insert: () => ({
      values: async (vals: { action: string; payload?: unknown }) => {
        dbInserts.push({ action: vals.action, payload: vals.payload });
      },
    }),
  }),
  schema: {
    supabaseInstances: { ref: 'ref' },
    backups: { instanceRef: 'r', status: 's', id: 'id' },
    auditLog: {},
  },
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}), and: () => ({}) }));

vi.mock('../../src/services/mgmt-api-mapping.js', () => ({
  instanceToProject: (row: { ref: string; status: string }) => ({
    id: row.ref,
    ref: row.ref,
    name: 'test',
    organization_id: 'org',
    region: 'selfbase',
    created_at: '2026-01-01T00:00:00Z',
    status:
      row.status === 'running'
        ? 'ACTIVE_HEALTHY'
        : row.status === 'paused'
          ? 'INACTIVE'
          : row.status === 'provisioning'
            ? 'COMING_UP'
            : 'UNKNOWN',
  }),
}));

vi.mock('@selfbase/shared', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, logger: { warn: () => {}, info: () => {}, error: () => {} } };
});

const { pauseRestoreRoutes } = await import('../../src/routes/management/pause-restore.js');
const { mgmtApiErrorsPlugin } = await import('../../src/plugins/mgmt-api-errors.js');
const { AppError } = await import('@selfbase/shared');

const REF = 'aaaaaaaaaaaaaaaaaaaa';

async function buildApp(opts: { authorizeThrows?: boolean } = {}): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'a@b.c', role: 'admin' as const }));
  app.decorate('authorize', () => {
    if (opts.authorizeThrows) throw new AppError(403, 'forbidden', 'admin required');
  });
  await app.register(
    async (mgmt) => {
      await mgmt.register(mgmtApiErrorsPlugin);
      await mgmt.register(pauseRestoreRoutes);
    },
    { prefix: '/v1' },
  );
  return app;
}

beforeEach(() => {
  projectStoreMock.getProjectByRef.mockReset();
  queueMock.add.mockReset();
  dbUpdates.length = 0;
  dbInserts.length = 0;
  backupStore.row = null;
});

describe('POST /v1/projects/:ref/pause', () => {
  it('running project → 200 + status INACTIVE; worker enqueued; audit', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'running' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('INACTIVE');
    expect(queueMock.add).toHaveBeenCalledWith('pause', { ref: REF }, expect.anything());
    expect(dbUpdates[0]).toMatchObject({ status: 'paused' });
    expect(dbInserts.find((i) => i.action === 'instance.pause')).toBeDefined();
  });

  it('already-paused → 200 + INACTIVE; no worker enqueue (idempotent)', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'paused' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('INACTIVE');
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('backup in progress → 409 backup_in_progress', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'running' });
    backupStore.row = { id: 'b1' };
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('backup_in_progress');
    expect(queueMock.add).not.toHaveBeenCalled();
    expect(dbUpdates).toHaveLength(0);
  });

  it('unknown ref → 404', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(404);
  });

  it('member role lacking instance.pause → 403', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'running' });
    const app = await buildApp({ authorizeThrows: true });
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(403);
  });

  it('non-runnable status → 409 project_not_runnable', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'deleting' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/pause` });
    expect(res.statusCode).toBe(409);
    expect(res.json().code).toBe('project_not_runnable');
  });
});

describe('POST /v1/projects/:ref/restore', () => {
  it('paused project → 200 + status COMING_UP; worker enqueued', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'paused' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('COMING_UP');
    expect(queueMock.add).toHaveBeenCalledWith('resume', { ref: REF }, expect.anything());
    expect(dbUpdates[0]).toMatchObject({ status: 'provisioning' });
    expect(dbInserts.find((i) => i.action === 'instance.resume')).toBeDefined();
  });

  it('already-running → 200 + ACTIVE_HEALTHY; no worker enqueue (idempotent)', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'running' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/restore` });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('ACTIVE_HEALTHY');
    expect(queueMock.add).not.toHaveBeenCalled();
  });

  it('non-restorable status → 409', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue({ ref: REF, status: 'failed' });
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/restore` });
    expect(res.statusCode).toBe(409);
  });

  it('unknown ref → 404', async () => {
    projectStoreMock.getProjectByRef.mockResolvedValue(null);
    const app = await buildApp();
    const res = await app.inject({ method: 'POST', url: `/v1/projects/${REF}/restore` });
    expect(res.statusCode).toBe(404);
  });
});
