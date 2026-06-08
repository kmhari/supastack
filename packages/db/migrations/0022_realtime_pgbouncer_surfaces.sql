-- 0022_realtime_pgbouncer_surfaces.sql
--
-- Feature 112 — add 'realtime' and 'pgbouncer' to the project_config_snapshots
-- surface enum so realtime and pgbouncer configs are persisted per-project.
--
-- Uses the conditional pattern (like 0014) so re-running is a no-op when the
-- wider constraint already exists.

DO $$ BEGIN
  -- Drop the constraint only if it exists WITHOUT 'realtime' (i.e. old 4-surface form)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%realtime%'
  ) THEN
    ALTER TABLE project_config_snapshots
      DROP CONSTRAINT project_config_snapshots_surface_check;
  END IF;

  -- Add the 6-surface constraint only if no constraint exists yet
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_surface_check
      CHECK (surface IN ('postgrest', 'auth', 'postgres', 'storage', 'realtime', 'pgbouncer'));
  END IF;
END $$;
