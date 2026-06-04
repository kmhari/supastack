/**
 * T016 (019): Unit tests for pooler-reconciler — feature 019 / issue #16.
 *
 * Tests classification logic, remediation isolation, and preflight/concurrency
 * entirely with mocked dependencies — no live DB, Supavisor, or Postgres.
 *
 * Pattern follows T030 (pg-password-probe.test.ts).
 */
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

// ── db() mock infrastructure ────────────────────────────────────────────────

const dbQueue: unknown[] = [];
let dbCallCount = 0;

/**
 * Returns a Drizzle-like chainable proxy that, when awaited, resolves to
 * `value`. Any chained method call (select, from, where, set, update, …)
 * returns another proxy that also resolves to `value`. This lets the SUT
 * chain arbitrarily without throwing.
 */
function makeChain(value: unknown): any {
  const p = Promise.resolve(value);
  return new Proxy({} as any, {
    get(_: any, prop: string | symbol) {
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === Symbol.iterator || prop === Symbol.toPrimitive) return undefined;
      return (..._args: any[]) => makeChain(value);
    },
  });
}

/**
 * Like makeChain but captures the args passed to `.set()` for finishRun
 * assertions. Push this as the last item in the queue when you need to
 * inspect what finishRun wrote.
 */
function makeFinishRunCapture() {
  let capturedStatus: string = '';
  let capturedActionsTaken: Record<string, number> = {};

  const chain: any = new Proxy({} as any, {
    get(_: any, prop: string | symbol) {
      if (prop === 'set') {
        return (args: any) => {
          capturedStatus = args.status;
          capturedActionsTaken = args.actionsTaken ?? {};
          return chain; // keep returning self so .where() can chain
        };
      }
      const p = Promise.resolve([]);
      if (prop === 'then') return p.then.bind(p);
      if (prop === 'catch') return p.catch.bind(p);
      if (prop === 'finally') return p.finally.bind(p);
      if (prop === Symbol.iterator || prop === Symbol.toPrimitive) return undefined;
      // Return self so any chain method (.update, .where, ...) still reaches .set()
      return (..._args: any[]) => chain;
    },
  });

  return {
    chain,
    get status() {
      return capturedStatus;
    },
    get actionsTaken() {
      return capturedActionsTaken;
    },
  };
}

/** Push sequential response values for upcoming db() calls. */
function setupDb(...responses: unknown[]) {
  dbQueue.length = 0;
  dbCallCount = 0;
  dbQueue.push(...responses);
}

// ── Fetch mock (supavisor HTTP) ─────────────────────────────────────────────

const fetchMock = vi.fn();

/** Resolves to a 200 OK (supavisor tenant found). */
const SV_OK = { ok: true, status: 200, text: async () => '' };
/** Resolves to a 404 (supavisor tenant absent). */
const SV_404 = { ok: false, status: 404, text: async () => '' };

// ── pg.Client mock (probeAuthForInstance) ───────────────────────────────────

const pgConnect = vi.fn();
const pgQuery = vi.fn();
const pgEnd = vi.fn();

// ── vi.mock calls (must be at module level — Vitest hoists them) ────────────

vi.mock('undici', () => ({ fetch: (...args: any[]) => fetchMock(...args) }));

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function ClientCtor() {
      return { connect: pgConnect, query: pgQuery, end: pgEnd };
    }),
  },
}));

