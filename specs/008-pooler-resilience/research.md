# Phase 0: Research & Design Decisions

**Feature**: 008-pooler-resilience (reconciler + dashboard + PG password drift)

---

## Decision 1: Reconciler scheduling — BullMQ repeatable vs node-cron vs in-process setInterval

**Decision**: BullMQ repeatable job in `apps/worker`, cron expression `0 3 * * *`. Worker calls into a `pooler-reconciler.ts` service in `apps/api/src/services/` (via shared package or thin REST call). The api also exposes a manual trigger endpoint that enqueues the same job with a higher priority + no de-dupe.

**Rationale**:
- Matches existing patterns: feature 005's pooler-events worker, feature 004's cert-check repeatable job, feature 007's planned auto-cert-renewal cron. Consistent test + observability story.
- BullMQ's `repeat` option handles missed ticks (server restart) by firing the next scheduled time, not the missed one — appropriate for a drift-recovery loop where catching up isn't time-sensitive.
- Manual trigger endpoint reuses the same job code; only thing different is the trigger source.

**Alternatives considered**:
- **node-cron in-process**: lighter-weight but no persistence across api restarts, no built-in dedupe, no job visibility for ops. Loses observability.
- **PG `pg_cron`**: would push reconciler logic into SQL or into a function — not worth the architectural split when BullMQ is already in the stack.

---

## Decision 2: Reconciler concurrency control — DB partial unique index vs Redis SETNX vs BullMQ exclusive

**Decision**: Partial unique index on `reconciler_runs(status) WHERE status = 'running'` enforces at-most-one in-flight run at the DB layer. Workers acquire by INSERT; conflict on the unique index means another run is already active.

**Rationale**:
- Single source of truth; no two-system consistency to maintain.
- INSERT-then-fail is atomic and crash-safe (if the worker dies mid-run, the row stays `running` until the GC sweep flips stale `running` rows older than 1 hour to `failed`).
- Matches feature 006 US4's `restore_jobs` partial unique pattern (consistency across features).

**Alternatives considered**:
- **Redis SETNX with TTL**: works but doesn't survive Redis restarts cleanly; TTL tuning is fragile.
- **BullMQ exclusive worker (concurrency=1 on queue)**: would serialize but not surface "in-progress" state cleanly to the dashboard.

**Implementation note**: GC sweep for stale `running` rows runs as part of the start of every reconciler tick (FR-002 implicit guarantee that one tick recovers from prior crash).

---

## Decision 3: Drift-classification mechanism — pattern-match supavisor error vs active probe

**Decision**: On pooler registration failure, the reconciler runs an active probe via `withPerInstancePg` (existing helper from feature 006 US2). If the per-instance auth fails with the stored password → classify as `pg_password_drift`. If per-instance auth succeeds but supavisor still rejected → classify as generic `failed` with whatever error supavisor gave.

**Rationale**:
- Supavisor's error body format is not a stable contract; relying on substring matching ("password authentication failed") would silently misclassify on format changes.
- The active probe is the ground truth — same channel that the api uses for migrations and snippets read paths, well-tested.
- Adds ~50ms latency per registration failure (one extra connection + `SELECT 1`). Acceptable since failures are rare.

