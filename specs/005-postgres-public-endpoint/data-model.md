# Data Model: Postgres Public Endpoint via Top-Level Pooler

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23 (rewritten post-pivot)

---

## New Entities

### 1. pooler_tenants (selfbase's tracking table)

Selfbase's own bookkeeping for which instances have public Postgres endpoints. Separate from supavisor's internal `_supavisor.tenants` table — owned and maintained by selfbase.

```sql
CREATE TABLE IF NOT EXISTS pooler_tenants (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  external_id     text        NOT NULL,                   -- = instance ref; what supavisor uses
  sni_hostname    text        NOT NULL,                   -- db.<ref>.<apex>
  pool_size       integer     NOT NULL DEFAULT 20,
  max_clients     integer     NOT NULL DEFAULT 100,
  registered_at   timestamptz NOT NULL DEFAULT now(),
  last_health_at  timestamptz,
  status          text        NOT NULL DEFAULT 'registering'
                                CHECK (status IN ('registering', 'active', 'failed', 'orphaned')),
  last_error      text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pooler_tenants_external_id_unique ON pooler_tenants (external_id);
CREATE INDEX IF NOT EXISTS pooler_tenants_instance_idx ON pooler_tenants (instance_ref);
CREATE INDEX IF NOT EXISTS pooler_tenants_status_idx ON pooler_tenants (status);
```

**Fields**:
- `instance_ref` — FK to `supabase_instances.ref`. ON DELETE CASCADE so deleting the instance cleans this up.
- `external_id` — what supavisor identifies the tenant by; same value as `instance_ref` for consistency. UNIQUE.
- `sni_hostname` — denormalized for easy filtering/display: `db.<ref>.<apex>`. Re-computed from `org.apex_domain` on register; reconciler updates if apex changes.
- `pool_size` / `max_clients` — per-tenant supavisor config. Defaults match Supabase Cloud (20 / 100). Future: tunable per-project from dashboard.
- `status` — lifecycle state (see transitions below).
- `last_error` — last failure message; cleared on successful register/reconcile.
- `last_health_at` — populated by the reconciler when health check succeeds.

**State transitions**:
```
   (api inserts on instance provision)
              ▼
        registering
              │  supavisor HTTP register OK
              ▼
            active ◄─────────┐
              │              │ (reconciler fixes drift)
              │ (orphan detected: instance gone but row remains)
              ▼              │
          orphaned ──────────┘ (cleanup deletes row)

   registering ──(supavisor HTTP fails > 60s)──> failed
       failed ──(reconciler retry succeeds)──> active
```

---

### 2. pooler_events (audit table)

Append-only audit of every tenant lifecycle event. Surfaces in the dashboard for debugging + compliance.

```sql
CREATE TABLE IF NOT EXISTS pooler_events (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid        REFERENCES pooler_tenants(id) ON DELETE CASCADE,
  external_id text        NOT NULL,                  -- denormalized for queries after tenant deletion
  event       text        NOT NULL CHECK (event IN (
                            'register', 'register_failed', 'unregister', 'unregister_failed',
                            'reconcile_orphan', 'reconcile_missing', 'reconcile_rotate',
                            'health_ok', 'health_fail'
                          )),
  detail      jsonb,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pooler_events_tenant_idx ON pooler_events (tenant_id, created_at DESC);
CREATE INDEX IF NOT EXISTS pooler_events_external_idx ON pooler_events (external_id, created_at DESC);
```

`detail` JSON shape varies by event:
- `register` / `unregister`: `{ sni_hostname, pool_size }`
- `*_failed`: `{ error }`
- `reconcile_*`: `{ before, after }`
- `health_*`: `{ active_connections, pool_size }`

---

## New Schema (supavisor's own)

### `_supavisor` schema (Ecto-managed)

Created by supavisor on first boot. Selfbase pre-creates the empty schema for organization:

```sql
-- 0004_supavisor_schema.sql
CREATE SCHEMA IF NOT EXISTS _supavisor;
```

Tables supavisor creates inside `_supavisor` (FOR REFERENCE ONLY — managed by supavisor, not by selfbase):
- `tenants` — external_id, db_host, db_port, db_database, default_pool_size, default_max_clients, sni_hostname, auth_query, ...
- `users` — db_user, db_password (encrypted by supavisor's VAULT_ENC_KEY), pool_size, mode_type, ...
- `cluster_tenants` — cluster routing config (we don't use cluster mode)
- `oban_*` — Ecto background job tables (supavisor's internal scheduler)

**Selfbase NEVER writes to these tables directly.** All tenant ops go through supavisor's HTTP admin API. This protects supavisor's internal invariants (encryption, schema version, foreign keys).

---

## Modified Entities

### supabase_instances (existing) — no schema change

Continues to be the source of truth for instances. `port_postgres` field unchanged (still supavisor's host port on the per-instance compose). NEW field added in the per-instance .env via compose-template: `POSTGRES_DIRECT_HOST_PORT` (host port for the per-instance Postgres `db:5432`). The allocation reuses the existing port pool — one more port per instance.

### audit_log (existing) — no schema change

New action values added:
- `pooler.tenant.register` / `pooler.tenant.unregister`
- `pooler.reconcile.orphan` / `pooler.reconcile.missing`
- `pooler.health.degraded` / `pooler.health.recovered`

---

## Entity Relationships

```
supabase_instances (1) ──── (0..1) pooler_tenants ──── (*) pooler_events
                                          │
                                          │ (mirrored via supavisor HTTP API)
                                          ▼
                              _supavisor.tenants (supavisor-owned)
```

Invariants:
- Every non-deleting `supabase_instances` row SHOULD have exactly one `pooler_tenants` row with `status='active'`.
- Every `pooler_tenants` row SHOULD have a corresponding entry in `_supavisor.tenants`.
- The daily reconciler enforces both invariants.

---

## Selfbase Drizzle Schema

**New file**: `packages/db/src/schema/pooler.ts`

```ts
export const poolerTenants = pgTable('pooler_tenants', { ... });
export const poolerEvents = pgTable('pooler_events', { ... });
```

**Edit**: `packages/db/src/schema/index.ts` — `export * from './pooler.js'`

---

## Per-Instance Compose Inputs

`packages/docker-control/src/compose-template.ts` adds one new env var to the rendered .env:

| Var | Value | Purpose |
|---|---|---|
| `POSTGRES_DIRECT_HOST_PORT` | `ports.postgresDirect` | Host port where per-instance db:5432 is published, reachable from supavisor via `host.docker.internal:<port>` |

Port allocator (`packages/db/src/port-allocator.ts`) gets a new slot `postgresDirect` alongside `kong`, `studio`, `postgres`, `pooler`, `analytics`.

The per-instance `docker-compose.yml` template (`infra/supabase-template/docker-compose.yml`) gains a `ports:` block on the `db` service:

```yaml
db:
  ports:
    - ${POSTGRES_DIRECT_HOST_PORT}:5432   # SELFBASE PATCH (feature 005)
```

---

## Migration Files

| File | Purpose |
|---|---|
| `packages/db/migrations/0004_supavisor_schema.sql` | `CREATE SCHEMA IF NOT EXISTS _supavisor` |
| `packages/db/migrations/0005_pooler_tenants.sql` | `pooler_tenants` + `pooler_events` |
| `packages/db/migrations/0006_port_allocator_direct.sql` | If port-allocator uses a DB-backed pool, add `postgres_direct` column. If in-memory, no migration needed. |

All idempotent (`IF NOT EXISTS`).
