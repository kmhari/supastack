-- 0009_project_config_snapshots.sql
--
-- Feature 009 — runtime config tunables (postgres-config + auth-config).
--
-- Adds:
--   project_config_snapshots — one row per (instance_ref, surface),
--   where surface ∈ {'postgrest','auth'}. Holds the full post-merge
--   config (encrypted with the master key) returned on GET and merged
--   against on PATCH (for the secret-sentinel round-trip rule).
--
-- The per-instance `.env` remains the source of truth for container
-- behavior; this table is the source of truth for what the GET endpoint
-- returns and for the existing-value lookup the `***`-merge needs.
--
-- All idempotent.

CREATE TABLE IF NOT EXISTS project_config_snapshots (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref      text        NOT NULL,
  surface           text        NOT NULL,
  encrypted_payload bytea       NOT NULL,
  version           bigint      NOT NULL DEFAULT 1,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_surface_check
      CHECK (surface IN ('postgrest', 'auth'));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_instance_ref_fkey'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_instance_ref_fkey
      FOREIGN KEY (instance_ref) REFERENCES supabase_instances(ref) ON DELETE CASCADE;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_updated_by_fkey'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_updated_by_fkey
      FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END$$;

CREATE UNIQUE INDEX IF NOT EXISTS project_config_snapshots_unique
  ON project_config_snapshots (instance_ref, surface);
