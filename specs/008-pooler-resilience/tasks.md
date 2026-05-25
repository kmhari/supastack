---
description: "Tasks for feature 008-pooler-resilience — reconciler + dashboard + PG password drift recovery"
---

# Tasks: Pooler resilience — reconciler + dashboard + PG password drift recovery

**Input**: Design documents at `/specs/008-pooler-resilience/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable — different files, no dependency on other in-flight tasks
- **[Story]**: User Story (US1=reconciler, US2=dashboard, US3=PG password drift)
- Setup / Foundational / Polish carry NO `[Story]` label

## Path Conventions

TypeScript monorepo: `apps/api/src/`, `apps/worker/src/`, `apps/web/src/`, `packages/db/`, `packages/shared/src/`, `tests/cli-e2e/`. Paths absolute from repo root.

---

## Phase 1: Setup

**Purpose**: Schema changes + Drizzle bindings used by all three stories.

- [X] T001 Create `packages/db/migrations/0008_reconciler_runs.sql` (idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`). Includes: `reconciler_runs` table per data-model.md (id, started_at, completed_at, status, instances_seen, actions_taken jsonb, error_message, trigger_source, actor_id FK); `idx_reconciler_runs_started_at`; partial unique `uq_reconciler_runs_one_running ON (status) WHERE status = 'running'`. Same migration also: `ALTER TABLE pooler_tenants DROP CONSTRAINT IF EXISTS pooler_tenants_status_check; ALTER TABLE pooler_tenants ADD CONSTRAINT pooler_tenants_status_check CHECK (status IN ('registering','active','failed','rotating','pg_password_drift'));` and `ALTER TABLE pooler_tenants ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz`.
- [X] T002 [P] Create `packages/db/src/schema/reconciler-runs.ts` — Drizzle schema for the new table. Export `reconcilerRuns`. Add to `packages/db/src/schema/index.ts` re-exports.
- [X] T003 [P] Edit `packages/db/src/schema/pooler.ts` (or wherever `poolerTenants` is defined): add `lastReconciledAt: timestamp('last_reconciled_at', { withTimezone: true })`; extend the status enum literal type to include `'pg_password_drift'`.

---

## Phase 2: Foundational

**Purpose**: Wire BullMQ queues + shared helpers that all three user-stories use.

- [X] T004 Create `apps/worker/src/queues/pooler-reconciler-queue.ts` exporting `createPoolerReconcilerQueue(redisUrl)` (BullMQ Queue with repeatable `0 3 * * *` schedule) and `createPoolerReconcilerWorker(redisUrl, handler)`. Mirror the pattern of feature 005's pooler-events queue.
- [X] T005 Edit `apps/worker/src/index.ts` to instantiate the queue + register the worker (handler will be filled in T009 below).
- [X] T006 [P] Create `apps/api/src/queues/pooler-reconciler-client.ts` exporting `enqueueReconcilerRun(payload: { runId, mode: 'full' | 'single', ref? }, opts?: { priority })` — used by US1's manual trigger endpoint AND US3's reset endpoint to kick off a single-instance reconcile.

---

## Phase 3: User Story 1 — Reconciler auto-recovers tenant drift (Priority P1)

**Story goal**: Drift across `supabase_instances` × `pooler_tenants` × supavisor is detected + recovered automatically on a daily cron, with a manual trigger endpoint for ops.

**Independent test**: Delete a `pooler_tenants` row directly → `POST /api/v1/pooler/reconciler/run` → within 5s the row is back as `active` and a `reconciler.registered_missing` event is logged.

### Reconciler service

- [X] T007 [US1] Create `apps/api/src/services/pooler-reconciler.ts` exporting `runFullReconcile(runId, actorId?)` and `runSingleInstanceReconcile(runId, ref, actorId?)`. Implementation per research.md Decision 3 + data-model.md state machine:
  - At start: GC stale `running` reconciler_runs >1h (mark failed, error='worker_crash_detected'). DELETE old reconciler_runs beyond the last 30.
  - Snapshot three sources atomically: `supabase_instances` (status != 'deleting'), `pooler_tenants`, supavisor `getTenants()` via existing `pooler-client.ts`.
  - For each instance, classify: `consistent | missing_pooler_row | failed_stale | missing_in_supavisor | instance_gone | orphan_in_supavisor | pg_password_drift`.
  - Take corresponding remediation; emit per-action `pooler_events` row (NO event for `consistent`).
  - On per-instance failure, log + continue (FR-007). Track per-instance results in `actions_taken` jsonb.
  - At end: UPDATE `reconciler_runs` with final status (`success` if 0 failures; `partial_failure` if any single-instance failed; `failed` if the whole sweep aborted e.g. supavisor unreachable), `instances_seen`, `actions_taken`, `completed_at`. Also UPDATE `pooler_tenants.last_reconciled_at` for every instance touched (including consistent ones).
