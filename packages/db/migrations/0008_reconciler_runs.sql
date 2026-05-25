-- 0008_reconciler_runs.sql
--
-- Feature 008 — pooler resilience.
--
-- Adds:
--   1. reconciler_runs table — tracks lifecycle of each pooler-reconciler
--      cron tick / manual trigger (US1).
--   2. pooler_tenants.status += 'pg_password_drift' (US3 — distinct from
--      generic 'failed' so the dashboard surfaces the reset-password CTA).
--   3. pooler_tenants.last_reconciled_at column (US2 — dashboard column).
--   4. pooler_events.event += new reconciler.* values (US1).
--
-- All idempotent.

-- ─── 1. reconciler_runs ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS reconciler_runs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  started_at      timestamptz NOT NULL DEFAULT now(),
  completed_at    timestamptz,
  status          text        NOT NULL DEFAULT 'running'
                                CHECK (status IN ('running','success','partial_failure','failed')),
  instances_seen  integer     NOT NULL DEFAULT 0,
  actions_taken   jsonb       NOT NULL DEFAULT '{}'::jsonb,
  error_message   text,
  trigger_source  text        NOT NULL DEFAULT 'cron'
                                CHECK (trigger_source IN ('cron','manual')),
  actor_id        uuid        REFERENCES users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_reconciler_runs_started_at
  ON reconciler_runs (started_at DESC);

-- Partial unique index: at most one row in 'running' status at a time.
CREATE UNIQUE INDEX IF NOT EXISTS uq_reconciler_runs_one_running
  ON reconciler_runs (status) WHERE status = 'running';

-- ─── 2. pooler_tenants.status — add 'pg_password_drift' ─────────────────────
ALTER TABLE pooler_tenants
  DROP CONSTRAINT IF EXISTS pooler_tenants_status_check;
ALTER TABLE pooler_tenants
  ADD CONSTRAINT pooler_tenants_status_check
  CHECK (status IN ('registering','active','failed','orphaned','pg_password_drift'));

-- ─── 3. pooler_tenants.last_reconciled_at ───────────────────────────────────
ALTER TABLE pooler_tenants
  ADD COLUMN IF NOT EXISTS last_reconciled_at timestamptz;

-- ─── 4. pooler_events.event — add reconciler.* values ──────────────────────
ALTER TABLE pooler_events
  DROP CONSTRAINT IF EXISTS pooler_events_event_check;
ALTER TABLE pooler_events
  ADD CONSTRAINT pooler_events_event_check
  CHECK (event IN (
    -- existing values
    'register','register_failed','unregister','unregister_failed',
    'reconcile_orphan','reconcile_missing','reconcile_rotate',
    'health_ok','health_fail',
    -- feature 008 reconciler actions
    'reconciler.registered_missing','reconciler.retry_succeeded','reconciler.retry_failed',
    'reconciler.unregistered_deleting','reconciler.unregistered_orphan',
    'reconciler.password_drift_detected','password_reset_then_registered'
  ));