**Alternatives considered**:
- **Pattern-match supavisor's error body**: faster but brittle; explicit lesson from feature 005's per-instance supavisor pivot.
- **Always treat as `pg_password_drift` on auth-class HTTP status**: too aggressive, false positives possible (supavisor's own DB connection issues would surface as auth errors).

---

## Decision 4: Connection-string placement — Settings → Database panel vs per-project page

**Decision**: Connection strings (direct + pooled) live on the **per-project page** under a "Connection" tab. The Settings → Database pooler panel shows only operational state (health, per-tenant table, events, action buttons) — no connection strings.

**Rationale**:
- Mirrors Supabase Cloud's UX (developers expect connection info on the project page, not in global settings).
- Keeps the pooler panel focused on ops.
- The pooler panel's per-tenant table is already wide; adding connection strings + reveal-on-click would clutter it.

**Alternatives considered**:
- **Both places**: redundant, two UI surfaces to keep in sync.
- **Pooler panel only**: doesn't match where users look.

**Scope note**: The actual "Connection" tab on the project page is technically a small extension to existing dashboard work. If it doesn't exist yet, implementation reuses the secret-reveal pattern from the existing "API Keys" section.

---

## Decision 5: Provision-time auth probe — single-shot vs retry with backoff

**Decision**: Probe runs 3 times with 2s delay between attempts. Each attempt is the same `withPerInstancePg(ref, async (c) => c.query('SELECT 1'))`. First success exits OK; three failures with auth-class error (`28P01`) mark provision as `pg_password_drift_at_provision`. Three failures with other errors (network, timeout) propagate as a generic provision failure.

**Rationale**:
- Postgres healthcheck reports "ready" (via `pg_isready`) the moment the socket accepts connections, but the auth layer can take another ~500ms to be fully initialized. Single-shot probe would flake.
- 3 retries × 2s = 6s worst case before flagging drift. Within SC-009's 10-second budget.
- Discriminating auth-class errors from network errors is important: network errors during provision usually mean a deeper compose issue, not drift.

**Alternatives considered**:
- **Single-shot**: too racy.
- **Probe via `pg_isready` only**: doesn't exercise auth, so misses the entire point of the verify.
- **Probe via supavisor instead of direct PG**: adds a hop, supavisor itself may not have registered yet at provision-time.

---

## Decision 6: PG password reset — docker exec vs network connection via supabase_admin

**Decision**: `pg-password-reset.ts` service uses the Docker socket (mounted into the api container) to `exec` `psql -h 127.0.0.1 -U supabase_admin -d postgres -c "<ALTER ...>"` inside the per-instance db container. This is the same channel used during the manual ASYO fix in feature 005.

**Rationale**:
- The per-instance Postgres `pg_hba.conf` allows `host all all 127.0.0.1/32 trust` for connections from inside the container. From outside (the api container's docker network), connections require the actual password — which is exactly what's broken in the drift case.
- Docker socket is already mounted into the api container (used by feature 005's caddy-reload + restore worker patterns).
- `supabase_admin` is a true superuser; can ALTER both `postgres` and `supabase_admin` roles. The `postgres` role itself is NOT a superuser in supabase templates (we discovered this during ASYO recovery).

**Alternatives considered**:
- **Direct TCP connect from api → per-instance PG with stored password**: chicken-and-egg, that's exactly the credential that's broken.
- **`pg_dump` + `pg_restore` of the role catalog**: heavy-handed, risks unrelated catalog changes.
- **Mount the per-instance Postgres data dir into the api container**: violates compose isolation; would require docker compose changes.

**Implementation note**: ALTER statements run in a single transaction. The script construction is:
```sql
BEGIN;
ALTER USER postgres WITH PASSWORD '<escaped>';
ALTER USER supabase_admin WITH PASSWORD '<escaped>';
COMMIT;
```
Password is escaped via PG's standard `''` → `''''` rule. Transmitted via psql's `-c` flag, NOT via shell env (avoids leakage to docker exec's stdout/stderr).

---

## Decision 7: Synchronous reset → reconciler feedback loop

**Decision**: `POST /api/v1/instances/:ref/reset-pg-password` runs the ALTER, then synchronously kicks off a single-instance reconciliation pass (not a full reconciler run — just retry registration for THIS ref). Waits up to 5 seconds for the pass to complete. Response includes the new `pooler_tenants.status`. If the pass takes longer than 5s, response includes `{ message: 'Password reset; reconciler queued', reconciler_run_id }` and the dashboard's normal 10s polling picks up the result.

**Rationale**:
- Operator UX: clicking "Reset" must feel like a direct action. 5s is the sweet spot where most real reconciliations complete and the response is responsive.
- Single-instance pass (not full sweep) avoids long waits when many projects exist.
- Fallback to async + dashboard polling for the rare slow case.

**Alternatives considered**:
- **Pure async + "check back later"**: bad UX; operator has to refresh and guess.
- **Synchronous full reconciler sweep**: scales poorly with project count.
- **Synchronous reset but no reconciler trigger**: dashboard would still show `pg_password_drift` for up to 24h until the cron picks it up.

---

## Decision 8: Dashboard polling interval + cache invalidation

**Decision**: Dashboard panel polls `GET /api/v1/pooler/status` every 10 seconds while visible. After a user-initiated action (re-register, reset, run reconciler), the dashboard does an immediate refetch instead of waiting for the next poll tick.

**Rationale**:
- 10s is fast enough for "auto-update" feel without burning bandwidth.
- Immediate refetch on action keeps the UI responsive even if the server-side action is fast.
- Browser visibility API ensures we don't poll when the tab is hidden (standard React Query pattern).

**Alternatives considered**:
- **Server-sent events / WebSocket**: overkill for low-frequency state changes; adds infrastructure complexity.
- **5s polling**: too chatty.
- **30s polling**: feels stale during active troubleshooting.

---

## Decision 9: Reconciler events — when to emit, when to swallow

**Decision**: A `pooler_events` row is emitted ONLY when the reconciler takes an action (registered_missing, retry_succeeded, retry_failed, unregistered_deleting, unregistered_orphan, password_drift_detected, password_reset_then_registered). The no-op consistent path emits NOTHING. The reconciler-run summary (in `reconciler_runs`) records the action counts.

**Rationale**:
- SC-007 requires operator invisibility when nothing's drifting. Emitting an event per reconciliation per project (50 events daily for a quiet deployment) would defeat the purpose.
- The `reconciler_runs` row + its `actions_taken` jsonb is sufficient operational signal.

**Alternatives considered**:
- **Emit every reconciliation (including consistent)**: too noisy.
- **No per-action events, only the run summary**: loses traceability for individual recovery actions.

---

## Decision 10: Reset endpoint authorization — admin role lookup

**Decision**: Reuse the existing `app.requireAuth(req)` pattern + check `user.role` (or the existing RBAC helper used by other admin-only endpoints like /caddy-reload, /wildcard-cert/renew). Reset is admin-only per FR-016 (and the RBAC matrix from feature 006 plan).

**Rationale**:
- Pattern already in use; no new auth surface.

**Alternatives considered**:
- **Owner-only**: too restrictive; admins should have ops access.
- **Any authenticated**: too permissive; reset can mask issues if abused.

---

## Decision 11: Reconciler-run retention — sweep vs unbounded

**Decision**: Keep the last 30 reconciler_runs rows (sufficient for ~1 month of history). At the start of each run, DELETE rows older than the 30th most recent. Sweep is cheap (single DELETE with subquery).

**Rationale**:
- Dashboard shows the last 30 anyway; deeper history isn't needed.
- Keeps the table size bounded without a separate GC worker.

**Alternatives considered**:
- **Unbounded**: table grows forever; eventually queries get slow.
- **Separate GC worker**: extra infrastructure for what's basically a 1-line cleanup.