- [X] T008 [US1] Edit `apps/api/src/services/pooler-tenants.ts` `registerTenantForInstance` (or add a sibling function the reconciler uses): when supavisor's register call returns auth-class error, perform an active probe via `withPerInstancePg(ref, c => c.query('SELECT 1'))` to disambiguate. If probe also fails with `28P01` → set `pooler_tenants.status='pg_password_drift'`. Otherwise → generic `failed` with supavisor error.
- [X] T009 [US1] Create `apps/worker/src/jobs/pooler-reconciler.ts` — BullMQ job handler that dispatches to `runFullReconcile` or `runSingleInstanceReconcile` based on payload mode. Wire into the worker registration from T005.

### Manual trigger endpoint

- [X] T010 [P] [US1] Create `apps/api/src/routes/pooler-reconciler-run.ts` — `POST /api/v1/pooler/reconciler/run` per `contracts/reconciler-run.md`. Admin RBAC, INSERT reconciler_runs with `trigger_source='manual', actor_id=user.id`, catch unique-constraint violation → 409 with the in-flight row's id + started_at. Enqueue the BullMQ job. Emit audit `pooler.reconciler.manual_trigger`. Return 202.
- [X] T011 [US1] Edit `apps/api/src/server.ts` to register `pooler-reconciler-run` route under `/api/v1`.

### E2E

- [X] T012 [P] [US1] Create `tests/cli-e2e/pooler-reconciler.sh` — exercises Quickstart US1: delete a `pooler_tenants` row, POST /reconciler/run, poll /pooler/status until the row is back, assert recent_events contains `reconciler.registered_missing`.

**Checkpoint**: After T007-T012, the reconciler runs daily + can be manually triggered, detects + recovers 5 drift classes.

---

## Phase 4: User Story 2 — Dashboard panel (Priority P2)

**Story goal**: Admins can see pooler state + re-register single tenants from a UI without touching the CLI.

**Independent test**: Load `/settings/database` in browser → see health pill, per-project table, recent events tail → re-register button works.

### Backend

- [X] T013 [P] [US2] Create `apps/api/src/routes/pooler-status.ts` — `GET /api/v1/pooler/status` per `contracts/pooler-status.md`. Admin RBAC. Concurrently fetch supavisor health (timeout 3s, gracefully handle unreachable), `supabase_instances` rows, `pooler_tenants` (joined), most-recent 50 `pooler_events`, most-recent 30 `reconciler_runs`. Shape + return.
- [X] T014 [P] [US2] Create `apps/api/src/routes/pooler-reregister.ts` — `POST /api/v1/pooler/tenants/:ref/re-register` per `contracts/pooler-reregister.md`. Admin RBAC, 404 for unknown ref, 409 for not-running, call `registerTenantForInstance(ref)` synchronously, return final pooler_tenants row.
- [X] T015 [US2] Edit `apps/api/src/server.ts` to register both new routes.

### Frontend

- [X] T016 [P] [US2] Edit `apps/web/src/lib/api.ts` adding `poolerApi`:
  - `status()` → GET /pooler/status
  - `reregister(ref)` → POST /pooler/tenants/:ref/re-register
  - `runReconciler()` → POST /pooler/reconciler/run
  - `resetPgPassword(ref)` → POST /instances/:ref/reset-pg-password (also used by US3)
- [X] T017 [P] [US2] Create `apps/web/src/components/PoolerHealthCard.tsx` — renders supavisor health pill (green Up / red Down / yellow Degraded), pooler endpoint with copy button, per-project table (ref/name/instance_status/tenant_status with status-tinted badge, last_error truncated with tooltip, last_reconciled_at relative timestamp, action buttons: Re-register, Reset password if `pg_password_drift`).
- [X] T018 [P] [US2] Create `apps/web/src/components/PoolerEventsTail.tsx` — vertical list of last 50 events; timestamp + event type pill + ref + detail-on-hover.
- [X] T019 [P] [US2] Create `apps/web/src/components/ReconcilerRunsTable.tsx` — last 30 runs as a compact table (started_at, status pill, instances_seen, action summary, manual/cron source).
- [X] T020 [US2] Create `apps/web/src/pages/SettingsDatabase.tsx` — composes the three components above + "Run reconciler now" button at top. React Query for data fetching with 10s polling (only when document.visibilityState='visible' — pause on hidden tab). Immediate refetch after any action button click.
- [X] T021 [US2] Edit `apps/web/src/App.tsx` to register the `/settings/database` route. Also add a "Database" nav item under Settings (or wherever the Settings nav lives).
- [X] T022 [P] [US2] (Manual UX test, not a code task) Verify the panel in browser per Quickstart US2: health pill renders, auto-refresh fires, re-register button hits the api, button states reflect data correctly.

