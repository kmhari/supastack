-- 0014_postgres_config_surface.sql
--
-- Feature 026 — supabase config push compat: postgres-config endpoint.
--
-- Widens the project_config_snapshots surface CHECK to include 'postgres'
-- so GET/PUT /v1/projects/:ref/config/database/postgres can persist its
-- snapshot alongside 'postgrest' and 'auth'.
--
-- Idempotent: drops and recreates the constraint only if the old narrow
-- form exists; leaves it alone if already widened.

DO $$
BEGIN
  -- Drop the old narrow constraint if it exists
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
      AND pg_get_constraintdef(oid) LIKE '%postgrest%'
      AND pg_get_constraintdef(oid) NOT LIKE '%postgres%'
  ) THEN
    ALTER TABLE project_config_snapshots
      DROP CONSTRAINT project_config_snapshots_surface_check;
  END IF;

  -- Add the wider constraint if it doesn't exist yet
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_surface_check
      CHECK (surface IN ('postgrest', 'auth', 'postgres'));
  END IF;
END$$;
