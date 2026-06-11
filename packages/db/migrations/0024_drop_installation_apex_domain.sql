-- 0024_drop_installation_apex_domain.sql
--
-- Feature 117 — single-source apex. The apex domain is now read solely from the
-- SUPASTACK_APEX env (via @supastack/shared getApex); the duplicate
-- installation.apex_domain column is removed so no second store can diverge
-- (closes #110). All readers were repointed to env before this migration.
--
-- Explicitly destructive (Constitution I permits intentional destructive change)
-- and idempotent: DROP COLUMN IF EXISTS → re-running the whole sequence is a
-- no-op. Dropping the column also removes its UNIQUE constraint. No backfill —
-- the authoritative value lives in env, not the DB.

ALTER TABLE installation DROP COLUMN IF EXISTS apex_domain;
