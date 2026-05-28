---
description: "Task list for feature 019 — pooler-reconciler unit tests"
---

# Tasks: Pooler-Reconciler Unit Tests

**Input**: `specs/019-pooler-reconciler-tests/{spec.md, plan.md, research.md, data-model.md, quickstart.md}`

**Tests included**: yes — this feature IS the tests. All tasks are test-writing tasks. Zero production source changes.

**Organization**: by user story (US1 = classification coverage, US2 = remediation isolation, US3 = preflight/concurrency). All tasks target a single file: `apps/worker/tests/unit/pooler-reconciler.test.ts`.

## Format

`- [ ] [TaskID] [P?] [Story?] Description with file path`

[P] = parallelizable (independent test groups, no in-file dep on incomplete tasks).
[US1] / [US2] / [US3] = which spec user story the task serves.

## Path Conventions

All test tasks write to: `apps/worker/tests/unit/pooler-reconciler.test.ts`
SUT (read-only): `apps/worker/src/services/pooler-reconciler.ts`
Pattern reference: `apps/worker/tests/unit/pg-password-probe.test.ts`

---

## Phase 1: Setup

**Purpose**: Create the test file shell with all `vi.mock` calls, dynamic SUT import, and fixture helper functions. No test cases yet — just the wiring that all phases depend on.

- [X] T001 Create `apps/worker/tests/unit/pooler-reconciler.test.ts` with the full `vi.mock` setup: mock `@selfbase/db` (chainable builder returning configurable arrays), `undici` (`fetch` named export), `pg` (`pg.Client` constructor), `drizzle-orm` (`eq`, `lt`, `and`, `sql` as identity stubs), `@selfbase/crypto` (`decryptJson`, `loadMasterKey`), `@selfbase/shared` (`logger`). Dynamically import `{ startRun, runFullReconcile, runSingleInstanceReconcile, ReconcilerInFlightError }` from `../../src/services/pooler-reconciler.js` after mocks are wired. Add fixture helper functions: `makeInst(ref, status)`, `makePoolerRow(ref, status, updatedAt)`, `makeSvTenant(externalId)`. See `pg-password-probe.test.ts` for the established pattern.

---

## Phase 2: Foundational

**Purpose**: Implement the `db()` mock's builder-chain helper so each test can configure what the database returns without copy-paste. This is the most complex mock and all user story phases depend on it.

- [X] T002 In `apps/worker/tests/unit/pooler-reconciler.test.ts`, implement `makeDbMock(calls: unknown[][])` — a factory that wraps the `@selfbase/db` mock so each successive `db()` call (`.select().from()...`, `.update().set().where()`, `.insert().values().returning()`, `.execute()`) resolves to the values in `calls[n]` in order. Add a `beforeEach` that resets all mocks and restores the db mock to a safe no-op default (resolves empty arrays) so tests that don't configure the db explicitly don't throw. Verify the helper works by writing a trivial sanity check (not a test case — just `vi.fn()` call counts).

**Checkpoint**: after T001 + T002, the file compiles and `pnpm -C apps/worker test pooler-reconciler` runs (0 test cases, 0 failures).

---

## Phase 3: User Story 1 — Classification coverage (Priority: P1)

**Goal**: Every `classifyInstance` outcome has at least one dedicated passing test case, plus the `failed_stale` boundary is verified at all three time points.

**Independent Test**: `pnpm -C apps/worker test pooler-reconciler` passes with all US1 test cases green and no live DB/network calls.

- [X] T003 [P] [US1] Add `describe('consistent')` block in `apps/worker/tests/unit/pooler-reconciler.test.ts`: call `runFullReconcile(runId)` with a mocked `supabase_instances` row (`status: 'running'`), a matching `pooler_tenants` row (`status: 'active'`), and a matching Supavisor tenant. Assert `finishRun` is called with `status: 'success'` and `actionsTaken.consistent === 1`.

- [X] T004 [P] [US1] Add `describe('missing_pooler_row')` block: call `runFullReconcile` with an instance row but no pooler row for that ref and no sv tenant. Assert the remediate path for `missing_pooler_row` is invoked (supavisor register call is made via the `fetch` mock).

- [X] T005 [P] [US1] Add `describe('pg_password_drift')` block: call `runFullReconcile` with a pooler row whose `status === 'pg_password_drift'`. Assert the drift remediation path fires (per-instance pg.Client is constructed for the probe).

- [X] T006 [P] [US1] Add `describe('missing_in_supavisor')` block: call `runFullReconcile` with an `active` pooler row but an empty supavisor tenant list for that ref. Assert the `missing_in_supavisor` remediation path fires (register call made).

- [X] T007 [P] [US1] Add `describe('orphan_in_supavisor')` block: call `runFullReconcile` with a supavisor `fetch` mock that returns a tenant whose `external_id` has no matching row in `supabase_instances`. Assert the orphan unregister call fires (DELETE request to supavisor via `fetch`).

- [X] T008 [US1] Add `describe('instance_gone')` block with two cases: (a) `runSingleInstanceReconcile(runId, ref)` with a mocked `supabase_instances` query returning an empty array — assert return value has `classification: 'instance_gone'`; (b) `runSingleInstanceReconcile` with `inst.status === 'deleting'` — assert `classifyInstance` returns `instance_gone` (verify no remediation action is taken, `fetch` not called).

- [X] T009 [US1] Add `describe('failed_stale boundary')` block using `vi.useFakeTimers()` in `beforeAll` / `vi.useRealTimers()` in `afterAll`. Three cases via `runFullReconcile` with a `failed` pooler row: (a) `updatedAt` = now − 3,600,001ms → `failed_stale` (remediation attempted); (b) `updatedAt` = now − 3,600,000ms → `consistent` (strict `>`, boundary is NOT stale); (c) `runSingleInstanceReconcile` with `failed` pooler row and `updatedAt` = now − 1ms → `failed_stale` (forceRetry bypasses staleness). See research.md R-006 for the boundary correction.

