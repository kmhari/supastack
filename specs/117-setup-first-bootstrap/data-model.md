# Data Model — Feature 117 (Single-Source Apex)

This feature **removes** stored state rather than adding it. No new tables; one column dropped.

## Removed: `installation.apex_domain`

| Column | Was | Change |
|---|---|---|
| `installation.apex_domain` | `text('apex_domain').unique()` (nullable) | **DROPPED** — column + its `UNIQUE` constraint removed |

- **Migration**: `packages/db/migrations/0024_drop_installation_apex_domain.sql`
  ```sql
  ALTER TABLE installation DROP COLUMN IF EXISTS apex_domain;
  ```
  Idempotent (`IF EXISTS` → re-run is a no-op). **Explicitly destructive** — sanctioned by Constitution Principle I (intentional). No backfill: the authoritative value lives in `process.env.SUPASTACK_APEX`.
- **Schema**: remove the `apexDomain: text('apex_domain').unique()` line from the `installation` table in `packages/db/src/schema/identity.ts`. The `installation` singleton row (id=1, backup settings, timestamps) is unaffected and is still created at setup.
- **Writers removed** (so nothing references the dropped column):
  - `apps/api/src/routes/setup.ts:61,64` — the `installation` upsert no longer sets `apexDomain` (still upserts the singleton for its other fields).
  - `apps/api/src/routes/org.ts:45-48,61` — `PATCH /api/v1/org` no longer accepts/writes `apexDomain` (name-only); the apex-change reload trigger is removed.

## Authoritative source (not stored — read from env)

- **Apex domain** = `process.env.SUPASTACK_APEX`, accessed via `@supastack/shared`'s `getApex()` / `getApexOrThrow()` / `isRealApex()`. Set once at install (`.env`), read directly by routing, certs, identity-adjacent config, dashboard, and the per-instance worker jobs. There is no second copy.

## Readers repointed (DB → env)

All resolve via `getApex()` instead of `db().select({apex: installation.apexDomain})`:

| File | Site(s) | Role |
|---|---|---|
| `apps/api/src/routes/apex.ts` | `:35`, `:98` | `/apex` status (now env-backed → wizard skips input) |
| `apps/api/src/server.ts` | `:464`, `:483` | apex-status/config helper |
| `apps/api/src/routes/wildcard-certs.ts` | `:21,44,73,127` | wildcard cert order (apex + `*.apex`) |
| `apps/api/src/routes/tls-ask.ts` | `:45` | Caddy on-demand TLS allowlist |
| `apps/api/src/routes/connect-cli.ts` | `:29` | CLI connect host |
| `apps/api/src/routes/instances.ts` | `:73` | per-instance hostnames |
| `apps/api/src/routes/pooler-status.ts` | `:68` | pooler host |
| `apps/api/src/routes/admin.ts` | `:19` | admin fleet endpoints (feature 116) |
| `apps/api/src/routes/pg-edge-cert-internal.ts` | `:21` | per-project edge cert host |
| `apps/api/src/services/caddy-config.ts` | `:30` | **routing config generation** |
| `apps/api/src/services/pooler-tenants.ts` | `:27` | supavisor tenant host |
| `apps/worker/src/jobs/provision.ts` | `:63` | per-project provisioning hostnames |
| `apps/worker/src/services/pooler-reconciler.ts` | `:225` | pooler reconciliation host |

(`apps/api/src/services/pg-edge-proxy.ts` already receives `apexDomain` as a function arg from its caller — the caller is repointed; the proxy signature is unchanged.)

## Deleted

- `apps/api/src/services/apex-resolver.ts` — the unreachable two-source `resolveApex()` (FR-013); zero importers (verified).

## Request-shape changes (dashboard surface only — no `/v1` drift)

- `@supastack/shared` `schemas.ts`: remove `apexDomain` from the **Setup** body schema (`:24`) and the **Org patch** schema (`:112`).
- `apps/web/src/lib/api.ts`: remove `apexDomain` from `setupApi.run` (`:57`) and `orgApi.patch` (`:116`) body types.
- `apps/api/src/routes/org.ts:19,71`: remove `apexDomain` from the org response projection.

## Environment / infra

- `infra/docker-compose.yml` **worker** service: add `SUPASTACK_APEX: ${SUPASTACK_APEX:?SUPASTACK_APEX required}` (the worker reads the apex but currently has no such env — required after the column drop).
