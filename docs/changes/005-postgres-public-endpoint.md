# Feature 005 — Postgres public endpoint (`db.<ref>.<apex>:5432` + `pooler.<apex>:6543`)

**Closed**: Issue #3
**Status**: ✅ shipped, live on production
**Spec**: [specs/005-postgres-public-endpoint/](../../specs/005-postgres-public-endpoint/)

## What changed

Before: the `supabase` CLI's `db push/pull/diff/migration` commands required `--db-url postgresql://...` explicitly because each per-instance Postgres was reachable only on a dynamically-allocated host port (`host.docker.internal:30005` or similar). No DNS, no TLS.

After: every project exposes Postgres at two public endpoints:

- `db.<ref>.<apex>:5432` — direct connection (one TLS context per project; bypass the pooler)
- `pooler.<apex>:6543` — top-level Supavisor (multi-tenant, transaction mode); clients use username `postgres.<ref>` per Supabase Cloud convention

The `supabase` CLI now works against `--linked` projects with no `--db-url` flag.

## Architecture (after 3 pivots)

The current shape is **Option B** from research.md, chosen after caddy-l4 SNI routing and per-instance supavisor both failed:

| Component                                            | Role                                                                                                                                                                                                                                                                                      |
| ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Custom STARTTLS+SNI proxy** in api container       | Owns port 5432 on the host. Reads SNI from the incoming TLS, looks up project by hostname, terminates TLS with the appropriate cert (per-project if present, else wildcard), forwards plain Postgres traffic to `host.docker.internal:<port_db_direct>`.                                  |
| **Top-level Supavisor** (`supabase/supavisor:2.7.4`) | Multi-tenant pooler at `pooler.<apex>:6543`. Each project registered as a tenant via supavisor's admin HTTP API. TLS termination via the wildcard cert (`GLOBAL_DOWNSTREAM_CERT_PATH`).                                                                                                   |
| **`pooler_tenants` table** (control plane)           | Supastack's view of tenant registration state. Separate from supavisor's own `_supavisor.tenants` because we need lifecycle tracking + error reporting; reconciled by feature 008's reconciler.                                                                                            |
| **Per-project ACME cert** (Phase 7)                  | Strict-TLS clients (`rustls`, `sqlx`, `supabase db diff`) reject the wildcard cert for `db.<ref>.<apex>` because RFC 6125 wildcards match only one DNS label. The api auto-issues a per-project HTTP-01 cert for `db.<ref>.<apex>` ~30s after provision. Stored in `pg_edge_certs` table. |

## Endpoints / surfaces

| Endpoint                                              | What it does                                                                                             |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `POST /internal/pooler/tenants` (worker → api)        | Register a project as a tenant in supavisor; called from `provision.ts` after instance reaches `running` |
| `DELETE /internal/pooler/tenants/:ref` (worker → api) | Unregister tenant on project delete                                                                      |
| `POST /internal/pg-edge-cert/issue` (worker → api)    | Trigger per-project HTTP-01 cert issuance                                                                |
| `POST /.well-known/acme-challenge/:token`             | HTTP-01 challenge response endpoint (proxied through caddy at the apex)                                  |
| `apps/api/src/services/pg-edge-proxy.ts`              | The TCP proxy (Node.js `net` + `tls`); SNICallback per cert                                              |

## CLI workflow that this unblocks

```bash
# Before feature 005:
supabase db push --db-url "postgresql://postgres:<pwd>@<vm-ip>:30005/postgres"

# After feature 005:
supabase link --project-ref <ref>
supabase db push           # works without --db-url!
supabase db pull           # ditto
supabase db diff           # uses --linked, requires strict-TLS — works via per-project cert
supabase migration up      # = db push for new migrations
```

For pooled connections (e.g. serverless lambdas where you want connection reuse):

```text
postgresql://postgres.<ref>:<pwd>@pooler.<apex>:6543/postgres?sslmode=require
```

## Lifecycle

| Trigger                                     | Worker action                                                                               | Resulting state                                                                                                        |
| ------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Provision: instance reaches `running`       | Best-effort call `POST /internal/pooler/tenants` + enqueue HTTP-01 cert job                 | `pooler_tenants` row `active`, `pg_edge_certs` row populated within 30s                                                |
| Delete: instance status flips to `deleting` | Call `DELETE /internal/pooler/tenants/:ref`; worker's lifecycle job removes the row         | Supavisor's tenant table cleaned, `pooler_tenants` row deleted                                                         |
| Per-project cert nearing expiry             | Cert-check BullMQ job notices `notAfter - now < 30 days`, enqueues a fresh HTTP-01 issuance | New cert in `pg_edge_certs`, Redis pub/sub `supastack:pg-edge-cert:issued` triggers pg-edge-proxy to hot-reload SNI map |

## Cross-feature touch points

- **Feature 004's wildcard cert** is used by supavisor + pg-edge-proxy as the default cert when no per-project cert exists
- **Feature 008's reconciler** continuously reconciles `pooler_tenants` against the actual supavisor state (handles drift from supavisor restarts, manual ops, etc.)
- **Feature 006 US2 (migrations)** uses the same `host.docker.internal:<port_db_direct>` channel via `per-instance-pg.ts` helper to read/write `supabase_migrations.schema_migrations`

## Pre-existing pivots (left in the spec for posterity)

1. **caddy-l4 with Postgres matcher** — caddy-l4 v0.1.1 has a Postgres SNI matcher but no Postgres handler; can't write the STARTTLS 'S' acknowledgement byte. Abandoned.
2. **Top-level supavisor with bare `postgres` username** — Supavisor 2.7.4 has a SNI bug where `get_pool_config` crashes with "comparison with nil is forbidden" for plain `postgres` username. Pivoted to `postgres.<ref>` convention to match Supabase Cloud (and avoid the bug).
3. **Per-instance supavisor** — would add a supavisor container per project. Wasteful: sibling containers (auth, rest, storage, realtime, meta) connect direct to `db:5432` via internal docker network anyway. Removed in favor of one top-level supavisor.

## Key files

- `apps/api/src/services/pg-edge-proxy.ts` — the custom STARTTLS+SNI proxy
- `apps/api/src/services/pooler-client.ts` — supavisor admin HTTP client (HS256 JWT)
- `apps/api/src/services/pooler-tenants.ts` — register/unregister lifecycle
- `apps/api/src/routes/pooler-internal.ts` — worker-facing endpoints
- `apps/worker/src/jobs/pg-edge-cert-issue.ts` — HTTP-01 cert issuance worker
- `infra/docker-compose.yml` — supavisor service definition
- `packages/db/migrations/0005_pooler_tenants.sql`
- `packages/db/migrations/0006_pg_edge_certs.sql`
