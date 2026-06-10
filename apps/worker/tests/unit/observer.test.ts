/**
 * Feature 116 (T007) — worker observer sampler unit tests. Fake docker/disk
 * deps + a recording db() mock; no live docker/DB. Covers per-project
 * aggregation, host disk breakdown, control-plane snapshot upsert + log-tail
 * redaction, prune, and the non-blocking / one-shot guarantee (FR-020).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { readFileSync } from 'node:fs';
import type { ObserverDeps } from '../../src/jobs/observer.js';

// ── recording db() mock ──────────────────────────────────────────────────────
const inserted: Record<string, unknown>[] = [];
const upserted: { values: Record<string, unknown>; set: Record<string, unknown> }[] = [];
let deleteCalls = 0;

vi.mock('@supastack/db', () => {
  const table = (name: string) => ({ __table: name, capturedAt: 'captured_at', container: 'container' });
  return {
    schema: {
      resourceSamples: table('resource_samples'),
      controlPlaneSnapshots: table('control_plane_snapshots'),
    },
    db: () => ({
      insert: () => ({
        values: (rows: Record<string, unknown> | Record<string, unknown>[]) => {
          const builder = {
            onConflictDoUpdate: (cfg: { set: Record<string, unknown> }) => {
              upserted.push({ values: rows as Record<string, unknown>, set: cfg.set });
              return Promise.resolve();
            },
            then: (res: (v: unknown) => unknown) => {
              for (const r of Array.isArray(rows) ? rows : [rows]) inserted.push(r);
              return Promise.resolve().then(res);
            },
          };
          return builder;
        },
      }),
      delete: () => ({
        where: () => {
          deleteCalls++;
          return Promise.resolve();
        },
      }),
    }),
  };
});

vi.mock('drizzle-orm', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return { ...actual, lt: (a: unknown, b: unknown) => ({ __lt: [a, b] }) };
});

const { runObserver, aggregateProjects, hostCpuMem } = await import('../../src/jobs/observer.js');

beforeEach(() => {
  inserted.length = 0;
  upserted.length = 0;
  deleteCalls = 0;
});

function fakeDeps(over: Partial<ObserverDeps> = {}): ObserverDeps {
  const containerStats = vi.fn(async () => [
    { name: 'supastack-aaaaaaaaaaaaaaaaaaaa-auth-1', cpuPct: 1, memUsed: 100, memLimit: 0 },
    { name: 'supastack-aaaaaaaaaaaaaaaaaaaa-db-1', cpuPct: 2, memUsed: 200, memLimit: 0 },
    { name: 'supastack-bbbbbbbbbbbbbbbbbbbb-rest-1', cpuPct: 5, memUsed: 50, memLimit: 0 },
    { name: 'supastack-api-1', cpuPct: 3, memUsed: 10, memLimit: 0 }, // control-plane, not a project
  ]);
  return {
    containerStats,
    hostMemTotal: async () => 8_000_000_000,
    diskBreakdown: async () => ({ projectData: 300, backups: 100, other: 50, free: 900, used: 450 }),
    controlPlane: async () => [
      {
        container: 'supastack-api-1',
        health: 'healthy',
        status: 'Up 1h',
        image: 'supastack/api:dev',
        logTail: 'connect postgres://admin:s3cret@db:5432/postgres failed',
      },
    ],
    now: () => new Date('2026-06-10T00:00:00Z'),
    ...over,
  };
}

describe('aggregateProjects / hostCpuMem (pure)', () => {
  it('groups containers by 20-char ref, summing cpu + mem; ignores control-plane', () => {
    const projects = aggregateProjects([
      { name: 'supastack-aaaaaaaaaaaaaaaaaaaa-auth-1', cpuPct: 1, memUsed: 100, memLimit: 0 },
      { name: 'supastack-aaaaaaaaaaaaaaaaaaaa-db-1', cpuPct: 2, memUsed: 200, memLimit: 0 },
      { name: 'supastack-api-1', cpuPct: 9, memUsed: 9, memLimit: 0 },
    ]);
    expect(projects).toEqual([{ ref: 'aaaaaaaaaaaaaaaaaaaa', cpuPct: 3, memUsed: 300 }]);
  });
  it('host totals sum across all containers', () => {
    expect(hostCpuMem([
      { name: 'x', cpuPct: 1.5, memUsed: 10, memLimit: 0 },
      { name: 'y', cpuPct: 2.5, memUsed: 20, memLimit: 0 },
    ])).toEqual({ cpuPct: 4, memUsed: 30 });
  });
});

describe('runObserver', () => {
  it('writes one host row + one row per project, samples one-shot', async () => {
    const deps = fakeDeps();
    await runObserver(deps, { retentionDays: 7 });

    const host = inserted.filter((r) => r.scope === 'host');
    const projects = inserted.filter((r) => r.scope === 'project');
    expect(host).toHaveLength(1);
    expect(host[0].memLimitBytes).toBe(8_000_000_000);
    expect(host[0].diskBreakdown).toMatchObject({ projectData: 300, backups: 100 });
    expect(projects.map((r) => r.ref).sort()).toEqual([
      'aaaaaaaaaaaaaaaaaaaa',
      'bbbbbbbbbbbbbbbbbbbb',
    ]);
    // project aaaa = auth(1)+db(2) cpu = 3, mem = 300
    const a = projects.find((r) => r.ref === 'aaaaaaaaaaaaaaaaaaaa')!;
    expect(a.cpuPct).toBe('3');
    expect(a.memUsedBytes).toBe(300);
    // one-shot: stats gathered exactly once per tick (no streaming loop) — FR-020
    expect((deps.containerStats as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it('upserts control-plane snapshots with the log tail redacted', async () => {
    await runObserver(fakeDeps(), { retentionDays: 7 });
    expect(upserted).toHaveLength(1);
    expect(upserted[0].values.container).toBe('supastack-api-1');
    expect(upserted[0].values.logTail).toContain('[REDACTED]');
    expect(upserted[0].values.logTail).not.toContain('s3cret');
    expect(upserted[0].set.health).toBe('healthy');
  });

  it('prunes old samples each tick', async () => {
    await runObserver(fakeDeps(), { retentionDays: 7 });
    expect(deleteCalls).toBe(1);
  });

  it('does not throw when there are no projects/containers (sad path)', async () => {
    const deps = fakeDeps({
      containerStats: async () => [],
      controlPlane: async () => [],
    });
    await expect(runObserver(deps, { retentionDays: 7 })).resolves.toBeUndefined();
    expect(inserted.filter((r) => r.scope === 'host')).toHaveLength(1); // host row still written
    expect(deleteCalls).toBe(1);
  });
});

describe('FR-020 — sampling is one-shot / non-blocking', () => {
  it('real deps use docker stats stream:false (no streaming connection held open)', () => {
    const src = readFileSync(new URL('../../src/jobs/observer.ts', import.meta.url), 'utf8');
    expect(src).toContain('stream: false');
    expect(src).not.toMatch(/stream:\s*true/);
  });
});
