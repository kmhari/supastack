-- 0005_pooler_tenants.sql
--
-- Selfbase's own bookkeeping for top-level Supavisor pooler tenants
-- (feature 005). Separate from supavisor's _supavisor.tenants (which it
-- manages via Ecto). Selfbase reconciles between the two.
--
-- Adds the `port_db_direct` column to supabase_instances for new instances
-- created after this feature ships. Pre-existing instances have NULL until
-- they're re-provisioned or the operator manually allocates a port.
--
-- Idempotent — IF NOT EXISTS / ADD COLUMN IF NOT EXISTS everywhere.

-- ─── 1. supabase_instances.port_db_direct + port_allocations 'dbDirect' kind ──
ALTER TABLE supabase_instances
  ADD COLUMN IF NOT EXISTS port_db_direct integer UNIQUE;

-- Loosen the kind CHECK to include 'dbDirect' (and keep existing values).
ALTER TABLE port_allocations
  DROP CONSTRAINT IF EXISTS port_allocations_kind_check;
ALTER TABLE port_allocations
  ADD CONSTRAINT port_allocations_kind_check
  CHECK (kind IN ('kong','studio','postgres','pooler','analytics','dbDirect'));

-- ─── 2. pooler_tenants — selfbase's tracking table ────────────────────────────
CREATE TABLE IF NOT EXISTS pooler_tenants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  external_id     text        NOT NULL,
  sni_hostname    text        NOT NULL,
  pool_size       integer     NOT NULL DEFAULT 20,
  max_clients     integer     NOT NULL DEFAULT 100,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  last_health_at  timestamptz,
  status          text        NOT NULL DEFAULT 'registering'
                                CHECK (status IN ('registering','active','failed','orphaned')),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pooler_tenants_external_id_unique
  ON pooler_tenants (external_id);
CREATE INDEX IF NOT EXISTS pooler_tenants_instance_idx
  ON pooler_tenants (instance_ref);
CREATE INDEX IF NOT EXISTS pooler_tenants_status_idx
  ON pooler_tenants (status);

-- ─── 3. pooler_events — append-only audit ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS pooler_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        REFERENCES pooler_tenants(id) ON DELETE CASCADE,
  external_id text        NOT NULL,
  event       text        NOT NULL CHECK (event IN (
                            'register','register_failed','unregister','unregister_failed',
                            'reconcile_orphan','reconcile_missing','reconcile_rotate',
                            'health_ok','health_fail'
                          )),
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pooler_events_tenant_idx
  ON pooler_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pooler_events_external_idx
  ON pooler_events (external_id, created_at DESC);