**Checkpoint**: After T013-T022, admins have full pooler visibility + per-tenant action surface.

---

## Phase 5: User Story 3 — PG password drift prevention + detection + recovery (Priority P2)

**Story goal**: Drift caught at provision time (prevention), classified by reconciler (detection — done in US1 T008), recoverable via admin endpoint (recovery).

**Independent test**: Manual `ALTER USER postgres WITH PASSWORD 'wrong'` → reconciler → `pg_password_drift` status → POST /reset-pg-password → status returns to `active` (all <10s).

### Prevention (provision-time probe)

- [X] T023 [P] [US3] Create `apps/api/src/services/pg-password-probe.ts` exporting `probeAuthWithStoredPassword(ref, opts?: { retries: 3, delayMs: 2000 }): Promise<{ ok: boolean; lastError?: string; isAuthClass: boolean }>`. Internally uses `withPerInstancePg(ref, c => c.query('SELECT 1'))`. Catches `28P01` SQLSTATE → `isAuthClass: true`. Other errors → `isAuthClass: false`. Retries with delay; returns first success or last error.
- [X] T024 [US3] Edit `apps/worker/src/jobs/provision.ts`: after the existing `waitHealthy(ctx, …)` call but BEFORE `setStatus(ref, 'running')`, call `probeAuthWithStoredPassword(ref)`. On failure with `isAuthClass=true`, mark instance `failed` with `provision_error='pg_password_drift_at_provision'` and a human-readable message pointing at the reset endpoint as recovery; do NOT set status=running. On `isAuthClass=false`, throw a generic provision error.

### Recovery (reset endpoint)

- [X] T025 [P] [US3] Create `apps/api/src/services/pg-password-reset.ts` exporting `resetPgPasswordForInstance(ref): Promise<void>`. Loads instance, decrypts `encrypted_secrets.postgresPassword`. Constructs ALTER SQL with PG escaping (`'` → `''`):
  ```sql
  BEGIN;
  ALTER USER postgres WITH PASSWORD '<escaped>';
  ALTER USER supabase_admin WITH PASSWORD '<escaped>';
  COMMIT;
  ```
  Runs via docker exec on `selfbase-<ref>-db-1` using the existing docker socket HTTP API (mirror the pattern from the demo + fix-asyo.mjs script). Use psql `-h 127.0.0.1 -U supabase_admin -d postgres -c "<sql>"`. Pass SQL via `-c`, NOT env. On any error, throw `PerInstancePgResetError` with the underlying message.
- [X] T026 [US3] Create `apps/api/src/routes/reset-pg-password.ts` — `POST /api/v1/instances/:ref/reset-pg-password` per `contracts/reset-pg-password.md`. Admin RBAC; 404 for unknown ref; 409 for `paused|deleting|provisioning` (note: status `failed` with `pg_password_drift_at_provision` is allowed). Emit audit `instances.pg_password.reset` (severity high) BEFORE running. Call `resetPgPasswordForInstance(ref)` → on success, enqueue single-instance reconciler pass with high priority, wait up to 5s for completion via BullMQ job promise (or polling the reconciler_runs row), include final `pooler_tenant_status` in response. 502 if container unreachable.
- [X] T027 [US3] Edit `apps/api/src/server.ts` to register the reset endpoint under `/api/v1`.

### E2E

- [ ] T028 [P] [US3] Create `tests/cli-e2e/pooler-drift-roundtrip.sh` — Quickstart US3 recovery + prevention paths in one script. Recovery: manually ALTER to wrong password → trigger reconciler → assert `pg_password_drift` → POST reset → assert `active` within 5s. Prevention: pre-corrupt password → trigger lifecycle restart → assert provision fails with `pg_password_drift_at_provision` → reset + retry-provision → assert `running`.