**Checkpoint**: US1 complete — 10 test cases covering all 7 classifications + 3 boundary variants, all passing.

---

## Phase 4: User Story 2 — Remediation isolation (Priority: P1)

**Goal**: `runFullReconcile` does not abort on per-instance failure, aggregates correctly, and auth-class errors promote to drift.

**Independent Test**: `pnpm -C apps/worker test pooler-reconciler` passes with US1 + US2 test cases green.

- [X] T010 [US2] Add `describe('per-instance failure isolation')` block in `apps/worker/tests/unit/pooler-reconciler.test.ts`: mock 3 instances; make the second instance's remediation throw a generic error (configure the `fetch` mock to throw on the second call). Assert: `runFullReconcile` resolves (does not rethrow); `finishRun` receives `status: 'partial_failure'`; the third instance's remediation still fires (fetch called a third time for it).

- [X] T011 [P] [US2] Add `describe('auth-class error → drift promotion')` block: mock one instance whose remediation throws an error with message matching `/password authentication failed/` (28P01 code). Assert `maybePromoteToDrift` fires — i.e., a `db().update(POOLER_TENANTS).set({ status: 'pg_password_drift' })` call is made. Verify via the db mock call count/args.

- [X] T012 [P] [US2] Add `describe('actions_taken aggregation')` block: mock 3 instances with classifications `consistent`, `missing_pooler_row`, `missing_pooler_row`. Assert `finishRun` is called with `actionsTaken` containing `{ consistent: 1, missing_pooler_row: 2 }`.

**Checkpoint**: US2 complete — 3 more test cases, run status and aggregation verified.

---

## Phase 5: User Story 3 — Preflight + concurrency (Priority: P2)

**Goal**: `startRun` correctly handles crash recovery, GC sweep, and concurrent-run guard.

**Independent Test**: `pnpm -C apps/worker test pooler-reconciler` passes with US1 + US2 + US3 test cases green.

- [X] T013 [US3] Add `describe('preflight — crash recovery')` block in `apps/worker/tests/unit/pooler-reconciler.test.ts`: configure the db mock so the `UPDATE reconciler_runs SET status='failed'` call is observable (spy on the update chain). Call `startRun('cron')`. Assert the `update(RECONCILER_RUNS).set({ status: 'failed', errorMessage: 'worker_crash_detected' }).where(...)` call was made with the correct `lt(startedAt, cutoff)` condition.

- [X] T014 [P] [US3] Add `describe('preflight — GC sweep')` block: spy on `db().execute`. Call `startRun('cron')`. Assert `db().execute` was called with a SQL value whose string representation contains `LIMIT 30` (or assert it was called once, confirming the GC DELETE ran).

- [X] T015 [US3] Add `describe('concurrent run guard')` block: configure the db `insert().values().returning()` chain to throw an error with message `unique constraint violated on uq_reconciler_runs_one_running`. Then configure the subsequent `select().from(RECONCILER_RUNS).where(...).limit(1)` to return `[{ id: 'existing-id', startedAt: new Date('2026-01-01') }]`. Call `startRun('cron')` and assert it throws `ReconcilerInFlightError` with `inFlightRunId === 'existing-id'` and `inFlightStartedAt` equal to the fixture date.

**Checkpoint**: US3 complete — 3 more test cases. Full suite: ~16 test cases, all passing in < 10s.

---

## Phase 6: Polish

**Purpose**: Validate the full suite end-to-end and update the spec task tracker.

- [X] T016 Run `pnpm -C apps/worker test pooler-reconciler` and verify: all tests pass, 0 failures, no live network calls (no `ECONNREFUSED` / timeout errors in output), total run time < 10s. Fix any remaining mock gaps. Mark issue #16 closed if not already done.

---

## Dependencies

```
Phase 1 (T001) — no deps, start immediately

Phase 2 (T002) — depends on T001 (file must exist)

Phase 3 (T003–T009) — all depend on T002 (db mock helper required)
  T003–T008 [P] — independent of each other (different describe blocks)
  T009 — independent of T003–T008 but recommended last in US1 (fake timers require care)

Phase 4 (T010–T012) — depend on T002; independent of Phase 3 tests
  T011 [P], T012 [P] — independent of T010 and each other

Phase 5 (T013–T015) — depend on T002; independent of Phase 3+4 tests
  T014 [P] — independent of T013 and T015
  T013, T015 — independent of each other

Phase 6 (T016) — depends on T003–T015 all complete
```

## Parallel Opportunities

Within Phase 3 (after T002): `[T003, T004, T005, T006, T007, T008]` all parallel — different `describe` blocks, no shared mutable state.

Within Phase 4 (after T002): `[T011, T012]` parallel alongside T010 (T010 should land first for clarity but has no code dependency).

Within Phase 5 (after T002): `[T014]` parallel with T013 and T015.

Phases 3, 4, and 5 can be written in parallel by separate agents once T002 lands — they target different `describe` groups in the same file.

## Implementation Strategy

### MVP (US1 only — all 7 classifications)
1. Complete T001 → T002 (file + mock setup)
2. Complete T003–T009 (classification coverage)
3. Run and validate: `pnpm -C apps/worker test pooler-reconciler`

### Full feature
4. Complete T010–T012 (remediation isolation)
5. Complete T013–T015 (preflight + concurrency)
6. Run T016 validation pass

Single developer: T001 → T002 → T003–T008 (parallel) → T009 → T010 → T011–T012 (parallel) → T013 → T014–T015 (parallel) → T016.
