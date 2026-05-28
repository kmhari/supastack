# Feature Specification: Pooler-Reconciler Unit Tests

**Feature Branch**: `019-pooler-reconciler-tests`

**Created**: 2026-05-25

**Status**: Draft

**Input**: User description: "Add vitest unit tests for pooler-reconciler service"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Classification logic coverage (Priority: P1)

A developer refactoring or extending the pooler-reconciler needs confidence that the instance-classification logic (`classifyInstance`) behaves correctly across all defined states. Today the only safety net is a live E2E run on the VM, which is slow and unavailable during local development. Unit tests give fast, offline feedback.

**Why this priority**: Classification is the core decision engine of the reconciler. All remediation branches depend on it being correct. Regressions here silently mis-route reconciliation actions.

**Independent Test**: Run the test suite with no external dependencies. Every classification variant returns the expected result against a constructed input fixture.

**Acceptance Scenarios**:

1. **Given** a running instance with a matching Supavisor row and a healthy pooler row, **When** `classifyInstance` is called, **Then** it returns `consistent`.
2. **Given** a running instance with no pooler row in the database, **When** `classifyInstance` is called, **Then** it returns `missing_pooler_row`.
3. **Given** a pooler row with `status='failed'` and `updated_at` older than 1 hour, **When** `classifyInstance` is called, **Then** it returns `failed_stale`.
4. **Given** a pooler row with `status='failed'` and `updated_at` exactly 1 hour ago (boundary), **When** `classifyInstance` is called, **Then** it returns `failed_stale`.
5. **Given** a pooler row with `status='failed'` and `updated_at` 1 hour minus 1 ms ago (boundary), **When** `classifyInstance` is called, **Then** it does NOT return `failed_stale`.
6. **Given** a failed pooler row and `forceRetry=true`, **When** `classifyInstance` is called, **Then** the staleness check is bypassed and the instance is classified for immediate retry.
7. **Given** an instance with `status='deleting'`, **When** `classifyInstance` is called with any other state, **Then** it returns `instance_gone` regardless.
8. **Given** an instance with a pooler row but no matching Supavisor tenant entry, **When** `classifyInstance` is called, **Then** it returns `missing_in_supavisor`.
9. **Given** a Supavisor tenant entry with no corresponding selfbase instance, **When** `classifyInstance` is called, **Then** it returns `orphan_in_supavisor`.
10. **Given** an instance whose Postgres password differs from the pooler row's stored credential, **When** `classifyInstance` is called, **Then** it returns `pg_password_drift`.

---

### User Story 2 — Remediation isolation and run aggregation (Priority: P1)

A developer modifying the reconciliation loop (`runFullReconcile`) needs to verify that a failure on one project does not cascade to cancel remediation for other projects, and that the run summary correctly reflects per-project outcomes.

**Why this priority**: The isolation guarantee (FR-007 from feature 008) is a production correctness requirement, not a nice-to-have. A regression here would cause partial outages to widen silently.

**Independent Test**: Inject a mock that fails for one project in a multi-project set. Verify the reconcile run completes, marks status `partial_failure`, and the other projects are still acted on.

**Acceptance Scenarios**:

1. **Given** a three-project set where one project's remediation throws an error, **When** `runFullReconcile` is called, **Then** the run completes, status is `partial_failure`, and the other two projects are acted on.
2. **Given** a project whose remediation throws an authentication-class error, **When** `runFullReconcile` is called, **Then** `maybePromoteToDrift` is invoked for that project and its classification is promoted to `pg_password_drift`.
3. **Given** a successful reconcile of three projects with mixed classifications, **When** `runFullReconcile` completes, **Then** `actions_taken` in the run summary correctly counts each remediation action taken.

---

### User Story 3 — Preflight guards and concurrency protection (Priority: P2)

A developer needs confidence that the reconciler's startup checks (crash recovery, GC) and its concurrency guard work correctly without relying on a live database or running worker.

**Why this priority**: These are defensive mechanisms. A broken crash-recovery preflight would leave stale `running` rows that block future reconcile runs indefinitely.

**Independent Test**: Construct a mocked database state with stale `running` rows or a concurrent in-flight run. Verify the expected guard behavior triggers.

**Acceptance Scenarios**:

