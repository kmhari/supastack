-- 0021_realtime_pgbouncer_surfaces.sql
--
-- Feature 112 — add 'realtime' and 'pgbouncer' to the project_config_snapshots
-- surface enum so realtime and pgbouncer configs are persisted per-project.
--
-- Idempotent: DROP IF EXISTS + ADD with the wider set.

ALTER TABLE project_config_snapshots
  DROP CONSTRAINT IF EXISTS project_config_snapshots_surface_check;

ALTER TABLE project_config_snapshots
  ADD CONSTRAINT project_config_snapshots_surface_check
  CHECK (surface IN ('postgrest', 'auth', 'postgres', 'storage', 'realtime', 'pgbouncer'));
