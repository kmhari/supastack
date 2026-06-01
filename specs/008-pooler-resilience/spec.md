# Feature Specification: Pooler resilience — reconciler + dashboard + PG password drift recovery

**Feature Branch**: `008-pooler-resilience`

**Created**: 2026-05-24

**Status**: Draft

**Input**: Bundles three GitHub issues that all touch the same pooler operational surface from feature 005:
- **#7** — Pooler tenant reconciler cron
- **#8** — Pooler health visibility on dashboard
- **#9** — Postgres password drift detection + recovery

Bundled because they're all defensive follow-ups, share the same `pooler_tenants`/`pooler_events` data, and end up on the same Settings page. Shipping them together avoids two passes over the dashboard panel and keeps the reconciler + recovery logic in one mental model.

## Background

Feature 005 shipped the top-level Supavisor pooler with happy-path tenant registration: when an instance reaches `running`, the worker calls `POST /internal/pooler/tenants` and the row is registered. Once registered, the platform stops actively watching for drift — the row stays "active" in our DB even if supavisor lost its state, the instance was deleted out-of-band, or the underlying Postgres password rotated.

Two real-world failure modes have already bitten us:

1. **ASYO PG password drift** — the per-instance Postgres `postgres` role's password didn't match `encrypted_secrets.postgresPassword`, causing pooler tenant registration (and any direct PG connection through the api) to silently auth-fail. We caught it manually during the Phase 5 backfill; left undetected it would have surfaced only when a customer tried to connect.

2. **Tenant table drift** — supavisor's tenant table can diverge from `supabase_instances` after restores, manual SQL, or worker outages. Today we have no automated way to detect or recover.

This feature adds:
- A daily reconciler that detects + auto-recovers from drift (US1)
- A dashboard panel that surfaces the current state + recent events for operators (US2)
- An admin endpoint + reconciler integration to detect and recover PG password drift specifically, PLUS provision-time auth verification to prevent the most common cause of drift at the source (US3)

## Clarifications

### Session 2026-05-24

- Q: Should US3 also include drift PREVENTION (provision-time auth verify), or stay purely reactive? → A: Add prevention. The most common drift cause is provision-time — `POSTGRES_PASSWORD` is only honored on first init, so a leftover data dir from a failed prior provision means the new env value is silently ignored and the project ships broken. After `docker compose up db`, the worker MUST actively connect with the stored password before marking the instance `running`; auth failure fails the provision loudly with `pg_password_drift_at_provision` rather than leaving a silently broken project.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reconciler auto-recovers pooler tenant drift (Priority: P1)

A daily reconciler runs at 03:00 UTC. It compares three sources of truth — `supabase_instances` rows (status != `deleting`), the `pooler_tenants` table, and Supavisor's actual `/api/tenants` list — and reconciles divergences:

- Instance exists + `pooler_tenants` row missing → re-register
- Instance exists + `pooler_tenants` row `status='failed'` older than 1 hour → retry registration
- `pooler_tenants` row exists + corresponding instance is `deleting` or gone → unregister + cleanup
- Supavisor knows about a tenant we don't → log warning + unregister from supavisor (orphan cleanup)
- All three agree → no-op (the common case)

Every reconciliation action emits a `pooler_events` row for visibility. The operator never has to know this is running unless they look at the dashboard panel.

**Why this priority**: This is the foundation other stories build on. Without it, drift accumulates silently and the dashboard panel (US2) has nothing to show but a frozen snapshot. Recovery of the ASYO-style outages depends on this loop running.

**Independent Test**: With both ENZY + ASYO registered: (1) delete the ASYO row from `pooler_tenants` directly via psql, then trigger the reconciler — verify ASYO is re-registered + a `register` event is logged. (2) Drop the ASYO row from supavisor's tenant table (admin DELETE), trigger reconciler — verify it's re-registered there too. (3) Manually create an orphan tenant in supavisor with no matching `supabase_instances` row, trigger reconciler — verify the orphan is removed + an event logged.

**Acceptance Scenarios**:

