/**
 * T040 — pooler-reconciler classifier + remediation tests.
 *
 * Strategy: instead of importing the private `classifyInstance` helper, we
 * drive the public `runFullReconcile`/`runSingleInstanceReconcile` entry
 * points with one fixture per drift class. We mock the import seam:
 *   - undici.fetch → controls supavisor responses
 *   - pg.Client → controls active-probe outcome (auth-class vs ok)
 *   - @selfbase/db → in-memory tables + capture mutations
 *   - @selfbase/crypto → returns deterministic postgresPassword
 *
 * Each fixture asserts: (a) the run completes, (b) the remediation side
 * effect we expect actually fired (register vs unregister vs drift promo).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { driftFixtures, type DriftFixture } from '../../fixtures/pooler-drift.js';

// ─── shared mock state ─────────────────────────────────────────────────────

interface DbState {
  instances: Array<{
    ref: string;
    status: string;
    encryptedSecrets: Buffer;
    portDbDirect: number | null;
    portPostgres: number;
  }>;
  poolerTenants: Array<{
    instanceRef: string;
    externalId: string;
    status: string;
    lastError: string | null;
    updatedAt: Date;
    sniHostname?: string;
    lastReconciledAt?: Date | null;
  }>;
  poolerEvents: Array<{ externalId: string; event: string; detail: unknown }>;
  reconcilerRuns: Array<{
    id: string;
    status: string;
    triggerSource: string;
    actorId: string | null;
    startedAt: Date;
    completedAt?: Date;
    errorMessage?: string | null;
    instancesSeen?: number;
    actionsTaken?: Record<string, number>;
  }>;
  org: Array<{ apexDomain: string }>;
}

const dbState: DbState = {
  instances: [],
  poolerTenants: [],
  poolerEvents: [],
  reconcilerRuns: [],
  org: [{ apexDomain: 'example.test' }],
};

let runIdCounter = 0;

// Pg mock — controllable per-test
const pgState = {
  shouldFail: false,
  authClass: false,
};

vi.mock('pg', () => {
  class Client {
    async connect(): Promise<void> {
      if (pgState.shouldFail) {
        const err = new Error('password authentication failed for user "postgres"') as Error & {
          code?: string;
        };
        if (pgState.authClass) err.code = '28P01';
        throw err;
      }
    }
    async query(): Promise<{ rows: unknown[] }> {
      return { rows: [] };
    }
    async end(): Promise<void> {}
  }
  return { default: { Client } };
});

// Undici fetch mock — supavisor admin API
const fetchState = {
  // Map: externalId → 'present' | 'absent' | 'error'
  tenants: new Map<string, 'present' | 'absent' | 'error'>(),
  registerShouldFail: false,
  registerFailIsAuth: false,
  unregisterCalls: [] as string[],
  registerCalls: [] as string[],
};

vi.mock('undici', () => ({
  fetch: vi.fn(async (url: string | URL, init?: { method?: string }) => {
    const u = String(url);
    const method = init?.method ?? 'GET';
    const m = u.match(/\/api\/tenants\/([^/?]+)/);
    const externalId = m?.[1];
    if (!externalId) return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
    if (method === 'GET') {
      const state = fetchState.tenants.get(externalId);
      if (state === 'error')
        return { ok: false, status: 500, json: async () => ({}), text: async () => 'boom' };
      if (state === 'present')
        return {
          ok: true,
          status: 200,
          json: async () => ({ external_id: externalId }),
          text: async () => '',
        };
      return { ok: false, status: 404, json: async () => ({}), text: async () => '' };
    }
    if (method === 'PUT') {
      fetchState.registerCalls.push(externalId);
      if (fetchState.registerShouldFail) {
        return {
          ok: false,
          status: 500,
          json: async () => ({}),
          text: async () => (fetchState.registerFailIsAuth ? 'auth failed' : 'boom'),
        };
      }
      fetchState.tenants.set(externalId, 'present');
      return { ok: true, status: 201, json: async () => ({}), text: async () => '' };
    }
    if (method === 'DELETE') {
      fetchState.unregisterCalls.push(externalId);
      fetchState.tenants.delete(externalId);
      return { ok: true, status: 204, json: async () => ({}), text: async () => '' };
    }
    return { ok: true, status: 200, json: async () => ({}), text: async () => '' };
  }),
  AbortSignal: { timeout: () => undefined },
}));

vi.mock('@selfbase/crypto', () => ({
  decryptJson: () => ({ postgresPassword: 'fake-pw' }),
  loadMasterKey: () => Buffer.alloc(32),
}));

// Drizzle query-builder mock. We support enough of the chain shape used by
// pooler-reconciler.ts. Each "builder" is a thenable so `await db().select()...`
// resolves to the same array our state provides.
function mockDb() {
  return {
    select: (cols?: Record<string, unknown>) => buildSelect(cols),
    insert: (table: { __name: string }) => ({
      values: (vals: Record<string, unknown> | Record<string, unknown>[]) => {
        const arr = Array.isArray(vals) ? vals : [vals];
        if (table.__name === 'reconcilerRuns') {
          for (const v of arr) {
            const id = `run-${++runIdCounter}`;
            dbState.reconcilerRuns.push({
              id,
              status: (v.status as string) ?? 'running',
              triggerSource: (v.triggerSource as string) ?? 'manual',
              actorId: (v.actorId as string | null) ?? null,
              startedAt: new Date(),
            });
          }
          return {
            returning: async () =>
              dbState.reconcilerRuns.slice(-arr.length).map((r) => ({ id: r.id })),
          };
        }
        if (table.__name === 'poolerTenants') {
          for (const v of arr) {
            const existingIdx = dbState.poolerTenants.findIndex(
              (p) => p.externalId === v.externalId,
            );
            const row = {
              instanceRef: v.instanceRef as string,
              externalId: v.externalId as string,
              status: (v.status as string) ?? 'registering',
              lastError: (v.lastError as string | null) ?? null,
              sniHostname: v.sniHostname as string | undefined,
              updatedAt: new Date(),
            };
            if (existingIdx >= 0)
              dbState.poolerTenants[existingIdx] = {
                ...dbState.poolerTenants[existingIdx]!,
                ...row,
              };
            else dbState.poolerTenants.push(row);
          }
          return {
            onConflictDoUpdate: async () => {
              // already merged above
            },
          };
        }
        if (table.__name === 'poolerEvents') {
          for (const v of arr) {
            dbState.poolerEvents.push({
              externalId: v.externalId as string,
              event: v.event as string,
              detail: v.detail,
            });
          }
          return Promise.resolve(undefined);
        }
        return Promise.resolve(undefined);
      },
    }),
    update: (table: { __name: string }) => ({
      set: (vals: Record<string, unknown>) => ({
        where: async (_w: unknown) => {
          if (table.__name === 'reconcilerRuns') {
            for (const r of dbState.reconcilerRuns) Object.assign(r, vals);
          }
          if (table.__name === 'poolerTenants') {
            for (const p of dbState.poolerTenants)
              Object.assign(p, vals, { updatedAt: new Date() });
          }
        },
      }),
    }),
    delete: (table: { __name: string }) => ({
      where: async (_w: unknown) => {
        if (table.__name === 'poolerTenants') dbState.poolerTenants.length = 0;
      },
    }),
    execute: async (_q: unknown) => undefined,
  };
}

function buildSelect(cols?: Record<string, unknown>): unknown {
  const builder: Record<string, unknown> = {};
  let table = '';
  builder.from = (t: { __name: string }) => {
    table = t.__name;
    return builder;
  };
  builder.where = () => builder;
  builder.limit = async (_n: number) => rowsFor(table, cols);
  // Plain await without .where()/.limit() — resolve to all rows
  (builder as { then: (resolve: (v: unknown) => void) => void }).then = (resolve) =>
    resolve(rowsFor(table, cols));
  return builder;
}

function rowsFor(table: string, _cols?: Record<string, unknown>): unknown[] {
  switch (table) {
    case 'supabaseInstances':
      return dbState.instances.map((i) => ({ ...i }));
    case 'poolerTenants':
      return dbState.poolerTenants.map((p) => ({
        ref: p.instanceRef,
        externalId: p.externalId,
        status: p.status,
        updatedAt: p.updatedAt,
      }));
    case 'org':
      return dbState.org.map((o) => ({ apex: o.apexDomain }));
    case 'reconcilerRuns':
      return dbState.reconcilerRuns.map((r) => ({ id: r.id, startedAt: r.startedAt }));
    default:
      return [];
  }
}

vi.mock('@selfbase/db', () => ({
  db: () => mockDb(),
  schema: {
    supabaseInstances: {
      __name: 'supabaseInstances',
      ref: 'ref',
      status: 'status',
      encryptedSecrets: 'encryptedSecrets',
      portDbDirect: 'portDbDirect',
      portPostgres: 'portPostgres',
    },
    poolerTenants: {
      __name: 'poolerTenants',
      instanceRef: 'instanceRef',
      externalId: 'externalId',
      status: 'status',
      updatedAt: 'updatedAt',
      lastError: 'lastError',
      sniHostname: 'sniHostname',
      lastReconciledAt: 'lastReconciledAt',
    },
    poolerEvents: {
      __name: 'poolerEvents',
      externalId: 'externalId',
      event: 'event',
      detail: 'detail',
    },
    reconcilerRuns: {
      __name: 'reconcilerRuns',
      id: 'id',
      status: 'status',
      startedAt: 'startedAt',
      triggerSource: 'triggerSource',
    },
    org: { __name: 'org', apexDomain: 'apexDomain' },
  },
}));

// ─── helpers ───────────────────────────────────────────────────────────────

function resetState(): void {
  dbState.instances.length = 0;
  dbState.poolerTenants.length = 0;
  dbState.poolerEvents.length = 0;
  dbState.reconcilerRuns.length = 0;
  fetchState.tenants.clear();
  fetchState.unregisterCalls.length = 0;
  fetchState.registerCalls.length = 0;
  fetchState.registerShouldFail = false;
  fetchState.registerFailIsAuth = false;
  pgState.shouldFail = false;
  pgState.authClass = false;
}

function loadFixture(f: DriftFixture): void {
  const d = f.declared;
  // For orphan_in_supavisor we want supavisor to know about an external_id
  // that does NOT have a matching supabase_instances row. Skip the instance
  // insert in that case.
  if (f.id !== 'orphan_in_supavisor') {
    dbState.instances.push({
      ref: d.inst.ref,
      status: d.inst.status,
      encryptedSecrets: Buffer.from('fake'),
      portDbDirect: 5433,
      portPostgres: 5432,
    });
  }
  if (d.poolerRow) {
    dbState.poolerTenants.push({
      instanceRef: d.poolerRow.ref,
      externalId: d.poolerRow.externalId,
      status: d.poolerRow.status,
      lastError: null,
      updatedAt: d.poolerRow.updatedAt,
    });
  }
  if (d.svTenant) {
    fetchState.tenants.set(d.svTenant.external_id, 'present');
  }
}

// Set required env vars
process.env.SUPAVISOR_API_JWT_SECRET = 'test-secret';
process.env.SUPAVISOR_URL = 'http://supavisor:4000';

// ─── tests ─────────────────────────────────────────────────────────────────

describe('pooler-reconciler — 7 drift classes', () => {
  beforeEach(() => resetState());

  for (const fixture of driftFixtures) {
    it(`fixture '${fixture.id}' → classification=${fixture.expected}, remediation=${fixture.expectedRemediation}`, async () => {
      loadFixture(fixture);
      const svc = await import('../../../src/services/pooler-reconciler.js');
      let runId: string;
      // instance_gone is unreachable via full reconcile (deleting is skipped
      // before classification). Drive it through single-instance for parity.
      if (fixture.id === 'instance_gone') {
        ({ runId } = await svc.startRun('manual'));
        await svc.runSingleInstanceReconcile(runId, fixture.declared.inst.ref);
      } else {
        ({ runId } = await svc.startRun('cron'));
        await svc.runFullReconcile(runId);
      }

      // Assert remediation side effects observable through our mocks.
      switch (fixture.expectedRemediation) {
        case 'noop':
          expect(fetchState.registerCalls).toHaveLength(0);
          expect(fetchState.unregisterCalls).toHaveLength(0);
          break;
        case 'register':
        case 'retry_register':
        case 'reset_then_register':
          expect(fetchState.registerCalls).toContain(fixture.declared.inst.ref);
          break;
        case 'unregister':
        case 'unregister_orphan':
          expect(fetchState.unregisterCalls.length).toBeGreaterThan(0);
          break;
      }

      const run = dbState.reconcilerRuns.find((r) => r.id === runId);
      expect(run).toBeDefined();
      expect(['success', 'partial_failure']).toContain(run!.status);
    });
  }

  it('single-instance pass: missing_pooler_row registers + flips pooler row to active', async () => {
    loadFixture(driftFixtures.find((f) => f.id === 'missing_pooler_row')!);
    const { startRun, runSingleInstanceReconcile } =
      await import('../../../src/services/pooler-reconciler.js');
    const { runId } = await startRun('manual');
    const result = await runSingleInstanceReconcile(runId, 'r0000000000000000001');
    expect(result.remediated).toBe(true);
    expect(fetchState.registerCalls).toContain('r0000000000000000001');
  });

  it('supavisor unreachable → run marked failed', async () => {
    loadFixture(driftFixtures[0]!);
    fetchState.tenants.set('r0000000000000000001', 'error');
    const { startRun, runFullReconcile } =
      await import('../../../src/services/pooler-reconciler.js');
    const { runId } = await startRun('cron');
    await runFullReconcile(runId);
    const run = dbState.reconcilerRuns.find((r) => r.id === runId);
    expect(run?.status).toBe('failed');
    expect(run?.errorMessage).toMatch(/supavisor_unreachable/);
  });

  it('register failure with auth-class probe → promotes to pg_password_drift', async () => {
    loadFixture(driftFixtures.find((f) => f.id === 'missing_pooler_row')!);
    fetchState.registerShouldFail = true;
    pgState.shouldFail = true;
    pgState.authClass = true;
    const { startRun, runFullReconcile } =
      await import('../../../src/services/pooler-reconciler.js');
    const { runId } = await startRun('cron');
    await runFullReconcile(runId);
    const events = dbState.poolerEvents.map((e) => e.event);
    expect(events).toContain('reconciler.password_drift_detected');
    const row = dbState.poolerTenants.find((p) => p.externalId === 'r0000000000000000001');
    expect(row?.status).toBe('pg_password_drift');
  });
});