1. **Given** a `reconciler_runs` row with `status='running'` and `started_at` older than 1 hour, **When** the reconciler starts preflight, **Then** the row is updated to `status='failed'` with `error='worker_crash_detected'`.
2. **Given** more than 30 rows in `reconciler_runs`, **When** the GC sweep runs, **Then** only the 30 most recent rows are retained and older rows are deleted.
3. **Given** a reconciler run already in-flight (an existing `running` row less than 1 hour old), **When** a second reconcile is attempted, **Then** `ReconcilerInFlightError` is thrown with the existing run's `id` and `started_at`.

---

### Edge Cases

- `classifyInstance` receives an instance with `status='deleting'` AND a matching Supavisor orphan — `instance_gone` takes precedence.
- `forceRetry=true` with a non-failed pooler row — classification proceeds normally (no bypass effect).
- GC sweep with exactly 30 rows — no rows deleted.
- Concurrent INSERT race where the existing run row disappears between the check and the throw — should not cause an unhandled crash.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The test suite MUST cover all 7 classification outcomes of `classifyInstance`: `consistent`, `missing_pooler_row`, `failed_stale`, `missing_in_supavisor`, `instance_gone`, `orphan_in_supavisor`, `pg_password_drift`.
- **FR-002**: The test suite MUST verify the `failed_stale` 1-hour boundary at exactly-1h, 1h+1ms (stale), and 1h-1ms (not stale).
- **FR-003**: The test suite MUST verify that `forceRetry=true` bypasses the staleness check for failed instances.
- **FR-004**: The test suite MUST verify that `instance.status='deleting'` always resolves to `instance_gone` regardless of other fields.
- **FR-005**: The test suite MUST verify that a per-instance remediation failure in `runFullReconcile` does not abort processing of other instances.
- **FR-006**: The test suite MUST verify that an auth-class remediation error promotes the affected instance's classification to `pg_password_drift` via `maybePromoteToDrift`.
- **FR-007**: The test suite MUST verify that `actions_taken` in the run summary correctly aggregates per-classification counts.
- **FR-008**: The test suite MUST verify that stale `running` rows (>1h old) are flipped to `failed` with `error='worker_crash_detected'` during preflight.
- **FR-009**: The test suite MUST verify that the GC sweep retains only the last 30 `reconciler_runs` rows.
- **FR-010**: The test suite MUST verify that a concurrent in-flight reconcile throws `ReconcilerInFlightError` carrying the existing run's `id` and `started_at`.
- **FR-011**: All tests MUST run without a live database, live Supavisor instance, or live per-project Postgres — all external dependencies MUST be mocked or stubbed.
- **FR-012**: Tests MUST complete in under 10 seconds on a developer workstation (no network I/O, no sleep/timeout waits in the critical path).

### Key Entities

- **ReconcileRun**: A record of one full reconciliation pass — includes `id`, `started_at`, `status` (`running` | `completed` | `partial_failure` | `failed`), `error`, `actions_taken`.
- **PoolerRow**: The per-instance pooler state tracked in the selfbase database — includes `ref`, `status`, `updated_at`, credential hash.
- **SupavisorTenant**: The tenant entry in Supavisor's own data store — keyed by project ref.
- **ClassificationResult**: One of 7 enum values output by `classifyInstance` for a given instance.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: All 7 classification variants have at least one dedicated passing test case.
- **SC-002**: The `failed_stale` boundary is verified at all three time points (exact, over, under).
- **SC-003**: The full test suite runs to completion in under 10 seconds with no external network calls.
- **SC-004**: No changes to production source files are required — the feature is purely additive (tests only).
- **SC-005**: A future refactor that accidentally removes or renames one of the 7 classification outcomes causes at least one test to fail, catching the regression before it ships.
- **SC-006**: The concurrency guard test reliably triggers `ReconcilerInFlightError` without relying on timing or sleep.

## Assumptions

- The pooler-reconciler source (`apps/worker/src/services/pooler-reconciler.ts`) is stable and will not require structural changes to make it testable — the mocking surface is at the dependency injection boundary already used by sibling tests (T030, T031).
- The existing test fixture pattern (schema-replay or pg-mem for the database layer, constructor mock for `pg.Client`, undici mock for HTTP) applies here — no new mock infrastructure needs to be built.
- Supavisor HTTP calls are the only outbound network dependency; all others (database, per-instance Postgres) are already injected.
- The 1-hour `failed_stale` threshold is a constant in the reconciler source, not a configurable runtime value — tests can hard-code it.
- Issue #16 is the authoritative scope reference; the sibling tests T030 and T031 in `specs/008-pooler-resilience/tasks.md` are the pattern to follow.
