-- 0004_supavisor_schema.sql
--
-- Pre-create the schema that the top-level Supavisor pooler service will use
-- for its own Ecto-managed tables (feature 005, Phase 2 / US3 — pooler
-- endpoint). Supavisor creates the tables inside _supavisor on first boot via
-- `bin/supavisor eval "Supavisor.Release.migrate"`.
--
-- We DO NOT manage these tables from supastack. Tenant ops go through supavisor's
-- HTTP admin API. See specs/005-postgres-public-endpoint/contracts/tenant-registration.md.

CREATE SCHEMA IF NOT EXISTS _supavisor;
