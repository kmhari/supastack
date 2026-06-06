-- 0020_storage_config_surface.sql
--
-- Feature 108 — add 'storage' to the project_config_snapshots surface enum
-- so Studio's fileSizeLimit setting is persisted per-project.
--
-- The check constraint is DROP+CREATE (non-transactional DDL in PG, but
-- idempotent: the new constraint name will conflict on re-run, caught by
-- the IF NOT EXISTS guard on the new CREATE).

ALTER TABLE project_config_snapshots
  DROP CONSTRAINT IF EXISTS project_config_snapshots_surface_check;

ALTER TABLE project_config_snapshots
  ADD CONSTRAINT project_config_snapshots_surface_check
  CHECK (surface IN ('postgrest', 'auth', 'postgres', 'storage'));
