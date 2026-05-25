# Phase 1: Data Model

**Feature**: 008-pooler-resilience

Schema changes are exclusively **additive** — no destructive migrations. One new table, additive columns on one existing table, additive enum values on text columns.

---

## NEW — `reconciler_runs` (control-plane DB)

Tracks the lifecycle of one reconciler cron run.

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `id` | uuid | PK, default `gen_random_uuid()` | Run identifier |
| `started_at` | timestamptz | NOT NULL, default `now()` | When the worker picked up the job |
| `completed_at` | timestamptz | NULL | Set on terminal status |
| `status` | text | NOT NULL, CHECK IN (`'running'`, `'success'`, `'partial_failure'`, `'failed'`), default `'running'` | Lifecycle state |
| `instances_seen` | integer | NOT NULL, default 0 | Total instances scanned this run |
| `actions_taken` | jsonb | NOT NULL, default `'{}'::jsonb` | Summary `{registered_missing, retried_success, retried_failed, unregistered_deleting, unregistered_orphan, password_drift_detected}` |
| `error_message` | text | NULL | Populated on `failed` (e.g., `supavisor_unreachable`) |
| `trigger_source` | text | NOT NULL, CHECK IN (`'cron'`, `'manual'`) | What kicked off the run |
| `actor_id` | uuid | NULL, FK → `users.id` | Only set for `trigger_source='manual'` |

**Indexes**:
- `idx_reconciler_runs_started_at ON (started_at DESC)` — dashboard query
- `uq_reconciler_runs_one_running ON (status) WHERE status = 'running'` — partial unique, enforces FR-002 single-in-flight

**Lifecycle**:
```
(cron tick / manual trigger)
        ↓
   [ running ]   started_at = now()
        │
        ├─→ success: all instances reconciled OK (or no-op consistent)
        ├─→ partial_failure: ≥1 instance failed, others OK; per-instance failures in pooler_events
        └─→ failed: whole run aborted (e.g., supavisor unreachable)
                completed_at = now(), error_message populated
```

**GC**: at the start of each run, `DELETE FROM reconciler_runs WHERE id NOT IN (SELECT id FROM reconciler_runs ORDER BY started_at DESC LIMIT 30)`. Per Decision 11.

**Stale-running cleanup** (FR-002 implicit): at the start of each run, also flip any `running` rows older than 1 hour to `failed` with `error_message='worker_crash_detected'` — prevents permanent lock from a crashed worker.

---

## EXISTING — `pooler_tenants` (additive changes)

### New status value

`status` is currently a text column with CHECK IN (`'registering', 'active', 'failed', 'rotating'`). Add `'pg_password_drift'`:
```sql
ALTER TABLE pooler_tenants DROP CONSTRAINT pooler_tenants_status_check;
ALTER TABLE pooler_tenants ADD CONSTRAINT pooler_tenants_status_check
  CHECK (status IN ('registering', 'active', 'failed', 'rotating', 'pg_password_drift'));
```

### New column

| Column | Type | Constraints | Notes |
|---|---|---|---|
| `last_reconciled_at` | timestamptz | NULL | Set by reconciler on every classification (including no-op consistent). Dashboard's "last reconciled" display. |

---

## EXISTING — `pooler_events` (additive changes only)

No schema change. New `event` text values that callers will emit:
- `reconciler.registered_missing` — reconciler created the row that wasn't there
- `reconciler.retry_succeeded` — failed→active transition
- `reconciler.retry_failed` — failed retry, row stays failed
- `reconciler.unregistered_deleting` — tenant unregistered because instance moved to `deleting`
- `reconciler.unregistered_orphan` — supavisor tenant removed because no matching instance
- `reconciler.password_drift_detected` — auth probe confirmed drift; status flipped to `pg_password_drift`
- `password_reset_then_registered` — operator triggered reset + next reconciler tick re-registered cleanly

`detail` jsonb captures relevant context per event type (e.g., `{ error: '...', supavisor_status: 503 }`).

---

## EXISTING — `supabase_instances` (additive: new provision_error code; no schema change)

`provision_error` is already a free-text column. New canonical value:
- `pg_password_drift_at_provision` — provision-time auth probe failed after 3 retries

Documented in the instance lifecycle docs; not a CHECK constraint (provision_error is intentionally free-form for human-readable errors).

---

## EXISTING — `audit_log` (additive: new event_type; no schema change)

`event_type` is a free-text column. New event types:
- `instances.pg_password.reset` (severity: `high`) — emitted by reset endpoint
- `pooler.reconciler.manual_trigger` (severity: `normal`) — emitted by manual run endpoint

---

## Cross-feature touch points

- **Feature 005's `pooler_tenants` / `pooler_events`**: extended additively; reconciler reads + writes these.
- **Feature 005's pooler-tenants.ts service**: `registerTenantForInstance` will gain awareness of the `pg_password_drift` classification (calls into the active probe on auth failure).
- **Feature 006 US2's `per-instance-pg.ts`**: REUSED unchanged for the active probe + the provision-time auth verify.
- **Feature 004's wildcard cert flow**: unrelated.
- **Issue #14 (backups restore)**: documented that its restore worker SHOULD invoke the reset endpoint after data-dir swap to re-align passwords.

---

## Entity relationship diagram (text)

```
users (existing)
   │
   ├──< reconciler_runs (NEW) via actor_id  [manual triggers only]
   │
   └──< pooler_tenants (existing, edited)
            ├── status: + 'pg_password_drift'
            ├── + last_reconciled_at
            │
            └──< pooler_events (existing, new event types)

supabase_instances (existing)
   ├── provision_error: documented new value 'pg_password_drift_at_provision'
   │
   ├──< pooler_tenants (existing)
   │
   └── per-instance Postgres (out of band)
            ├── role: postgres            [ALTER target]
            └── role: supabase_admin     [ALTER target via 127.0.0.1 trust]
```
