# Feature 008 — Pooler resilience (reconciler + dashboard + PG password drift recovery)

**Closed**: Issues #7, #8, #9, PR #17
**Status**: ✅ all 3 user stories shipped, live on production
**Spec**: [specs/008-pooler-resilience/](../../specs/008-pooler-resilience/)
**Operator guide**: [docs/pooler-resilience.md](../pooler-resilience.md)

## What changed

Three feature-005 follow-ups bundled into one feature because they all touch the same operational surface (`pooler_tenants` + `pooler_events` + dashboard panel):

| Issue | User Story | What |
|---|---|---|
| **#7** reconciler cron | US1 | Daily BullMQ job at 03:00 UTC compares `supabase_instances × pooler_tenants × supavisor`; auto-recovers 5 classes of drift; manual trigger endpoint for ops |
| **#8** dashboard panel | US2 | Settings → Database UI with health pill, per-project table, recent runs, events tail, per-row actions |
| **#9** PG password drift | US3 | Provision-time auth probe (prevention), reconciler active-probe classification (detection), one-click reset endpoint (recovery) |

## US1 — reconciler

7 classifications + remediations:

| Classification | When | Remediation |
|---|---|---|
| `consistent` | All three sources agree | No-op (no event emitted — operator never sees these) |
| `missing_pooler_row` | Instance exists, no row | Re-register tenant |
| `missing_in_supavisor` | Row says `active` but supavisor doesn't know | Re-register |
| `failed_stale` | Row `status='failed'` for >1h | Retry register; on auth-class fail → flip to `pg_password_drift` |
| `instance_gone` | Tenant row but instance is `deleting`/gone | Unregister + delete row |
| `orphan_in_supavisor` | Supavisor has a tenant we don't | Unregister from supavisor |
| `pg_password_drift` | Auth-class failure confirmed by probe | Status stays; reset via reset-pg-password endpoint |

**Endpoints:**
- `POST /api/v1/pooler/reconciler/run` (admin-only) — manual trigger; 409 if already in flight
- Daily cron `0 3 * * *` UTC via BullMQ repeatable

**Concurrency**: partial unique index on `reconciler_runs(status) WHERE status = 'running'` enforces at-most-one-in-flight at the DB level.

## US2 — dashboard panel

Settings → Database (`/settings/database`):

- Supavisor health pill (Up/Down) + endpoint with copy button
- Per-project table: ref, name, instance status, tenant status badge, last_error, last_reconciled, supavisor presence, per-row actions
- Reconciler runs table (last 30) with status pills + action summaries
- Events tail (last 50) with timestamps + event type pills + truncated detail
- "Run reconciler now" button at top
- 10s auto-refresh while document visible; immediate refetch on action

**Endpoints:**
- `GET /api/v1/pooler/status` — aggregated state (supavisor health + projects + events + runs)
- `POST /api/v1/pooler/tenants/:ref/re-register` — sync single-tenant retry with forceRetry semantics; polls reconciler_runs for up to 5s; admin-only

## US3 — PG password drift (three layers)

### Prevention (provision-time probe — FR-014)

After `waitHealthy` + caddy reload, BEFORE `setStatus(running)`:

```ts
const probe = await probeAuthWithStoredPassword(ref);  // 3× retry, 2s delay
if (!probe.ok && probe.isAuthClass) {
  throw new Error('pg_password_drift_at_provision — ...');
}
```

Catches the most common drift cause: leftover data dir from a prior failed provision means `POSTGRES_PASSWORD` env is silently ignored (only honored on first init). Without this, the project ships broken.

### Detection (reconciler — FR-015)

`maybePromoteToDrift` always runs an active probe on registration failure. Pattern-matching supavisor's error string was unreliable across versions (`%DBConnection.ConnectionError{...}` doesn't contain "28P01"). The active probe is the ground truth — if it auth-fails, the row gets `status = 'pg_password_drift'` + `reconciler.password_drift_detected` event.

### Recovery (reset endpoint — FR-016)

```bash
POST /api/v1/instances/<ref>/reset-pg-password   # admin-only
```

1. Decrypt `encrypted_secrets.postgresPassword`
2. `docker exec` into `selfbase-<ref>-db-1` running `psql -h 127.0.0.1 -U supabase_admin -d postgres -c "BEGIN; ALTER USER postgres WITH PASSWORD '<escaped>'; ALTER USER supabase_admin WITH PASSWORD '<escaped>'; COMMIT;"`
3. Enqueue single-instance reconciler pass with priority 5
4. Poll `reconciler_runs` row for up to 5 seconds
5. Return `{ ref, reset_at, message, pooler_tenant_status, reconciler_run_id }`