**Checkpoint**: After T023-T028, drift can't slip past provision; if it does (manual or backup-restore), reconciler catches it + reset endpoint recovers in seconds.

---

## Phase 6: Polish & Cross-Cutting

- [~] T029 (DEFERRED &#x2192; #16) [P] Create `apps/api/src/services/__tests__/pooler-reconciler.test.ts` — vitest unit tests for the classification + remediation logic. Mock `db`, supavisor's pooler-client, the active probe. Cover all 7 classifications + per-instance failure isolation + GC of stale running runs.
- [X] T030 [P] Create `apps/api/src/services/__tests__/pg-password-probe.test.ts` — vitest tests: success first try, success after 2 retries, fail all 3 (auth-class), fail all 3 (network).
- [X] T031 [P] Create `apps/api/src/services/__tests__/pg-password-reset.test.ts` — vitest tests with docker socket mocked: happy path, container down (502), ALTER fails (502), SQL injection attempt in password (escaped correctly).
- [X] T032 [P] Add a docs page `docs/pooler-resilience.md` covering operator workflows: what the reconciler does, what `pg_password_drift` means, how to recover, how to manually trigger.
- [X] T033 Run full quickstart on the VM (all three USes); update issue threads #7 + #8 + #9 with results.

---

## Dependencies

```
T001 (migration)
  └── T002 + T003 (Drizzle schemas) [parallel]
       └── T007 (reconciler service depends on schema)

T004 (BullMQ queue) → T005 (worker registration) → T009 (worker handler)
T006 (api queue client) — independent

US1: T001→T002/T003→T007→T008→T009→T010→T011→T012
  Single-instance reconciler pass (T007.runSingleInstanceReconcile) used by US3 T026

US2: T013 + T014 (routes parallel) → T015 (server.ts)
     T016 (api client) → T017+T018+T019 (components parallel) → T020 (page) → T021 (route)

US3: T023 (probe service) → T024 (provision worker edit)
     T025 (reset service) → T026 (reset route) → T027 (server.ts)
     T028 (E2E) depends on US1 reconciler + US3 reset both working

Polish: T029-T031 parallel after their target services exist; T032+T033 last
```

## Parallel execution opportunities

**Setup (Phase 1)**: T002 + T003 parallel after T001 migration applied.

**Foundational (Phase 2)**: T006 parallel with T004; T005 needs T004.

**US1**: T007 + T008 sequential (T008 edits a service T007 uses); T010 parallel with T009; T011 after T010; T012 after T011.

**US2**: T013 + T014 parallel routes; T015 after; T016 (api client) parallel with backend; T017/T018/T019 all parallel after T016; T020 after components; T021 after T020.

**US3**: T023 + T025 parallel (different services); T024 after T023; T026 after T025; T027 after T026.

**Cross-story parallelism**: US1, US2, US3 can run concurrently after Phase 2 (T004-T006) is done. US3 T028 needs US1 reconciler service from T007 — slight ordering.

**Polish**: T029-T031 all parallel (different test files); T032+T033 last.

## Implementation strategy — MVP first

**Recommended MVP**: ship US1 alone first (T001-T012). It's the foundation: data model + reconciler + manual trigger. Validates the design end-to-end with backend-only tests. Estimated 0.5 day.

**Then US3** (T023-T028, ~0.5 day). Tightly coupled to US1's reconciler (the reset endpoint synchronously calls it). Closes the password-drift class of failures.

**Then US2** (T013-T022, ~1 day). Pure UX wrapping the backend that US1+US3 already shipped. Can be deferred if backend ops via curl is acceptable short-term.

**Polish** (T029-T033) runs alongside / after.

## Total task counts

| Phase | Count |
|---|---|
| Setup | 3 |
| Foundational | 3 |
| US1 (reconciler) | 6 |
| US2 (dashboard) | 10 |
| US3 (password drift) | 6 |
| Polish | 5 |
| **Total** | **33** |

**Independent test criteria per story**:
- US1: delete a `pooler_tenants` row → `POST /pooler/reconciler/run` → within 5s row is `active` again + event logged.
- US2: load `/settings/database` → renders health + per-project + events; auto-refresh fires; re-register button works.
- US3: `ALTER USER postgres WITH PASSWORD 'wrong'` → reconciler → `pg_password_drift` → POST reset → `active` (all <10s). Plus prevention: corrupted-data-dir restart → provision fails with `pg_password_drift_at_provision`.