1. **Given** an instance with no `pooler_tenants` row, **When** the reconciler runs, **Then** it registers the tenant and logs an event `reconciler.registered_missing`.
2. **Given** a `pooler_tenants` row with `status='failed'` more than 1 hour old, **When** the reconciler runs, **Then** it retries registration; on success it updates to `active`, on failure it leaves the row as-is and logs `reconciler.retry_failed`.
3. **Given** a `pooler_tenants` row whose instance is now `deleting`, **When** the reconciler runs, **Then** it unregisters from supavisor + deletes the row + logs `reconciler.unregistered_deleting`.
4. **Given** a tenant in supavisor's table with no matching `supabase_instances` row, **When** the reconciler runs, **Then** it unregisters from supavisor + logs `reconciler.unregistered_orphan` with the external_id.
5. **Given** all three sources agree, **When** the reconciler runs, **Then** no events are emitted and the run completes in well under a second (no-op fast path).
6. **Given** supavisor is unreachable, **When** the reconciler runs, **Then** the run is recorded as `failed` with reason `supavisor_unreachable`; the run is automatically retried at the next cron tick (no permanent failure state).

---

### User Story 2 — Operator sees pooler health on the dashboard (Priority: P2)

An operator opens Settings → Database in the dashboard and sees a "Connection Pooler" panel with:

- Supavisor service health (`Up` / `Degraded` / `Down`) with the version
- Pooler endpoint URL — `pooler.<apex>:6543` — copyable
- A table of every project's tenant status: ref, project name, registration status (`active` / `failed` / `pg_password_drift`), last error, last seen in supavisor, last reconciled
- A "Re-register" button per row (works in any failed state — calls the internal endpoint synchronously)
- A tail of the last 50 `pooler_events` rows — timestamp, event type, ref, detail JSON
- A "Connection strings" section per project (or as a tab on the project page itself) with the direct + pooled connection strings, with reveal-on-click for the password

The page auto-refreshes every 10s when visible.

**Why this priority**: US1 fills `pooler_events` and updates `pooler_tenants` continuously; without a UI to view that data, the operator can't tell whether the reconciler is doing its job, can't see drift recoveries, can't manually re-register a stuck tenant, and can't copy connection strings without going to the CLI. This is the visibility loop.

**Independent Test**: With US1 deployed and emitting events, load `/settings/database` in a browser. Verify the panel renders the current state, refreshes after 10s, and a synthetic "Re-register" click hits the api and reflects new state on the next refresh.

**Acceptance Scenarios**:

1. **Given** an authenticated admin user, **When** they navigate to Settings → Database, **Then** the pooler panel renders with all sections (health, per-project table, events tail, connection strings).
2. **Given** the panel is visible, **When** 10 seconds elapses, **Then** the panel auto-refetches the underlying data without a full page reload (no flicker on cached unchanged data).
3. **Given** a project with `pooler_tenants.status='failed'`, **When** the operator clicks "Re-register", **Then** the api re-runs registration synchronously and the row updates to `active` (or surfaces the new error inline if registration still fails).
4. **Given** an admin user, **When** they click "Reveal password" on a connection string, **Then** the password is unredacted in the UI for that row only (no other rows reveal).
5. **Given** a non-admin user, **When** they try to access Settings → Database, **Then** the page either redirects them away or shows a read-only view without the action buttons (RBAC consistent with other admin-only settings pages).
6. **Given** supavisor is down (`Up` pill is red), **When** the operator views the panel, **Then** they see a clear "Pooler offline — projects connecting via pooler.<apex>:6543 will fail" banner, plus a "Restart supavisor" instruction link.

---

### User Story 3 — Prevent + detect + recover from per-instance Postgres password drift (Priority: P2)

PG password drift happens when the on-disk `postgres`/`supabase_admin` role passwords diverge from `encrypted_secrets.postgresPassword`. Root cause is almost always that `POSTGRES_PASSWORD` is only honored on first init — so a leftover data dir, a restored volume, or a manual `ALTER USER` for debugging leaves the live PG with a stale password while the control plane thinks otherwise. This silently breaks pooler registration, direct DB connections, and `supabase db push`.

