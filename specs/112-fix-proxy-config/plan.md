# Implementation Plan: Fix Platform Proxy — Profile, Realtime & PgBouncer Config

**Branch**: `112-fix-proxy-config` | **Date**: 2026-06-08 | **Spec**: [spec.md](spec.md)

## Summary

Five platform endpoints return wrong/hardcoded data. Fix: (1) proxy `GET /platform/profile` to the
real `/v1/profile` handler with Studio augmentation; (2) implement store-only realtime config at
`/v1/projects/:ref/config/realtime` + proxy from platform; (3) same for pgbouncer at
`/v1/projects/:ref/config/database/pgbouncer` + `PATCH .../pooler` + proxy from platform. All three
use the existing `project_config_snapshots` store; realtime and pgbouncer need a DB migration to
widen the surface CHECK constraint plus a lightweight "store-only" save path that avoids env-writing
and container restart.

## Technical Context

**Language/Version**: TypeScript (Node 20, strict)

**Primary Dependencies**: Fastify (routes), Drizzle ORM (DB), Zod (validation), `@supastack/shared`
(schemas + RBAC), `runtime-config-store.ts` (snapshot read/write)

**Storage**: `project_config_snapshots` table (existing) — one row per `(instance_ref, surface)`,
`surface` text column with CHECK constraint currently allows `'postgrest' | 'auth' | 'postgres' |
'storage'`. Must be widened to include `'realtime'` and `'pgbouncer'`.

**Testing**: Vitest unit tests in `apps/api/tests/unit/`

**Target Platform**: Linux server (control-plane api container)

**Constraints**: No new DB tables. PATCH for realtime/pgbouncer is store-only — no `.env` write, no
container restart (same deferred-apply posture as `postgrest` config). RBAC reuses existing
`data_api_config.read` / `data_api_config.write` actions.

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| I — Idempotent Migrations | ✅ PASS | New migration uses `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` — fully idempotent |
| II — Secrets Stay Encrypted | ✅ PASS | No secrets in realtime/pgbouncer config; profile returns `primary_email` only, no tokens |
| III — Authorize Every Action | ✅ PASS | Reuse existing `data_api_config.read` / `data_api_config.write` actions (already in RBAC matrix) |
| IV — Supabase Compatibility | ✅ PASS | New `/v1/*` routes match upstream OpenAPI shapes for realtime and pgbouncer; contract tests added |
| V — Worker Owns Per-Instance State | ✅ PASS | No per-instance container changes; store-only — no worker jobs needed |
| VI — Spec-Driven Delivery | ✅ PASS | Full spec → plan → tasks → implement cycle |

## Project Structure

### Documentation (this feature)

```text
specs/112-fix-proxy-config/
├── plan.md            ← this file
├── research.md        ← below
├── contracts/
│   ├── profile.md
│   ├── realtime-config.md
│   └── pgbouncer-config.md
└── tasks.md           ← /speckit-tasks output
```

### Source Code Changes

```text
packages/
  shared/src/schemas/
    mgmt-api-realtime-config.ts      NEW — Zod schemas + defaults for realtime
    mgmt-api-pgbouncer-config.ts     NEW — Zod schemas + defaults for pgbouncer
  db/migrations/
    0021_realtime_pgbouncer_surfaces.sql   NEW — widen surface CHECK constraint

apps/api/src/
  routes/management/
    realtime-config.ts               NEW — GET/PATCH /v1/projects/:ref/config/realtime
    pgbouncer-config.ts              NEW — GET/PATCH /v1/projects/:ref/config/database/pgbouncer + pooler PATCH
  services/
    runtime-config-store.ts          EDIT — extend ConfigSurface union + add saveConfigOnly()
  routes/
    platform-misc.ts                 EDIT — fix profile, realtime, pgbouncer platform handlers
    server.ts                        EDIT — register 2 new management route plugins

apps/api/tests/unit/
  platform-response-shapes.test.ts   EDIT — add profile/realtime/pgbouncer contract assertions
```

## Research

### R-001: Store-only surfaces — how to persist without env-writing

`patchConfig()` in `runtime-config-store.ts` does: Redis lock → load → merge → validate → write
`.env` → restart container → persist snapshot → audit. For realtime/pgbouncer we need only:
load-defaults → merge → validate → persist snapshot.

**Decision**: Add `saveConfigOnly(ref, surface, data, userId)` to `runtime-config-store.ts` — a
thin function that skips steps 6–9 (no env write, no restart, no lock needed for non-secret
surfaces). The existing `getConfig()` already handles the read path (SELECT + decrypt + defaults
fallback) and just needs `ConfigSurface` extended to accept the new values.

**Rationale**: Reuse the existing snapshot model and encryption rather than inventing a separate
store. The "store-only" split is justified because realtime/pgbouncer have no env-field mappings
and no container-restart semantics at this stage.

### R-002: RBAC actions for new endpoints

