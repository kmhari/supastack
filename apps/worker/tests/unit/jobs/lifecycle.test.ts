/**
 * T045 — lifecycle (pause/resume/restart/delete/upgrade).
 *
 * Mocks docker-control, db, fetch, fs.rm, backup-enqueue.
 * Asserts each action invokes the right docker-control verb and updates
 * status accordingly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dockerCalls: string[] = [];
const statusUpdates: Array<Record<string, unknown>> = [];
let storedInstance: { ref: string; status: string; supabaseVersion?: string } | null = null;
const releasedPorts: string[] = [];
const fetchCalls: Array<{ url: string; method: string }> = [];
let deletedRowRef: string | null = null;

vi.mock('@supastack/docker-control', () => ({
  composeAllHealthy: vi.fn(async () => {
    dockerCalls.push('composeAllHealthy');
    return true;
  }),
  composeDown: vi.fn(async () => {
    dockerCalls.push('composeDown');
  }),
  composePull: vi.fn(async () => {
    dockerCalls.push('composePull');
  }),
  composeRestart: vi.fn(async () => {
    dockerCalls.push('composeRestart');
  }),
  composeStart: vi.fn(async () => {
    dockerCalls.push('composeStart');
  }),
  composeStop: vi.fn(async () => {
    dockerCalls.push('composeStop');
  }),
  composeUp: vi.fn(async () => {
    dockerCalls.push('composeUp');
  }),
}));

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => (storedInstance ? [storedInstance] : []),
        }),
      }),
    }),
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          statusUpdates.push(vals);
          if (storedInstance) Object.assign(storedInstance, vals);
        },
      }),
    }),
    delete: () => ({
      where: async () => {
        deletedRowRef = storedInstance?.ref ?? null;
      },
    }),
  }),
  schema: {
    supabaseInstances: { ref: 'ref', status: 'status' },
  },
  releasePortsForInstance: vi.fn(async (_db: unknown, ref: string) => {
    releasedPorts.push(ref);
  }),
}));

vi.mock('drizzle-orm', () => ({
  eq: (..._args: unknown[]) => ({ kind: 'eq' }),
}));

vi.mock('node:fs', () => ({
  promises: { rm: vi.fn(async () => undefined) },
}));

vi.mock('../../../src/jobs/backup-enqueue.js', () => ({
  enqueueBackup: vi.fn(async () => undefined),
}));

vi.stubGlobal(
  'fetch',
  vi.fn(async (url: string, init?: { method?: string }) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? 'GET' });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }),
);

import { handleLifecycle } from '../../../src/jobs/lifecycle.js';

const ref = 'r0000000000000000001';

describe('handleLifecycle', () => {
  beforeEach(() => {
    dockerCalls.length = 0;
    statusUpdates.length = 0;
    releasedPorts.length = 0;
    fetchCalls.length = 0;
    deletedRowRef = null;
    storedInstance = { ref, status: 'running' };
  });

  it('pause → composeStop + status=paused', async () => {
    await handleLifecycle('pause', { ref });
    expect(dockerCalls).toContain('composeStop');
    expect(statusUpdates.at(-1)?.status).toBe('paused');
  });

  it('resume → composeStart + waitHealthy + status=running', async () => {
    storedInstance!.status = 'paused';
    await handleLifecycle('resume', { ref });
    expect(dockerCalls).toContain('composeStart');
    expect(dockerCalls).toContain('composeAllHealthy');
    expect(statusUpdates.at(-1)?.status).toBe('running');
  });

  it('restart → composeRestart + waitHealthy + status=running', async () => {
    await handleLifecycle('restart', { ref });
    expect(dockerCalls).toContain('composeRestart');
    expect(statusUpdates.at(-1)?.status).toBe('running');
  });

  it('delete → composeDown(removeVolumes) + releasePorts + row removed', async () => {
    await handleLifecycle('delete', { ref });
    expect(dockerCalls).toContain('composeDown');
    expect(releasedPorts).toContain(ref);
    expect(deletedRowRef).toBe(ref);
  });

  it('upgrade → pull + up + supabaseVersion stored', async () => {
    await handleLifecycle('upgrade', { ref, supabaseVersion: 'v15.4.0', backupFirst: false });
    expect(dockerCalls).toContain('composePull');
    expect(dockerCalls).toContain('composeUp');
    expect(statusUpdates.at(-1)?.supabaseVersion).toBe('v15.4.0');
  });

  it('upgrade with backupFirst=true enqueues backup', async () => {
    const { enqueueBackup } = await import('../../../src/jobs/backup-enqueue.js');
    await handleLifecycle('upgrade', { ref, supabaseVersion: 'v15.4.0', backupFirst: true });
    expect(enqueueBackup).toHaveBeenCalledWith(ref, 'manual');
  });

  it('missing instance row → no-op (no docker calls)', async () => {
    storedInstance = null;
    await handleLifecycle('pause', { ref });
    expect(dockerCalls).toHaveLength(0);
  });
});
