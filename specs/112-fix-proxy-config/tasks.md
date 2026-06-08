# Tasks: Fix Platform Proxy — Profile, Realtime & PgBouncer Config

**Input**: Design documents from `specs/112-fix-proxy-config/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md (embedded in plan.md) ✓

**Organization**: Tasks grouped by user story — US1 (Profile), US2 (Realtime), US3 (PgBouncer).
US2 and US3 share a foundational phase (migration + store extension) that blocks both.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: No new project structure needed — working within existing files. This phase confirms the tooling baseline.

- [X] T001 Verify existing `project_config_snapshots` table migration history by reading `packages/db/migrations/0020_storage_config_surface.sql`

---

## Phase 2: Foundational (Blocking Prerequisites for US2 + US3)

**Purpose**: DB migration widening the surface CHECK constraint + `saveConfigOnly()` function in the config store. US2 and US3 both require these before their routes can work.

**⚠️ CRITICAL**: US2 and US3 cannot proceed until this phase is complete. US1 (Profile) does NOT need this phase and can be done independently.

- [X] T002 Create idempotent migration `packages/db/migrations/0021_realtime_pgbouncer_surfaces.sql` — `DROP CONSTRAINT IF EXISTS project_config_snapshots_surface_check` + `ADD CONSTRAINT ... CHECK (surface IN ('postgrest', 'auth', 'postgres', 'storage', 'realtime', 'pgbouncer'))`
- [X] T003 Extend `ConfigSurface` union type in `apps/api/src/services/runtime-config-store.ts` (line ~59) to `'postgrest' | 'auth' | 'postgres' | 'storage' | 'realtime' | 'pgbouncer'`
- [X] T004 Add `defaultsFor('realtime')` case in `apps/api/src/services/runtime-config-store.ts` — returns `{ max_concurrent_users: 200 }`
- [X] T005 Add `defaultsFor('pgbouncer')` case in `apps/api/src/services/runtime-config-store.ts` — returns `{ pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits', max_client_conn: 200, connection_string: '' }`
- [X] T006 Add `saveConfigOnly(ref, surface, data, userId)` function to `apps/api/src/services/runtime-config-store.ts` — load defaults → merge body → upsert snapshot → return merged; no Redis lock, no env write, no container restart

**Checkpoint**: Migration file exists + TypeScript compiles + `saveConfigOnly` is exported. US1 can proceed independently while this phase runs.

---

## Phase 3: User Story 1 — Real Profile Data in Studio (Priority: P1) 🎯 MVP

**Goal**: `GET /platform/profile` returns the authenticated user's real `id` and `primary_email`, augmented with Studio-required fields (`username`, `gotrue_id`, `free_project_limit: 999`, `disabled_features: []`, `is_alpha_user: false`).

**Independent Test**: Authenticated GET to `/platform/profile` returns a JSON object where `primary_email` matches the login credential and all Studio-required fields are present with correct types.

### Implementation for User Story 1

- [X] T007 [US1] Replace the hardcoded profile stub in `apps/api/src/routes/platform-misc.ts` (handler near line 133): inject `GET /v1/profile` via `app.inject()`, await the response, then augment the result with `username: email.split('@')[0]`, `gotrue_id: id`, `free_project_limit: 999`, `disabled_features: []`, `is_alpha_user: false`, and return the merged object
- [X] T008 [US1] Add contract assertions for `GET /platform/profile` shape to `apps/api/tests/unit/platform-response-shapes.test.ts` — verify `id`, `primary_email`, `username`, `gotrue_id`, `free_project_limit`, `disabled_features`, `is_alpha_user` are all present with correct types

**Checkpoint**: US1 is independently verifiable — run `pnpm test` in `apps/api` and confirm the profile shape test passes; no hardcoded values in the response.

---

## Phase 4: User Story 2 — Realtime Config Persists Across Restarts (Priority: P2)

**Goal**: `GET /v1/projects/:ref/config/realtime` returns persisted or default realtime config. `PATCH /v1/projects/:ref/config/realtime` persists the merged config. Both `/platform/projects/:ref/config/realtime` endpoints delegate to v1.

**Independent Test**: PATCH `{ max_concurrent_users: 500 }` to realtime config then GET — the value 500 is returned, not the hardcoded 200. A GET on a project with no prior config returns `{ max_concurrent_users: 200 }`.

**Requires**: Phase 2 complete (T002–T006).

### Implementation for User Story 2

- [X] T009 [P] [US2] Create Zod schemas + defaults in `packages/shared/src/schemas/mgmt-api-realtime-config.ts` — `RealtimeConfigSchema` (`{ max_concurrent_users: z.number().int().positive() }`), `RealtimeConfigPatchSchema` (all fields optional), export `REALTIME_DEFAULTS`
- [X] T010 [US2] Create management route file `apps/api/src/routes/management/realtime-config.ts` with `realtimeConfigRoutes` Fastify plugin:
  - `GET /projects/:ref/config/realtime` — authorize `data_api_config.read`, resolve project, call `getConfig(ref, 'realtime')`, return 200 with `RealtimeConfigSchema` shape; return 404 `{ message, code: 'not_found' }` for unknown ref
  - `PATCH /projects/:ref/config/realtime` — authorize `data_api_config.write`, validate body with `RealtimeConfigPatchSchema`, call `saveConfigOnly(ref, 'realtime', body, userId)`, return 200 with merged config; return 400 `{ message, code: 'validation_failed', details }` on validation error
- [X] T011 [US2] Register `realtimeConfigRoutes` plugin in `apps/api/src/routes/server.ts` under the `/v1` management mount (alongside other config route registrations)
- [X] T012 [US2] Replace the realtime stub handlers in `apps/api/src/routes/platform-misc.ts`:
  - `GET /platform/projects/:ref/config/realtime` (near line 897) — delegate to `GET /v1/projects/:ref/config/realtime` via `app.inject()` and forward the response
  - `PATCH /platform/projects/:ref/config/realtime` (near line 902) — delegate to `PATCH /v1/projects/:ref/config/realtime` via `app.inject()` and forward the response
- [X] T013 [US2] Add contract assertions for `GET /platform/projects/:ref/config/realtime` and `PATCH /platform/projects/:ref/config/realtime` response shapes to `apps/api/tests/unit/platform-response-shapes.test.ts`

**Checkpoint**: US2 is independently verifiable — PATCH then GET returns the patched value; a fresh project returns the default `{ max_concurrent_users: 200 }`.

---

## Phase 5: User Story 3 — PgBouncer Config Persists Across Restarts (Priority: P3)

**Goal**: `GET /v1/projects/:ref/config/database/pgbouncer` returns persisted or default pgbouncer config. `PATCH /v1/projects/:ref/config/database/pooler` persists the merged config. Both `/platform/projects/:ref/config/pgbouncer` endpoints delegate to v1.

**Independent Test**: PATCH `{ pool_mode: 'session', default_pool_size: 25 }` to pooler then GET pgbouncer — `pool_mode: 'session'` and `default_pool_size: 25` are returned. A GET on a project with no prior config returns `{ pool_mode: 'transaction', default_pool_size: 15, ... }`.

**Requires**: Phase 2 complete (T002–T006).

### Implementation for User Story 3

- [X] T014 [P] [US3] Create Zod schemas + defaults in `packages/shared/src/schemas/mgmt-api-pgbouncer-config.ts` — `PgbouncerConfigSchema` (`{ pool_mode: z.string(), default_pool_size: z.number().int(), ignore_startup_parameters: z.string(), max_client_conn: z.number().int(), connection_string: z.string() }`), `PgbouncerConfigPatchSchema` (all fields optional except `connection_string` which is excluded from PATCH), export `PGBOUNCER_DEFAULTS`
- [X] T015 [US3] Create management route file `apps/api/src/routes/management/pgbouncer-config.ts` with `pgbouncerConfigRoutes` Fastify plugin:
  - `GET /projects/:ref/config/database/pgbouncer` — authorize `data_api_config.read`, resolve project, call `getConfig(ref, 'pgbouncer')`, return 200 with `PgbouncerConfigSchema` shape; return 404 for unknown ref
  - `PATCH /projects/:ref/config/database/pooler` — authorize `data_api_config.write`, validate body with `PgbouncerConfigPatchSchema`, call `saveConfigOnly(ref, 'pgbouncer', body, userId)`, return 200 with merged config; return 400 on validation error
- [X] T016 [US3] Register `pgbouncerConfigRoutes` plugin in `apps/api/src/routes/server.ts` under the `/v1` management mount
- [X] T017 [US3] Replace the pgbouncer stub handlers in `apps/api/src/routes/platform-misc.ts`:
  - `GET /platform/projects/:ref/config/pgbouncer` (near line 1412 wildcard) — delegate to `GET /v1/projects/:ref/config/database/pgbouncer` via `app.inject()` and forward the response
  - `PATCH /platform/projects/:ref/config/pgbouncer` (near line 891) — delegate to `PATCH /v1/projects/:ref/config/database/pooler` via `app.inject()` and forward the response
- [X] T018 [US3] Add contract assertions for `GET /platform/projects/:ref/config/pgbouncer` response shape (`pool_mode`, `default_pool_size`, `ignore_startup_parameters`, `max_client_conn`, `connection_string` all present) to `apps/api/tests/unit/platform-response-shapes.test.ts`

**Checkpoint**: US3 is independently verifiable — PATCH pooler then GET pgbouncer returns patched values; a fresh project returns transaction mode defaults.

---

## Phase 6: Polish & Cross-Cutting Concerns

**Purpose**: Final validation, lint, and typecheck.

- [X] T019 [P] Run `pnpm tsc --noEmit` in `apps/api` and fix any type errors introduced by the new `ConfigSurface` union or new route files
- [X] T020 [P] Run `pnpm test` in `apps/api` and confirm all existing 729+ tests still pass plus the new contract assertions
- [X] T021 Run `pnpm lint` in `apps/api` and fix any lint issues in modified files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1** (Setup): No dependencies — immediate
- **Phase 2** (Foundational): Depends on Phase 1 — blocks US2 + US3 only
- **Phase 3** (US1 — Profile): Independent — can run immediately after Phase 1, does NOT need Phase 2
- **Phase 4** (US2 — Realtime): Depends on Phase 2 completion
- **Phase 5** (US3 — PgBouncer): Depends on Phase 2 completion — can run in parallel with Phase 4
- **Phase 6** (Polish): Depends on all user story phases

### User Story Dependencies

- **US1**: No foundational blocker — starts after T001
- **US2**: Needs T002–T006 (migration + store extension + saveConfigOnly)
- **US3**: Needs T002–T006 (same foundational as US2; T009/T014 are parallelizable schema tasks)

### Within Each Story

- New Zod schema file (T009, T014) → route file (T010, T015) → server registration (T011, T016) → platform proxy (T012, T017) → contract test (T013, T018)
- Platform proxy delegation requires the v1 route to exist first

### Parallel Opportunities

- T003–T006 can all run sequentially in one edit session on `runtime-config-store.ts`
- T009 (realtime schema) and T014 (pgbouncer schema) are parallel — different files
- T010 (realtime route) and T015 (pgbouncer route) are parallel — different files
- Phase 4 and Phase 5 are parallelizable with two developers
- T019, T020 are parallel final checks

---

## Parallel Example: Phase 2 + US1 Simultaneously

```
Track A — Foundational (blocks US2/US3):
  T002 migration file
  T003–T006 runtime-config-store.ts edits

Track B — US1 Profile (independent):
  T007 platform-misc.ts profile handler
  T008 contract test assertion
```

---

## Implementation Strategy

### MVP First (US1 Only — ~30 min)

1. Complete Phase 1 (T001 — verify migration history)
2. Complete Phase 3 US1 (T007–T008 — profile handler + test)
3. **STOP and VALIDATE**: `pnpm test` in `apps/api`; profile shape test passes
4. Demo: authenticated GET `/platform/profile` returns real email

### Full Delivery

1. Phase 1 → Phase 2 (foundational migration + store)
2. Phase 3 US1 (can overlap with Phase 2)
3. Phase 4 US2 (realtime) + Phase 5 US3 (pgbouncer) in parallel
4. Phase 6 (polish + final checks)

---

## Notes

- `app.inject()` is the Fastify internal delegation mechanism used in other platform-misc.ts handlers for proxying to `/v1/*` — follow that pattern exactly
- The `getConfig()` function already handles defaults fallback when no snapshot row exists — no special handling needed in the route
- `saveConfigOnly()` does NOT need a Redis lock because it only writes to the DB (no env file, no container coordination)
- The `connection_string` field in pgbouncer config is always `''` for self-hosted — it is read-only and should NOT be in the PATCH body schema
- Migration 0021 must follow the idempotent `DROP CONSTRAINT IF EXISTS` + `ADD CONSTRAINT` pattern (same as 0020)
