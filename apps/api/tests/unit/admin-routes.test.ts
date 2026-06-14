/**
 * Feature 116 — admin ops console endpoint tests. Happy (admin 200 + shapes) +
 * sad (non-admin 403; empty source → graceful empty, not 500; no job payload
 * leaked). db() + the queue/logs services are mocked; no live infra.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';

// queue-based db mock: each db().select() resolves to the next pushed result set.
let dbResults: unknown[][] = [];
vi.mock('@supastack/db', () => {
  const chain = () => {
    const rows = dbResults.shift() ?? [];
    const settle = () => Promise.resolve(rows);
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      orderBy: () => obj,
      limit: () => settle(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        settle().then(res, rej),
    };
    return obj;
  };
  const col = {};
  return {
    db: () => ({ select: () => chain() }),
    schema: {
      installation: { apexDomain: col },
      supabaseInstances: {
        ref: col,
        name: col,
        orgId: col,
        status: col,
        createdAt: col,
        supabaseVersion: col,
      },
      organizations: { id: col, name: col },
      controlPlaneSnapshots: { container: col, capturedAt: col },
      resourceSamples: { capturedAt: col, ref: col, scope: col },
      wildcardCerts: { apex: col },
      pgEdgeCerts: { instanceRef: col },
      backups: { instanceRef: col, completedAt: col },
    },
  };
});

const inspectQueues = vi.fn();
vi.mock('../../src/services/queue-inspector.js', () => ({ inspectQueues: () => inspectQueues() }));
vi.mock('../../src/services/logflare-client.js', () => ({ queryLogs: vi.fn(async () => []) }));

const { adminRoutes } = await import('../../src/routes/admin.js');

async function buildApp(opts: { admin: boolean }): Promise<FastifyInstance> {
  const app = Fastify();
  app.decorate('requireAuth', () => ({ id: 'u1', email: 'op@x.com', role: 'owner' as const }));
  app.decorate('authorize', () => {
    if (!opts.admin) {
      const e = new Error('Forbidden') as Error & { statusCode: number };
      e.statusCode = 403;
      throw e;
    }
  });
  await app.register(adminRoutes, { prefix: '/api/v1' });
  return app;
}

beforeEach(() => {
  dbResults = [];
  inspectQueues.mockReset();
  process.env.SUPASTACK_APEX = 'supaviser.dev'; // feature 117 — apexOf reads env now
});
afterEach(() => {
  delete process.env.SUPASTACK_APEX;
});

describe('admin auth gate (FR-009)', () => {
  it('non-admin → 403 on /admin/fleet', async () => {
    const app = await buildApp({ admin: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fleet' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
  it('non-admin → 403 on /admin/queues', async () => {
    const app = await buildApp({ admin: false });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/queues' });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /admin/fleet', () => {
  it('lists installation-wide projects with org name + api endpoint', async () => {
    dbResults = [
      [
        {
          ref: 'aaaaaaaaaaaaaaaaaaaa',
          name: 'demo',
          orgId: 'org1',
          status: 'running',
          createdAt: new Date('2026-06-08'),
        },
      ],
      [{ id: 'org1', name: 'Acme' }],
    ];
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/fleet' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.projects[0]).toMatchObject({
      ref: 'aaaaaaaaaaaaaaaaaaaa',
      org: 'Acme',
      status: 'running',
      endpoints: { api: 'https://aaaaaaaaaaaaaaaaaaaa.supaviser.dev' },
    });
    await app.close();
  });
});

describe('GET /admin/projects/:ref (health derivation — field-mismatch regression)', () => {
  it('running project → every service healthy:true + database ACTIVE_HEALTHY', async () => {
    dbResults = [[{ ref: 'aaaaaaaaaaaaaaaaaaaa', status: 'running', version: '2026.05.01' }]];
    const app = await buildApp({ admin: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/projects/aaaaaaaaaaaaaaaaaaaa',
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // regression: the page reads `healthy` (not the platform's `status` field),
    // so every service object MUST carry a boolean `healthy`.
    expect(body.services.length).toBeGreaterThan(0);
    expect(body.services.every((s: { healthy: boolean }) => s.healthy === true)).toBe(true);
    expect(body.database.status).toBe('ACTIVE_HEALTHY');
  });

  it('paused project → every service healthy:false + database UNAVAILABLE', async () => {
    dbResults = [[{ ref: 'aaaaaaaaaaaaaaaaaaaa', status: 'paused', version: '2026.05.01' }]];
    const app = await buildApp({ admin: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/projects/aaaaaaaaaaaaaaaaaaaa',
    });
    const body = res.json();
    expect(body.services.every((s: { healthy: boolean }) => s.healthy === false)).toBe(true);
    expect(body.database.status).toBe('UNAVAILABLE');
  });

  it('unknown ref → 404', async () => {
    dbResults = [[]];
    const app = await buildApp({ admin: true });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/projects/zzzzzzzzzzzzzzzzzzzz',
    });
    expect(res.statusCode).toBe(404);
    await app.close();
  });

  it('non-admin → 403', async () => {
    const app = await buildApp({ admin: false });
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/projects/aaaaaaaaaaaaaaaaaaaa',
    });
    expect(res.statusCode).toBe(403);
    await app.close();
  });
});

describe('GET /admin/system (graceful empty)', () => {
  it('returns empty components + version when no snapshots (FR-030)', async () => {
    dbResults = [[]]; // controlPlaneSnapshots empty
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/system' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ components: [], capturedAt: null });
    await app.close();
  });
});

describe('GET /admin/resources', () => {
  it('returns collecting:true when no samples (FR-019)', async () => {
    dbResults = [[]]; // latest sample query empty
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/resources' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ capturedAt: null, collecting: true });
    await app.close();
  });

  it('returns host + per-project + avg footprint, NO "N more" field', async () => {
    const ts = new Date('2026-06-10T00:00:00Z');
    dbResults = [
      [{ capturedAt: ts }], // latest
      [
        {
          scope: 'host',
          ref: null,
          cpuPct: '40',
          memUsedBytes: 1000,
          memLimitBytes: 8000,
          diskBreakdown: { projectData: 1, backups: 2, other: 3, free: 4 },
          capturedAt: ts,
        },
        {
          scope: 'project',
          ref: 'aaaaaaaaaaaaaaaaaaaa',
          cpuPct: '4',
          memUsedBytes: 100,
          diskUsedBytes: 50,
          capturedAt: ts,
        },
      ],
    ];
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/resources' });
    const body = res.json();
    expect(body.host.cpuPct).toBe(40);
    expect(body.host.disk).toMatchObject({ projectData: 1 });
    expect(body.projects).toHaveLength(1);
    expect(body.avgProjectFootprint).toEqual({ memUsedBytes: 100, diskUsedBytes: 50 });
    expect(JSON.stringify(body)).not.toMatch(/more projects|nMore|fitMore/i);
    await app.close();
  });
});

describe('GET /admin/queues', () => {
  it('returns counts + redacted failures, never a job payload (FR-022)', async () => {
    inspectQueues.mockResolvedValue([
      {
        name: 'provision',
        counts: { waiting: 0, active: 1, failed: 1, delayed: 0, completed: 9 },
        recentFailures: [
          {
            id: '7',
            name: 'provision',
            failedReason: 'db [REDACTED] timeout',
            failedAt: '2026-06-10T00:00:00Z',
            attemptsMade: 3,
          },
        ],
      },
    ]);
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/queues' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.queues[0].counts.failed).toBe(1);
    expect(body.queues[0].recentFailures[0].failedReason).toContain('[REDACTED]');
    expect(JSON.stringify(body)).not.toContain('"data"');
    await app.close();
  });

  it('degrades to empty queues when the inspector throws (FR-030)', async () => {
    inspectQueues.mockRejectedValue(new Error('redis down'));
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/queues' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ queues: [] });
    await app.close();
  });
});

describe('GET /admin/certs (graceful)', () => {
  it('returns null wildcard + empty lists when nothing is provisioned', async () => {
    delete process.env.SUPASTACK_APEX; // no apex configured → wildcard null
    dbResults = [
      [], // wildcardCerts
      [], // pgEdgeCerts
      [], // backups
    ];
    const app = await buildApp({ admin: true });
    const res = await app.inject({ method: 'GET', url: '/api/v1/admin/certs' });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.wildcard).toBeNull();
    expect(body.perProject).toEqual([]);
    expect(body.backups.totalStorageBytes).toBe(0);
    expect(body.dns).toEqual({ apexReady: false, wildcardReady: false });
    await app.close();
  });
});