vi.mock('@supastack/db', () => ({
  db: () => {
    dbCallCount++;
    const value = dbQueue.length > 0 ? dbQueue.shift() : [];
    // Non-array values are already chain proxies (gcChain, insertChain, capture.chain)
    // — return them directly so their custom method handlers are preserved.
    if (!Array.isArray(value)) return value as any;
    return makeChain(value);
  },
  schema: {
    supabaseInstances: {
      ref: 'ref',
      status: 'status',
      encryptedSecrets: 'encrypted_secrets',
      portDbDirect: 'port_db_direct',
      portPostgres: 'port_postgres',
    },
    poolerTenants: {
      instanceRef: 'instance_ref',
      externalId: 'external_id',
      status: 'status',
      updatedAt: 'updated_at',
      lastReconciledAt: 'last_reconciled_at',
      lastError: 'last_error',
    },
    reconcilerRuns: {
      id: 'id',
      status: 'status',
      startedAt: 'started_at',
      completedAt: 'completed_at',
      errorMessage: 'error_message',
      instancesSeen: 'instances_seen',
      actionsTaken: 'actions_taken',
      triggerSource: 'trigger_source',
      actorId: 'actor_id',
    },
    poolerEvents: { externalId: 'external_id', event: 'event', detail: 'detail' },
    installation: { apexDomain: 'apex_domain' },
  },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: vi.fn(() => ({ postgresPassword: 'test-pw' })),
  loadMasterKey: vi.fn(() => Buffer.alloc(32)),
}));

vi.mock('@supastack/shared', () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq-stub'),
  lt: vi.fn(() => 'lt-stub'),
  and: vi.fn(() => 'and-stub'),
  sql: vi.fn((strings: TemplateStringsArray, ...vals: unknown[]) =>
    strings.reduce((acc, s, i) => acc + s + (vals[i] ?? ''), ''),
  ),
}));

// Set env before the dynamic import so module-level constants are captured.
process.env.SUPAVISOR_API_JWT_SECRET = 'unit-test-secret';
process.env.SUPAVISOR_URL = 'http://supavisor-test:4000';

const { runFullReconcile, runSingleInstanceReconcile, startRun, ReconcilerInFlightError } =
  await import('../../src/services/pooler-reconciler.js');

// ── Fixture helpers ─────────────────────────────────────────────────────────

const RUN = 'test-run-id';

function inst(ref: string, status = 'running') {
  return { ref, status };
}

function poolerRow(ref: string, status = 'active', updatedAt = new Date(0)) {
  return { ref, externalId: ref, status, updatedAt };
}

function instSecrets(ref = 'r1') {
  return { ref, encryptedSecrets: Buffer.alloc(8), portDbDirect: 5555, portPostgres: 5556 };
}

// ── Reset helpers ───────────────────────────────────────────────────────────

beforeEach(() => {
  fetchMock.mockReset();
  pgConnect.mockReset();
  pgQuery.mockReset();
  pgEnd.mockReset();
  pgEnd.mockResolvedValue(undefined);
  setupDb(); // clear queue
});

// ═══════════════════════════════════════════════════════════════════════════
// US1 — Classification coverage
// ═══════════════════════════════════════════════════════════════════════════

