-- 0010_instances_vault_enabled_at.sql
--
-- Feature 010 — secrets management (single-track via supabase_vault).
--
-- Adds a marker column on supabase_instances so the api's boot-time
-- backfill scan can find projects that still need pgsodium + supabase_vault
-- enabled (FR-002) without round-tripping to per-project Postgres.
--
-- Idempotent.

ALTER TABLE supabase_instances
  ADD COLUMN IF NOT EXISTS vault_enabled_at timestamptz NULL;

-- Partial index narrows the boot-scan query to only un-enabled rows.
CREATE INDEX IF NOT EXISTS idx_supabase_instances_vault_pending
  ON supabase_instances (vault_enabled_at)
  WHERE vault_enabled_at IS NULL;