PG password escape: `'` → `''` (PG standard rule). Tested in `apps/api/tests/unit/pg-password-reset.test.ts`.

127.0.0.1 trust auth works because the supabase template's `pg_hba.conf` has `host all all 127.0.0.1/32 trust` for connections from inside the container.

## Bugs found + fixed during implementation

1. **Worker missing `extra_hosts: host-gateway`** — probe couldn't resolve `host.docker.internal:<port_db_direct>` from inside worker container (api had this, worker didn't). Added to docker-compose.yml.
2. **Worker missing `SUPAVISOR_API_JWT_SECRET` env** — reconciler couldn't call supavisor. Added to compose.
3. **Supavisor 2.7.4 has no list-all endpoint** — `GET /api/tenants` returns 404; only `/api/tenants/:id` exists. Reconciler refactored to parallel per-tenant probes with `Promise.allSettled`.
4. **Drift classifier was string-matching supavisor errors** — Elixir `%DBConnection.ConnectionError{...}` doesn't contain "28P01". Refactored `maybePromoteToDrift` to always run the active probe per research.md Decision 3. Added it to `missing_pooler_row` + `missing_in_supavisor` failure paths (was only on `failed_stale`).
5. **Single-instance reconciler pass got stuck on staleness check** — added `forceRetry` flag so reset-pg-password flow doesn't wait an hour to re-attempt registration.

## Polish

| Task | Status |
|---|---|
| T029 vitest unit tests for pooler-reconciler service | Deferred to #16 (low-priority defense-in-depth) |
| T030 vitest for pg-password-probe | ✅ 6 tests — retry semantics, auth-class discrimination, defensive cleanup |
| T031 vitest for pg-password-reset | ✅ 6 tests — extracted `buildResetSql` + tested PG single-quote escape incl. injection edges |
| T032 operator runbook `docs/pooler-resilience.md` | ✅ |
| T033 final VM E2E | ✅ done inline during implementation |

## Schema changes (additive, idempotent)

- `reconciler_runs` (NEW): id, started_at, completed_at, status (running/success/partial_failure/failed), instances_seen, actions_taken jsonb, error_message, trigger_source (cron/manual), actor_id FK; partial unique index `uq_reconciler_runs_one_running` on `(status) WHERE status = 'running'`
- `pooler_tenants.status` += `'pg_password_drift'` (CHECK constraint widened)
- `pooler_tenants.last_reconciled_at timestamptz` (nullable, additive)
- `pooler_events.event` += `reconciler.registered_missing`, `reconciler.retry_succeeded`, `reconciler.retry_failed`, `reconciler.unregistered_deleting`, `reconciler.unregistered_orphan`, `reconciler.password_drift_detected`, `password_reset_then_registered`
- `supabase_instances.provision_error` += new canonical value `'pg_password_drift_at_provision'` (free-text column, no CHECK)
- `audit_log.action` += `'instances.pg_password.reset'` (severity high) + `'pooler.reconciler.manual_trigger'` (severity normal)

## RBAC additions

Four new actions in `packages/shared/src/rbac.ts`:
- `pooler.read` — admin + member (dashboard panel read access)
- `pooler.reregister` — admin only
- `pooler.reconciler.run` — admin only
- `instance.pg-password.reset` — admin only

## Key files

- `apps/worker/src/services/pooler-reconciler.ts` — core reconciler logic + state machine (self-contained, inlines supavisor client + per-instance PG probe)
- `apps/worker/src/jobs/pooler-reconciler.ts` — BullMQ handler (full vs single mode dispatch)
- `apps/worker/src/services/pg-password-probe.ts` — 3-retry auth probe
- `apps/worker/src/jobs/provision.ts` — provision-time probe integration (line ~159)
- `apps/api/src/services/pg-password-reset.ts` — docker exec + PG escape
- `apps/api/src/services/pooler-reconciler-client.ts` — api-side BullMQ enqueue + in-flight check
- `apps/api/src/routes/pooler-status.ts`, `pooler-reregister.ts`, `pooler-reconciler-run.ts`, `reset-pg-password.ts`
- `apps/web/src/pages/SettingsDatabase.tsx` — dashboard panel
- `packages/db/migrations/0008_reconciler_runs.sql`
- `apps/api/tests/unit/pg-password-reset.test.ts`, `apps/worker/tests/unit/pg-password-probe.test.ts`