describe('classification via runSingleInstanceReconcile', () => {
  // runSingleInstanceReconcile always passes forceRetry=true to classifyInstance,
  // so it returns PerInstanceResult with .classification directly inspectable.

  it('consistent — active pooler row + sv tenant present', async () => {
    setupDb(
      [inst('r1')], // select inst
      [poolerRow('r1', 'active')], // select poolerRow
      // no remediation db calls (consistent is a no-op)
      [], // update lastReconciledAt
      [], // finishRun
    );
    fetchMock.mockResolvedValue(SV_OK); // supavisorGetTenant → found

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('consistent');
    expect(result.remediated).toBe(false);
    expect(result.error).toBeUndefined();
  });

  it('missing_pooler_row — no pooler row for the instance', async () => {
    setupDb(
      [inst('r1')], // select inst
      [], // select poolerRow → none
      // remediate: registerTenantForInstance inst lookup → not found → throw
      [], // probeAuthForInstance inst lookup → not found → skip promotion
      [], // finishRun (status: partial_failure)
    );
    fetchMock.mockResolvedValue(SV_404); // supavisorGetTenant → not found

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('missing_pooler_row');
    expect(result.remediated).toBe(false);
    expect(result.error).toMatch(/not found/);
  });

  it('pg_password_drift — pooler row status is pg_password_drift', async () => {
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'pg_password_drift')],
      // remediate: registerTenantForInstance inst lookup → not found → throw (no maybePromoteToDrift for this case)
      [],
      [], // update lastReconciledAt (poolerRow exists)
      [], // finishRun
    );
    fetchMock.mockResolvedValue(SV_OK);

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('pg_password_drift');
  });

  it('missing_in_supavisor — active pooler row but no sv tenant', async () => {
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'active')],
      // remediate: registerTenantForInstance inst lookup → not found → throw
      [], // probeAuthForInstance → not found
      [], // update lastReconciledAt
      [], // finishRun
    );
    fetchMock.mockResolvedValue(SV_404); // no sv tenant

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('missing_in_supavisor');
  });

  it('instance_gone — instance not found in supabase_instances', async () => {
    setupDb(
      [], // select inst → none → early return
      [], // finishRun
    );
    // No fetch calls expected (returns before supavisor check)

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('instance_gone');
    expect(result.remediated).toBe(false);
    expect(result.error).toBe('not_found');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('instance_gone — inst.status is deleting', async () => {
    setupDb(
      [inst('r1', 'deleting')], // select inst
      [poolerRow('r1', 'active')], // select poolerRow
      // remediate instance_gone → unregisterTenantForInstance → supavisorUnregisterTenant (fetch DELETE) + db delete
      [], // db().delete(POOLER_TENANTS)
      [], // emitEvent insert
      [], // update lastReconciledAt (poolerRow exists)
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // supavisorGetTenant GET
      .mockResolvedValueOnce(SV_OK); // supavisorUnregisterTenant DELETE

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('instance_gone');
    expect(result.remediated).toBe(true);
    const deleteCall = (fetchMock.mock.calls as Array<[string, RequestInit?]>).find(([, opts]) => opts?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
  });

  it('failed_stale — forceRetry bypasses staleness (runSingleInstanceReconcile always forceRetry=true)', async () => {
    // updatedAt = 1ms ago (would NOT be stale without forceRetry)
    const recentFailed = poolerRow('r1', 'failed', new Date(Date.now() - 1));
    setupDb(
      [inst('r1')],
      [recentFailed],
      // remediate failed_stale → registerTenantForInstance inst lookup → not found → throw
      [], // probeAuthForInstance → not found
      [], // update lastReconciledAt
      [], // finishRun
    );
    fetchMock.mockResolvedValue(SV_404);

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('failed_stale');
  });
});

// ── failed_stale age boundary — requires runFullReconcile (forceRetry=false) ─

describe('failed_stale age boundary (fake timers)', () => {
  const STALE_MS = 60 * 60 * 1000; // 1h = 3_600_000ms
  const FAKE_NOW = 1_000_000_000_000;

  beforeAll(() => {
    vi.useFakeTimers();
    vi.setSystemTime(FAKE_NOW);
  });

  afterAll(() => {
    vi.useRealTimers();
  });

  function _setupFullReconcile(updatedAt: Date) {
    // runFullReconcile db calls:
    // 1: select instances, 2: select poolerRows
    // 3+: remediation db calls (we short-circuit by making inst lookup fail)
    // N-1: update lastReconciledAt (poolerRow exists)
    // N: finishRun
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'failed', updatedAt)],
      [], // remediation inst lookup → fails
      [], // probeAuthForInstance → not found
      [], // update lastReconciledAt
      [], // finishRun
    );
    fetchMock.mockResolvedValue(SV_404);
  }

  it('age > 1h → failed_stale (remediation attempted)', async () => {
    const capture = makeFinishRunCapture();
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'failed', new Date(FAKE_NOW - STALE_MS - 1))],
      [], // registerTenantForInstance: inst lookup → empty → throws
      [], // emitEvent('reconciler.retry_failed') insert
      [], // probeAuthForInstance: inst lookup → empty → skips promotion
      [], // lastReconciledAt
      capture.chain, // finishRun
    );
    fetchMock.mockResolvedValue(SV_404);

    await runFullReconcile(RUN);

    // failed_stale → remediation was attempted (error in result → partial_failure)
    expect(capture.status).toBe('partial_failure');
  });

  it('age === 1h → consistent (strict > not >=)', async () => {
    const capture = makeFinishRunCapture();
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'failed', new Date(FAKE_NOW - STALE_MS))],
      // remediate consistent → no db calls
      [], // update lastReconciledAt
      capture.chain, // finishRun
    );
    fetchMock.mockResolvedValue(SV_404);

    await runFullReconcile(RUN);

    expect(capture.status).toBe('success');
  });

  it('age < 1h → consistent', async () => {
    const capture = makeFinishRunCapture();
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'failed', new Date(FAKE_NOW - STALE_MS + 1))],
      [], // update lastReconciledAt
      capture.chain, // finishRun
    );
    fetchMock.mockResolvedValue(SV_404);

    await runFullReconcile(RUN);

    expect(capture.status).toBe('success');
  });
});