This story addresses drift at three layers:

1. **Prevention at provision (new)**: the worker, after starting `db` and reaching healthy, actively connects to the per-instance PG with the stored password BEFORE marking the instance `running`. If auth fails, the provision fails loudly with `pg_password_drift_at_provision` rather than shipping a silently broken project. This closes the most common drift cause at the source.

2. **Detection by reconciler**: the reconciler from US1 specifically classifies pooler-registration auth-class failures as `pg_password_drift` (vs generic `failed`), giving the dashboard a distinct CTA.

3. **One-click recovery**: a new admin endpoint `POST /api/v1/instances/<ref>/reset-pg-password` runs `ALTER USER postgres ... ALTER USER supabase_admin ... WITH PASSWORD '<from encrypted_secrets>'` against the per-instance Postgres via 127.0.0.1 trust auth (the supabase template's pg_hba allows this for the in-container `supabase_admin` user). After reset, the reconciler verifies on its next tick (or immediately, if the operator triggers a manual run).

The recovery flow exactly matches the manual recovery we performed for ASYO during feature 005; the prevention flow stops it happening in the first place.

**Why this priority**: Closes the loop on the most painful real-world failure mode discovered in feature 005. Without this, an operator hitting password drift has no UI path to recovery and would have to know the manual `ALTER USER` incantation.

**Independent Test (recovery path)**: On a test instance, manually `ALTER USER postgres WITH PASSWORD 'wrong'` via 127.0.0.1 trust auth. Trigger reconciler — verify the `pooler_tenants` row flips to `pg_password_drift` with a clear error message + dashboard surfaces the reset button. Click reset → verify password is restored to match `encrypted_secrets.postgresPassword` → next reconciler tick re-registers cleanly.

**Independent Test (prevention path)**: Pre-populate a per-instance data dir with a Postgres bootstrapped at a known-different password. Trigger provision against that ref. Verify provision fails with `pg_password_drift_at_provision` BEFORE the instance is marked `running`, and that the failure surfaces in the dashboard's instance status with a clear recovery CTA (run reset → retry provision).

**Acceptance Scenarios**:

1. **Given** a project whose on-disk PG password doesn't match its stored secret, **When** the reconciler runs, **Then** the `pooler_tenants` row's status becomes `pg_password_drift` (not generic `failed`) with `last_error` mentioning auth failure.
2. **Given** a project in `pg_password_drift` status, **When** an admin clicks "Reset Postgres password to match stored secret" in the dashboard, **Then** the api runs the ALTER statements via the per-instance container, returns 200 with a success message, and the row remains in `pg_password_drift` until the next reconciler tick re-verifies.
3. **Given** the password was just reset, **When** the reconciler runs on its next tick (or is manually triggered), **Then** the row transitions to `active` and a `password_reset_then_registered` event is logged.
4. **Given** a non-admin caller, **When** they call `POST /api/v1/instances/<ref>/reset-pg-password`, **Then** the response is 403.
5. **Given** a project that is `paused` or `deleting`, **When** the reset endpoint is called, **Then** the response is 409 with `project_not_running` (we don't ALTER while the container is down or being torn down).
6. **Given** the reset endpoint is called and ALTER fails (e.g., the per-instance container is unreachable), **When** the api responds, **Then** the response is 502 with the underlying error — no state change recorded.
7. **Given** the worker reaches db healthcheck during provision, **When** it attempts an auth probe with the stored password and that probe fails, **Then** the instance is marked `failed` with `provision_error = 'pg_password_drift_at_provision'` and the instance is NOT marked `running`.
8. **Given** an instance failed with `pg_password_drift_at_provision`, **When** the operator clicks "Reset Postgres password to match stored secret" + the lifecycle "Retry provision" action, **Then** the instance reaches `running` and the pooler tenant registers normally on next reconciler tick.

---

### Edge Cases

**Reconciler**:
- **Reconciler run takes longer than the cron interval (24h)**: explicit lock via a `reconciler_runs` row prevents overlapping runs; second invocation exits early with `previous_run_still_active`.
- **Supavisor API returns malformed response**: run is marked `failed` with `supavisor_malformed_response`; partial reconciliation NOT committed (atomic per-instance handling — either an instance is fully reconciled this tick or not at all).
- **One specific instance always fails reconciliation**: that single instance's failure does NOT abort the whole run; other instances continue. Failure logged per-instance in `pooler_events`.
- **Reconciler triggered manually while cron run is in flight**: returns 409 (same lock).

**Dashboard**:
- **Project with no `pooler_tenants` row yet** (provision just started, US1 hasn't run): row shows status `not_registered_yet` with a note that the reconciler will pick it up on next tick.
- **Empty events tail**: shows "No recent events" rather than an empty table.
- **Connection-string reveal in shared screen-share**: standard reveal-then-hide UX. No 30s timer — operator hides manually.

**Password drift**:
- **Per-instance Postgres container is stopped**: reset endpoint returns 409 `project_not_running`.
- **ALTER succeeds but next reconciler still fails** (e.g., supavisor itself is down): row reverts from `pg_password_drift` to generic `failed` because the auth-class probe now passes; banner updates `last_error` to reflect the supavisor issue instead. Dashboard correctly shows the new failure mode.
- **Reset called repeatedly in quick succession**: idempotent — multiple ALTERs with the same password are a no-op at the PG level. No rate limit beyond standard RBAC checks.
- **Master key rotated between secret storage and reset call**: secret decryption fails → 500 with `master_key_rotation_detected`. Operator must re-mint instance secrets (out of scope here).
- **Provision-time probe times out** (e.g., db reports healthy but isn't actually accepting connections yet): probe retries up to 3 times with 2s delay before failing the provision. Avoids flaky false positives from healthcheck/socket race conditions.
- **Pre-existing data dir at provision time** (leftover from a failed prior provision with a different password): the provision-time probe catches this and fails fast with `pg_password_drift_at_provision` instead of marking the instance `running` and shipping it broken. This is the primary case prevention exists for.
- **Restoring a backup volume from another generation** (future feature #14): the restore worker SHOULD invoke the same reset endpoint after the data-dir swap to align the running PG with the current stored secret. Out of scope here; #14 will reference this contract.

## Requirements *(mandatory)*

### Functional Requirements

#### Reconciler (US1)

- **FR-001**: System MUST schedule a BullMQ repeatable job `pooler-reconciler` at `0 3 * * *` (daily, 03:00 UTC). The cron MUST be installed automatically on api startup (consistent with feature 004's renewal cron pattern).
- **FR-002**: Each reconciler run MUST hold an exclusive lock (DB row or Redis SETNX) preventing overlapping runs. Concurrent triggers receive `previous_run_still_active` and exit immediately.
- **FR-003**: Each run MUST query three sources atomically per run start: (a) `supabase_instances` rows with `status != 'deleting'`, (b) `pooler_tenants` rows, (c) supavisor `GET /api/tenants`. Subsequent reasoning uses only the snapshot — no mid-run re-queries (avoid TOCTOU bugs).
- **FR-004**: For each instance in the source-of-truth set, the reconciler MUST classify into one of: `consistent` (all three agree), `missing_pooler_row` (no row), `failed_stale` (row exists, status=failed, updated > 1h ago), `missing_in_supavisor` (row exists active, supavisor doesn't know), `instance_gone` (pooler row but no instance), `orphan_in_supavisor` (supavisor tenant with no instance), `pg_password_drift` (registration auth-failed — US3).
- **FR-005**: For each non-consistent classification, the reconciler MUST take the corresponding remediation action: register, retry, unregister, etc. Each action emits a `pooler_events` row.
- **FR-006**: A reconciler-run summary MUST be recorded (run_id, started_at, completed_at, status, instances_seen, actions_taken). Last 30 runs surfaced in the dashboard.
- **FR-007**: A single instance's reconciliation failure MUST NOT abort the whole run. Failures are logged per-instance; the run's overall status is `partial_failure` if any instance failed but at least one succeeded.
- **FR-008**: An admin-only manual trigger endpoint MUST be exposed: `POST /api/v1/pooler/reconciler/run` returning 202 with the run_id, or 409 if a run is already in flight.

#### Dashboard (US2)

- **FR-009**: System MUST expose `GET /api/v1/pooler/status` returning supavisor health, the pooler endpoint URL, per-project tenant status (joined from `supabase_instances` + `pooler_tenants` + supavisor's view), and the most recent 50 `pooler_events` rows.
- **FR-010**: System MUST expose `POST /api/v1/pooler/tenants/:ref/re-register` (admin-only) that synchronously re-runs registration and returns the new state. Distinct from the reconciler's automatic retry — the operator wants immediate feedback.
- **FR-011**: Dashboard MUST render a "Connection Pooler" panel under Settings → Database (creating the route if it doesn't exist) that visualizes the data from FR-009. Auto-refresh every 10s while visible.
- **FR-012**: For each project, the panel MUST show both connection strings (direct + pooled), redacted by default, with a reveal-on-click toggle. Reveal is per-row (clicking another row does not auto-reveal its password).
- **FR-013**: The panel MUST be admin-only via existing RBAC. Non-admins either get a 403 redirect or a read-only view (no action buttons, no password reveal).

#### PG password drift — prevention + detection + recovery (US3)

- **FR-014**: The provision worker (`apps/worker/src/jobs/provision.ts`) MUST, after `db` reaches healthy and BEFORE setting the instance to `running`, actively connect to the per-instance Postgres via the same channel the api uses (host.docker.internal:<port_db_direct> as `postgres` with the freshly-decrypted `encrypted_secrets.postgresPassword`). On auth failure, the provision MUST mark the instance `failed` with `provision_error = 'pg_password_drift_at_provision'` and a human-readable explanation pointing at the reset endpoint as the recovery path. The instance MUST NOT be marked `running`.
- **FR-015**: When pooler registration fails specifically with PG auth error (`28P01` SQLSTATE or, if supavisor's error body is ambiguous, confirmed by an active probe via 127.0.0.1 trust auth), the reconciler MUST set `pooler_tenants.status = 'pg_password_drift'` (a distinct status from generic `failed`) and populate `last_error` with the human-readable reason.
- **FR-016**: System MUST expose `POST /api/v1/instances/:ref/reset-pg-password` (admin-only) that decrypts the stored postgresPassword and runs `ALTER USER postgres ... ALTER USER supabase_admin ... WITH PASSWORD '<password>'` against the per-instance Postgres container (using 127.0.0.1 trust auth as `supabase_admin` — the supabase template's pg_hba allows this). Both ALTER statements MUST run in a single PG transaction so partial failure rolls both back.
- **FR-017**: The reset endpoint MUST return 200 on success, 409 if the project is `paused`/`deleting`/`provisioning`, 403 for non-admins, 502 if the per-instance container is unreachable. Success response includes `{ message: 'Password reset; reconciler verifying...', reconciler_run_id }`. After running ALTER, the endpoint synchronously kicks off a single-instance reconciler pass and waits up to 5 seconds for the result; if the pass completes within that window the response also includes the new `pooler_tenants.status`.
- **FR-018**: For `pg_password_drift_at_provision` failures, the existing instance lifecycle "Retry provision" action MUST be usable to re-attempt provision after the reset endpoint has been invoked — no separate "retry" code path needed for this case.
- **FR-019**: The reset endpoint MUST emit a high-severity audit log entry (`instances.pg_password.reset`) capturing actor, ref, and timestamp.

### Key Entities

**Existing (reuse, no schema changes)**:
- `pooler_tenants` — gains one new value in the `status` text enum: `pg_password_drift`. May also gain `last_reconciled_at timestamptz` column for the dashboard's "last reconciled" display (additive, nullable).
- `pooler_events` — used by all three stories. New event types: `reconciler.registered_missing`, `reconciler.retry_failed`, `reconciler.unregistered_deleting`, `reconciler.unregistered_orphan`, `reconciler.pg_password_drift_detected`, `password_reset_then_registered`.
- `audit_log` — new event type `instances.pg_password.reset` (severity high).

**New**:
- **reconciler_runs**: control-plane row per cron run. Fields: `id` (uuid), `started_at`, `completed_at`, `status` (`running`, `success`, `partial_failure`, `failed`), `instances_seen` (int), `actions_taken` (jsonb summary `{registered: n, retried: n, unregistered: n, orphans_removed: n, password_drift: n}`), `error_message` (nullable). Partial unique index on `(status) WHERE status = 'running'` enforces FR-002. Last 30 rows retained; older rows GC'd by a sweep.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: The reconciler runs daily without operator intervention; a no-op run (all consistent) completes in under 2 seconds for a deployment with up to 50 projects.
- **SC-002**: 100% of post-feature-005 drift scenarios we know about (missing `pooler_tenants` row, stale failed registration, deleted instance with stale tenant, orphan in supavisor, PG password drift) are auto-recovered within one reconciler tick of the issue arising.
- **SC-003**: When the reconciler is healthy, a synthetic drift (deleting a `pooler_tenants` row directly) is recovered within 24 hours without operator action; with manual trigger, within 5 seconds.
- **SC-004**: The dashboard pooler panel renders the full per-project table for a deployment with up to 50 projects in under 1 second on first load.
- **SC-005**: An operator can identify a stuck or drifting project AND remediate it (re-register OR reset password) from the dashboard in under 60 seconds, with no terminal commands.
- **SC-006**: For 100% of PG password resets, the new password is verified working within 5 seconds of the reset endpoint returning (synchronous single-instance reconciler pass per FR-017).
- **SC-009**: For 100% of provisions where the data dir contains a Postgres bootstrapped with a different password than the current encrypted_secrets, the provision fails with `pg_password_drift_at_provision` within 10 seconds of `db` reaching healthy — no silently-broken instances reach `running` status.
- **SC-007**: The reconciler's existence is invisible to operators when nothing is drifting — no spurious banners, no excess log noise, no `pooler_events` rows for the consistent path.
- **SC-008**: Zero regressions in the existing feature 005 happy path (provision → register on running → unregister on delete) — verified by the existing feature 005 quickstart still passing post-deploy.

## Assumptions

- The supabase template's per-instance Postgres `pg_hba.conf` allows `host all all 127.0.0.1/32 trust` for connections from within the container. This is the standard supabase upstream template — already used during feature 005 to recover ASYO. If a future upstream template tightens this, US3's reset endpoint needs to find another path.
- Supavisor's `/api/tenants` and `DELETE /api/tenants/:external_id` endpoints behave per the existing pooler-client.ts contract (already proven in feature 005).
- One reconciler run per 24 hours is sufficient for the drift volumes supastack will see (a small-fleet hobbyist deployment, not a SaaS at scale). Operators wanting faster reconciliation can manually trigger via FR-008.
- The dashboard panel is a "Settings" surface only — no separate top-level "Database" navigation. Operators with no drift issues should never need to look at it.
- Connection-string reveal is a per-session UX state (not persisted) — refreshing the page re-redacts all rows.
- PG password drift is detectable specifically via auth error class; other registration failures (network, supavisor down, malformed payload) are kept under the generic `failed` status — only true auth-class errors flip to `pg_password_drift`.
- The 1-hour staleness threshold for retrying failed registrations (FR-004 `failed_stale`) is chosen to give a generous buffer for transient supavisor issues to self-resolve before we retry — and to avoid burning supavisor with tight retry loops for permanently broken instances.
- Reconciler events are NOT subject to retention sweeps in this feature; they accumulate until the existing `pooler_events` retention (if any) reaps them. Adding a retention policy is out of scope.
- Out of scope: per-instance metrics (request rate, queue depth — would require parsing supavisor's Prometheus surface); alerting integration (Slack, email — separate notification feature); reconciler dry-run mode; reconciliation across multi-region deployments (single-region today).