`data_api_config.read` and `data_api_config.write` (feature 009, `packages/shared/src/rbac.ts`
lines 74–75) already cover runtime config tunables. No new RBAC actions are needed.

**Decision**: Reuse `data_api_config.read` for GET and `data_api_config.write` for PATCH on both
realtime and pgbouncer management routes.

### R-003: Profile augmentation — what Studio requires

Upstream `GetProfileResponse` (`platform.d.ts`) requires: `id`, `primary_email`, `username`,
`gotrue_id`, `free_project_limit`, `disabled_features` (array), `is_alpha_user` (boolean).

Our `GET /v1/profile` returns `{ id, primary_email }`. Platform handler augments with:
- `username`: email prefix before `@`
- `gotrue_id`: same as `id`
- `free_project_limit`: `999` (self-hosted sentinel)
- `disabled_features`: `[]`
- `is_alpha_user`: `false`

**Decision**: `GET /platform/profile` injects `/v1/profile`, merges augmented fields, returns.
Platform handler stays in `platform-misc.ts`; v1 handler (`management/profile.ts`) unchanged.

### R-004: Surface CHECK constraint — widening pattern

Migration 0020 sets the pattern: `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT ... CHECK (surface IN (...))`. Add `'realtime'` and `'pgbouncer'` in one new migration `0021`.

### R-005: Upstream realtime config shape (`api.d.ts`)

`V1RealtimeConfigResponse` (api.d.ts): `{ max_concurrent_users: number }`.  
`V1UpdateRealtimeConfigBody` (api.d.ts): `{ max_concurrent_users?: number }`.

### R-006: Upstream pgbouncer config shape (`api.d.ts`)

`V1PgbouncerConfigResponse` (api.d.ts): `{ pool_mode: string, default_pool_size: number, ignore_startup_parameters: string, max_client_conn: number, connection_string: string }`.  
`V1UpdatePgbouncerConfigBody` (api.d.ts): `{ pool_mode?: string, default_pool_size?: number, ignore_startup_parameters?: string, max_client_conn?: number }`.

## Contracts

### Profile

**`GET /platform/profile`**
```
Response 200:
{
  id:                   string   // user UUID
  primary_email:        string   // user's login email
  username:             string   // email prefix (before @)
  gotrue_id:            string   // same as id
  free_project_limit:   number   // 999
  disabled_features:    string[] // []
  is_alpha_user:        boolean  // false
}
Response 401: { error: 'Unauthorized' }
```

### Realtime Config

**`GET /v1/projects/:ref/config/realtime`**
```
Response 200: { max_concurrent_users: number }
Response 401: { message: string }
Response 404: { message: string, code: 'not_found' }
```

**`PATCH /v1/projects/:ref/config/realtime`**
```
Body:    { max_concurrent_users?: number }
Response 200: { max_concurrent_users: number }
Response 400: { message, code: 'validation_failed', details: {...} }
Response 404: { message, code: 'not_found' }
```

**`GET /platform/projects/:ref/config/realtime`** — delegates to v1, same shape.
**`PATCH /platform/projects/:ref/config/realtime`** — delegates to v1, same shape.

### PgBouncer Config

**`GET /v1/projects/:ref/config/database/pgbouncer`**
```
Response 200:
{
  pool_mode:                  string  // 'transaction' | 'session' | 'statement'
  default_pool_size:          number
  ignore_startup_parameters:  string
  max_client_conn:            number
  connection_string:          string  // empty for self-hosted
}
Response 404: { message, code: 'not_found' }
```

**`PATCH /v1/projects/:ref/config/database/pooler`**
```
Body: { pool_mode?: string, default_pool_size?: number, ignore_startup_parameters?: string, max_client_conn?: number }
Response 200: same shape as GET
Response 400: { message, code: 'validation_failed', details: {...} }
Response 404: { message, code: 'not_found' }
```

**`GET /platform/projects/:ref/config/pgbouncer`** — delegates to v1 GET.
**`PATCH /platform/projects/:ref/config/pgbouncer`** — delegates to v1 PATCH pooler.

## Implementation Notes

### New management route registration

`apps/api/src/routes/server.ts` registers all management routes under `/v1`. Add:
```
await mgmt.register(realtimeConfigRoutes)
await mgmt.register(pgbouncerConfigRoutes)
```

### `saveConfigOnly` signature

```typescript
export async function saveConfigOnly(
  ref: string,
  surface: ConfigSurface,
  data: ConfigJson,
  userId: string,
): Promise<ConfigJson>
```

Does: load current defaults → merge body → persist snapshot (upsert) → return merged.
No Redis lock, no env write, no container restart.

### Defaults

**Realtime**: `{ max_concurrent_users: 200 }`
**PgBouncer**: `{ pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits', max_client_conn: 200, connection_string: '' }`

## Complexity Tracking

No constitution violations. No exceptions needed.