// ── orphan_in_supavisor ─────────────────────────────────────────────────────

describe('orphan_in_supavisor — sv tenant with no matching instance', () => {
  it('calls supavisor DELETE for orphaned tenant', async () => {
    // No instances in supabase_instances; poolerRow for 'orphan-ref' causes
    // it to appear in allExternalIds. Supavisor reports it as present.
    setupDb(
      [], // select instances → none
      [poolerRow('orphan-ref', 'active')], // select poolerRows
      // remediate orphan_in_supavisor → supavisorUnregisterTenant (DELETE) + emitEvent
      [], // emitEvent insert
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // supavisorListExisting GET orphan-ref → found
      .mockResolvedValueOnce(SV_OK); // supavisorUnregisterTenant DELETE

    await runFullReconcile(RUN);

    const deleteCall = (fetchMock.mock.calls as Array<[string, RequestInit?]>).find(([, opts]) => opts?.method === 'DELETE',
    );
    expect(deleteCall).toBeDefined();
    expect(deleteCall![0] as string).toContain('orphan-ref');
  });
});

// ── Remediation happy paths ─────────────────────────────────────────────────
// For each classification that calls registerTenantForInstance, verify that
// when it succeeds the result has remediated: true and no error.
//
// registerTenantForInstance db sequence: inst lookup → org lookup →
//   insert POOLER_TENANTS → (supavisorRegister fetch PUT) → update active
// Followed by: emitEvent insert, optional lastReconciledAt, finishRun.

describe('remediation success — registerTenantForInstance completes', () => {
  it('missing_pooler_row → remediated: true', async () => {
    setupDb(
      [inst('r1')], // runSingleInstanceReconcile: inst
      [], // poolerRow → none → classification: missing_pooler_row
      [instSecrets('r1')], // registerTenantForInstance: inst
      [{ apex: 'test.dev' }], // registerTenantForInstance: org
      [], // insert POOLER_TENANTS (onConflictDoUpdate)
      [], // update POOLER_TENANTS status='active'
      [], // emitEvent('reconciler.registered_missing')
      // no lastReconciledAt — poolerRow was null
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // supavisorGetTenant GET (classification; result unused)
      .mockResolvedValueOnce(SV_OK); // supavisorRegister PUT

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('missing_pooler_row');
    expect(result.remediated).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('missing_in_supavisor → remediated: true', async () => {
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'active')],
      [instSecrets('r1')],
      [{ apex: 'test.dev' }],
      [], // insert POOLER_TENANTS
      [], // update POOLER_TENANTS active
      [], // emitEvent('reconciler.registered_missing')
      [], // lastReconciledAt (poolerRow existed)
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_404) // supavisorGetTenant → 404 → missing_in_supavisor
      .mockResolvedValueOnce(SV_OK); // supavisorRegister PUT

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('missing_in_supavisor');
    expect(result.remediated).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('pg_password_drift → remediated: true', async () => {
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'pg_password_drift')],
      [instSecrets('r1')],
      [{ apex: 'test.dev' }],
      [], // insert POOLER_TENANTS
      [], // update POOLER_TENANTS active
      [], // emitEvent('password_reset_then_registered')
      [], // lastReconciledAt
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // supavisorGetTenant (irrelevant for drift classification)
      .mockResolvedValueOnce(SV_OK); // supavisorRegister PUT

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('pg_password_drift');
    expect(result.remediated).toBe(true);
    expect(result.error).toBeUndefined();
  });

  it('failed_stale → remediated: true (forceRetry path)', async () => {
    // updatedAt = 1ms ago — would be consistent without forceRetry, but
    // runSingleInstanceReconcile always passes forceRetry=true.
    setupDb(
      [inst('r1')],
      [poolerRow('r1', 'failed', new Date(Date.now() - 1))],
      [instSecrets('r1')],
      [{ apex: 'test.dev' }],
      [], // insert POOLER_TENANTS
      [], // update POOLER_TENANTS active
      [], // emitEvent('reconciler.retry_succeeded')
      [], // lastReconciledAt
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // supavisorGetTenant
      .mockResolvedValueOnce(SV_OK); // supavisorRegister PUT

    const result = await runSingleInstanceReconcile(RUN, 'r1');

    expect(result.classification).toBe('failed_stale');
    expect(result.remediated).toBe(true);
    expect(result.error).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// US2 — Remediation isolation and aggregation
// ═══════════════════════════════════════════════════════════════════════════

describe('runFullReconcile — remediation isolation', () => {
  it('per-instance failure does not abort processing of other instances', async () => {
    // Three instances: A (consistent), B (missing_in_supavisor → fails), C (consistent).
    // B's registerTenantForInstance fails at db level.
    // Verify: function resolves + C's lastReconciledAt db call is still made.
    setupDb(
      [inst('A'), inst('B'), inst('C')],
      [poolerRow('A', 'active'), poolerRow('B', 'active'), poolerRow('C', 'active')],
      // B remediation: registerTenantForInstance inst lookup → not found → throw
      [], // B: registerTenantForInstance inst lookup
      [], // B: probeAuthForInstance inst lookup
      // lastReconciledAt for each (A, B, C) — all 3 pooler rows exist
      [], // A lastReconciledAt
      [], // B lastReconciledAt
      [], // C lastReconciledAt
      [], // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // A — found
      .mockResolvedValueOnce(SV_404) // B — not found → missing_in_supavisor
      .mockResolvedValueOnce(SV_OK); // C — found

    await expect(runFullReconcile(RUN)).resolves.toBeUndefined();

    // 8 db calls confirms C was processed despite B failing
    expect(dbCallCount).toBe(8);
  });

  it('partial_failure status when any instance fails', async () => {
    const capture = makeFinishRunCapture();
    setupDb(
      [inst('A'), inst('B')],
      [poolerRow('A', 'active'), poolerRow('B', 'active')],
      [], // B: registerTenantForInstance inst lookup
      [], // B: probeAuthForInstance
      [], // A lastReconciledAt
      [], // B lastReconciledAt
      capture.chain, // finishRun
    );
    fetchMock.mockResolvedValueOnce(SV_OK).mockResolvedValueOnce(SV_404);

    await runFullReconcile(RUN);

    expect(capture.status).toBe('partial_failure');
  });

  it('auth-class error triggers maybePromoteToDrift (pg probe invoked)', async () => {
    // B's remediation fails, then probeAuthForInstance sees an auth error.
    // Verify: pg.Client.connect was called (probe ran).
    setupDb(
      [inst('B')],
      [poolerRow('B', 'active')],
      // B registerTenantForInstance inst lookup → not found → throw
      [],
      // probeAuthForInstance: provide an inst row so the probe actually runs
      [instSecrets('B')], // inst lookup for probe
      // pg.Client will throw auth error (configured below)
      // maybePromoteToDrift: update POOLER_TENANTS + emitEvent
      [], // update POOLER_TENANTS status=pg_password_drift
      [], // emitEvent insert
      [], // B lastReconciledAt
      [], // finishRun
    );
    fetchMock.mockResolvedValueOnce(SV_404); // B not in supavisor

    const authErr = Object.assign(new Error('password authentication failed for user "postgres"'), {
      code: '28P01',
    });
    pgConnect.mockRejectedValue(authErr);

    await runFullReconcile(RUN);

    expect(pgConnect).toHaveBeenCalled();
  });

  it('actions_taken aggregates per-classification correctly', async () => {
    // Two consistent instances + one orphan → actionsTaken should reflect results.
    // Only remediated=true or error entries appear in actionsTaken (per aggregate fn).
    // Both consistent instances have remediated=false, no error → NOT counted.
    // So actionsTaken should be {} (empty) for two consistent instances.
    const capture = makeFinishRunCapture();
    setupDb(
      [inst('A'), inst('B')],
      [poolerRow('A', 'active'), poolerRow('B', 'active')],
      // both consistent → no remediation db calls
      [], // A lastReconciledAt
      [], // B lastReconciledAt
      capture.chain, // finishRun
    );
    fetchMock
      .mockResolvedValueOnce(SV_OK) // A
      .mockResolvedValueOnce(SV_OK); // B

    await runFullReconcile(RUN);

    expect(capture.status).toBe('success');
    // consistent with remediated=false and no error is excluded from aggregate
    expect(capture.actionsTaken).toEqual({});
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// US3 — Preflight + concurrency (startRun)
// ═══════════════════════════════════════════════════════════════════════════

describe('startRun — preflight and concurrency', () => {
  it('preflight flips stale running rows to failed with worker_crash_detected', async () => {
    // Provide 3 db calls: preflight update, GC execute, insert run row.
    // We verify the preflight update was called by checking dbCallCount.
    setupDb(
      [], // preflight: UPDATE reconciler_runs SET status='failed'
      [], // GC: EXECUTE DELETE FROM reconciler_runs ...
      [{ id: 'new-run' }], // INSERT reconciler_runs RETURNING
    );

    const { runId } = await startRun('cron');

    expect(runId).toBe('new-run');
    expect(dbCallCount).toBe(3); // preflight + gc + insert = confirms all 3 ran
  });

  it('GC sweep executes DELETE (db().execute is called)', async () => {
    // Replace db call #2 (the GC) with a spy chain whose .execute() we can detect
    const executeSpy = vi.fn().mockResolvedValue([]);
    const gcChain: any = new Proxy({} as any, {
      get(_: any, prop: string | symbol) {
        if (prop === 'execute') return executeSpy;
        const p = Promise.resolve([]);
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === Symbol.iterator || prop === Symbol.toPrimitive) return undefined;
        return (..._: any[]) => makeChain([]);
      },
    });

    setupDb(
      [], // preflight update
      gcChain, // GC execute — intercepted
      [{ id: 'new-run' }], // insert
    );

    await startRun('cron');

    expect(executeSpy).toHaveBeenCalledTimes(1);
  });

  it('throws ReconcilerInFlightError with existing run id and startedAt', async () => {
    const existingId = 'in-flight-run';
    const existingStartedAt = new Date('2026-01-01T00:00:00Z');

    // preflight + GC succeed; INSERT throws unique constraint error;
    // then SELECT for existing run returns the in-flight row.
    const uniqueErr = new Error('unique constraint violated on uq_reconciler_runs_one_running');

    // Build the insert chain that throws on .returning()
    const insertChain: any = new Proxy({} as any, {
      get(_: any, prop: string | symbol) {
        if (prop === 'returning') return () => Promise.reject(uniqueErr);
        const p = Promise.resolve([]);
        if (prop === 'then') return p.then.bind(p);
        if (prop === 'catch') return p.catch.bind(p);
        if (prop === 'finally') return p.finally.bind(p);
        if (prop === Symbol.iterator || prop === Symbol.toPrimitive) return undefined;
        return (..._: any[]) => insertChain;
      },
    });

    setupDb(
      [], // preflight update
      [], // GC execute
      insertChain, // INSERT → throws unique constraint
      [{ id: existingId, startedAt: existingStartedAt }], // SELECT existing run
    );

    const thrown = await startRun('cron').catch((e) => e);
    expect(thrown).toBeInstanceOf(ReconcilerInFlightError);
    expect((thrown as InstanceType<typeof ReconcilerInFlightError>).inFlightRunId).toBe(existingId);
    expect((thrown as InstanceType<typeof ReconcilerInFlightError>).inFlightStartedAt).toEqual(existingStartedAt);
  });
});
