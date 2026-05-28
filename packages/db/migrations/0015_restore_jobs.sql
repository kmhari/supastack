-- 0015_restore_jobs.sql
--
-- Feature 019 — async backup restore worker (issue #14).
--
-- Adds:
--   1. restore_jobs table with a partial unique index that enforces at-most-one
--      in-flight restore per project (status IN ('pending','running')).
--   2. Widens the supabase_instances.status CHECK constraint to include
--      'restoring' (used while the worker owns the project stack).
--
-- Idempotent — IF NOT EXISTS / IF EXISTS guards on every statement.

-- ─── 1. restore_jobs ─────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS restore_jobs (
  id                     uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref           text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  backup_id              uuid        NOT NULL REFERENCES backups(id),
  status                 text        NOT NULL DEFAULT 'pending',
  started_at             timestamptz,
  completed_at           timestamptz,
  error_message          text,
  timeout_budget_seconds integer     NOT NULL,
  pre_restore_dir        text,
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT restore_jobs_status_check
    CHECK (status IN ('pending', 'running', 'success', 'failed'))
);

-- Partial unique index: only one job per project may be pending or running.
CREATE UNIQUE INDEX IF NOT EXISTS uq_restore_jobs_one_inflight
  ON restore_jobs (instance_ref)
  WHERE status IN ('pending', 'running');

-- ─── 2. widen supabase_instances.status CHECK to include 'restoring' ─────────
-- Drop the old constraint (if it exists without 'restoring') and recreate.
DO $$
BEGIN
  ALTER TABLE supabase_instances
    DROP CONSTRAINT IF EXISTS supabase_instances_status_check;
  ALTER TABLE supabase_instances
    ADD CONSTRAINT supabase_instances_status_check
      CHECK (status IN (
        'provisioning', 'running', 'paused', 'stopped',
        'failed', 'deleting', 'restoring'
      ));
END;
$$;
