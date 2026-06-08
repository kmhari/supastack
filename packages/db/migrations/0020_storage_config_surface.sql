-- 0020_storage_config_surface.sql
--
-- Feature 108 — add 'storage' to the project_config_snapshots surface enum
-- so Studio's fileSizeLimit setting is persisted per-project.
--
-- Uses the conditional pattern (like 0014) so re-running after wider constraints
-- are added by later migrations (0022) does not clobber them.

DO $$ BEGIN
  -- Drop the constraint only if it exists WITHOUT 'storage' (i.e. old narrow form)
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
      AND pg_get_constraintdef(oid) NOT LIKE '%storage%'
  ) THEN
    ALTER TABLE project_config_snapshots
      DROP CONSTRAINT project_config_snapshots_surface_check;
  END IF;

  -- Add the 4-surface constraint only if no constraint exists yet
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'project_config_snapshots_surface_check'
  ) THEN
    ALTER TABLE project_config_snapshots
      ADD CONSTRAINT project_config_snapshots_surface_check
      CHECK (surface IN ('postgrest', 'auth', 'postgres', 'storage'));
  END IF;
END $$;
