---
description: "Task list for feature 009 — runtime config tunables (postgres-config + auth-config)"
---

# Tasks: Runtime config tunables (postgres-config + auth-config)

**Input**: `specs/009-runtime-config-tunables/{spec.md, plan.md, research.md, data-model.md, contracts/, quickstart.md}`

**Tests included**: yes — spec calls out a CLI e2e script (FR-012/013) and vitest coverage for the security-sensitive bits (sentinel merge, redaction, validation bounds, env editor rollback). No tests for plain route plumbing.

**Organization**: by user story (US1 = extend JWT expiry, US2 = expose custom Postgres schema). The two stories share roughly half their plumbing (the `runtime-config-store` + `.env` edit + reload pipeline), so most of that lands in Phase 2 (Foundational) where it's reused by both.

## Format

`- [ ] [TaskID] [P?] [Story?] Description with file path`

[P] = parallelizable (different files, no in-flight dependency).
[US1] / [US2] = which spec user story the task serves.

## Path conventions

Selfbase monorepo. `apps/api/`, `apps/worker/`, `packages/db/`, `packages/shared/`, `tests/cli-e2e/` — see plan.md's Source Code tree.

---

## Phase 1: Setup

- [X] T001 Pull upstream Supabase OpenAPI snapshot to `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json` via `curl -sL https://api.supabase.com/api/v1-json -o specs/009-runtime-config-tunables/upstream-openapi-snapshot.json` — pinned source of truth for validation bounds and field lists (per research.md R-006).
- [X] T002 [P] Add `low-priority` cross-reference: confirm GH issue #21 exists and links to #11 (already done during /speckit-clarify; verify with `gh issue view 21 | grep '#11'`). No file change; informational gate.

---

## Phase 2: Foundational (blocks all stories)

**Purpose**: shared plumbing both user stories rely on. Nothing user-visible ships until this phase completes.

### Database

- [X] T010 Create idempotent migration `packages/db/migrations/0009_project_config_snapshots.sql` per data-model.md (table + unique index + FKs to `instances` and `users`, all wrapped in `IF NOT EXISTS` / `DO $$ ... END$$` blocks). _Note: actual FK targets `supabase_instances(ref)` (not `instances`); data-model used the wrong table name._
- [X] T011 [P] Add Drizzle schema `packages/db/src/schema/project-config.ts` for `project_config_snapshots` (columns mirror migration).
- [X] T012 [P] Re-export from `packages/db/src/schema/index.ts` so `schema.projectConfigSnapshots` is available alongside `schema.projectSecrets`, `schema.auditLog`, etc.

### RBAC

- [X] T013 Edit `packages/shared/src/rbac.ts` — append `data_api_config.read`, `data_api_config.write`, `auth_config.read`, `auth_config.write` to `ACTIONS` tuple and to both `admin` (all true) and `member` (read true, write false) rows of `MATRIX`.

### Zod schemas (shared package)

- [X] T014 [P] Create `packages/shared/src/schemas/mgmt-api-postgrest-config.ts` exporting `PostgrestConfigResponseSchema` and `UpdatePostgrestConfigBodySchema` with upstream bounds (`max_rows` 0-1000000; `db_pool` 0-1000 nullable; `db_schema` non-empty string; `db_extra_search_path` string). `strict()` mode so unknown keys → ZodError.
- [X] T015 [P] Create `packages/shared/src/schemas/mgmt-api-auth-config.ts` exporting `AuthConfigResponseSchema`, `UpdateAuthConfigBodySchema`, `SECRET_FIELDS: ReadonlySet<string>`, and `REDACTED_SECRET = '***'` constant. Mirror upstream's full `UpdateAuthConfigBody` shape (~234 fields) with bounds from the OpenAPI snapshot (T001). `strict()` mode. _Generated from the snapshot via jq pipeline; 234 fields total._
- [X] T016 [P] Re-export both schemas from `packages/shared/src/schemas/index.ts` (or wherever existing mgmt-api schemas are re-exported). _Re-exported directly from `packages/shared/src/index.ts` (no `schemas/index.ts` exists; matched existing convention)._

### Field mapper (honored vs stored-only)

- [X] T017 [P] Create `apps/api/src/services/env-field-mapper.ts` exporting `POSTGREST_CONFIG_MAP` and `AUTH_CONFIG_MAP: Record<string, FieldMapping>`. `FieldMapping = { kind: 'honored', envName: string, transform?: (v: unknown) => string } | { kind: 'stored_only' }`. Honored postgrest entries: `db_schema → PGRST_DB_SCHEMAS`, `db_extra_search_path → PGRST_DB_EXTRA_SEARCH_PATH`, `max_rows → PGRST_DB_MAX_ROWS`, `db_pool → PGRST_DB_POOL` (omit env line when value is null). Honored auth entries: 4 core (`jwt_exp → JWT_EXPIRY`, `site_url → SITE_URL`, `uri_allow_list → ADDITIONAL_REDIRECT_URLS`, `disable_signup → DISABLE_SIGNUP`) + 6 mailer/sms + 22 OAuth-provider triples (`external_<p>_enabled → GOTRUE_EXTERNAL_<P>_ENABLED`, `_client_id → ..._CLIENT_ID`, `_secret → ..._SECRET`). Mark everything else from `UpdateAuthConfigBodySchema` as `{ kind: 'stored_only' }` so issue #21 has a complete inventory.

### Container reload helper (prep for T018)

- [X] T017a Extract the container-reload-with-rollback helper from `apps/api/src/services/secret-store.ts` into a new module `apps/api/src/services/container-reload.ts`. Export `restartOrRollback(containerName: string, envPath: string, envBackup: string): Promise<void>` and update `secret-store.ts` to import from the new location. No behavior change; pure refactor that unblocks T018's reuse claim from plan.md.

### Runtime config store (the core of this feature)

- [X] T018 Create `apps/api/src/services/runtime-config-store.ts` per research.md R-001..R-008. Public surface:
  - `defaultConfigFor(surface: 'postgrest' | 'auth'): Json` — upstream-documented defaults
  - `getConfig(ref: string, surface): Promise<Json>` — decrypt snapshot or return defaults; redact every field in `SECRET_FIELDS` to `***`
  - `patchConfig(ref: string, surface, body: Json, source: { userId: string }): Promise<Json>` — full pipeline: Redis lock → load current (decrypted plaintext) → merge body → resolve `***` sentinels against current → cross-field validate (OAuth `enabled` requires non-empty client_id + non-`***`-after-merge secret) → for honored fields write `.env` via `upsertEnvEntry` from `secret-store.ts` → INSERT/UPDATE snapshot row (encrypted) → `restartOrRollback(containerNameFor(ref, surface))` → emit `audit_log` entry → release lock → return redacted post-merge
- [X] T019 [P] Wire Redis SETNX helper for `selfbase:config-write-lock:<ref>` (TTL 60s). If existing Redis client wrapper provides a primitive, reuse it; otherwise add a small `withProjectConfigLock(ref, fn)` helper inside `runtime-config-store.ts`. 409 `config_write_in_progress` if `SET NX` fails.
- [X] T020 [P] Extract container-name resolver: `containerNameFor(ref, surface)` returns `selfbase-${ref}-rest-1` for `'postgrest'` and `selfbase-${ref}-auth-1` for `'auth'`. Co-locate in `runtime-config-store.ts` or in `docker-control-adapter.ts` if cleaner.

### Foundational tests

- [X] T021 [P] Unit tests `apps/api/tests/unit/env-field-mapper.test.ts`: every key in `UpdateAuthConfigBodySchema.shape` and `UpdatePostgrestConfigBodySchema.shape` MUST appear in the corresponding map (no silent drops); every `honored` envName MUST match a `GOTRUE_*` or `PGRST_*` env actually referenced in `infra/supabase-template/docker-compose.yml` (load the compose file with `js-yaml` and grep). This is the tripwire R-007 promises.
- [X] T022 [P] Unit tests `apps/api/tests/unit/mgmt-api-config-validation.test.ts`: derive bounds from the OpenAPI snapshot (T001) and assert equality with `UpdatePostgrestConfigBodySchema` + `UpdateAuthConfigBodySchema` for every numeric field. Tripwire for upstream drift (R-006).
- [X] T023 [P] Unit tests `apps/api/tests/unit/runtime-config-store.test.ts` _(pure-helper coverage only; full pipeline incl. lock + DB + restart deferred to Phase 3/4 integration tests as planned)_: sentinel merge (`***` preserves existing; non-`***` replaces; new secret value is `***` only if input was literally that), redaction (every `SECRET_FIELDS` member redacted on read), cross-field validation (`external_google_enabled: true` + empty client_id → throws with `error.details.external_google = 'missing_credentials'`), `.env` rollback on simulated restart failure. Use a fake `docker-control-adapter` injectable.

**Checkpoint**: after Phase 2, both stories have all their plumbing. No endpoints yet — those land in US1/US2.

---

## Phase 3: User Story 1 — Extend JWT expiry (Priority: P1)

**Story goal**: `supabase config update --project-ref <ref> --auth-jwt-expiry 86400` works end-to-end. New JWTs honor the new expiry within 30s; existing sessions are not invalidated.

**Independent test**: per spec US1 Independent Test — issue the CLI command, verify a fresh sign-in's JWT shows `exp - iat ≈ 86400 ±60s`, and a pre-PATCH session keeps working until its original `exp`.

- [X] T030 [US1] Create `apps/api/src/routes/management/auth-config.ts` registering `GET /v1/projects/:ref/config/auth` and `PATCH /v1/projects/:ref/config/auth`. Both handlers: `app.authorize(req, 'auth_config.read' | '.write')` → resolve ref → 404 if unknown → 409 if project not `running` → for GET: `runtime-config-store.getConfig(ref, 'auth')`; for PATCH: validate body with `UpdateAuthConfigBodySchema.parse()` → `runtime-config-store.patchConfig(ref, 'auth', body, { userId })`. Let `ZodError` bubble to `mgmt-api-errors` plugin which already shapes the `{ error: { details: {...} } }` envelope (per R-006).
- [X] T031 [US1] Edit `apps/api/src/server.ts` — register the auth-config route module under the `/v1/projects/:ref` mount, before the `notImplementedRoutes` catch-all so the new routes match first.
- [X] T032 [US1] [P] Integration test `apps/api/tests/integration/auth-config.test.ts`: happy path PATCH with `{ jwt_exp: 86400 }` returns 200 with merged config + `jwt_exp` updated; subsequent GET reflects the value; redaction holds for every `SECRET_FIELDS` member; pre-existing JWT issued before the PATCH still validates (use a fixture token issued against the project, decode locally, assert `exp` unchanged). Use a real per-instance test stack from the existing integration harness.
- [X] T033 [US1] [P] Integration test in the same file: PATCH `{ jwt_exp: 700000 }` (above 604,800 ceiling) → 400 with `error.details.jwt_exp` containing the bound; snapshot row NOT created/modified; container NOT restarted; `audit_log` row count for `action='mgmt_api.auth_config.update'` is unchanged (SC-003).
- [X] T034 [US1] [P] Integration test: secret sentinel round-trip. GET → assert `external_google_secret === '***'` → PATCH the full GET body back unchanged → 200 → GET again → `external_google_secret` STILL `***` (and the underlying plaintext in the encrypted snapshot is unchanged — assert by decrypting the snapshot row in the test).
- [X] T035 [US1] [P] Integration test: OAuth missing-credentials cross-field validation. Start with `external_github_enabled: false, external_github_client_id: ''`. PATCH `{ external_github_enabled: true }` (without supplying client_id/secret) → 400 `error.details.external_github = 'missing_credentials'`.
- [X] T036 [US1] [P] Integration test: failed-restart rollback. Inject a `docker-control-adapter` fake that fails `restart` after the `.env` write. PATCH `{ site_url: 'https://new.example' }` → 500 `restart_failed`. Re-GET → `site_url` is the prior value; per-instance `.env` content matches the backup; container restarted on prior config.

**Checkpoint**: US1 ships. The CLI command `supabase config update --auth-jwt-expiry 86400` works against a live project; this is the most-cited demand from issue #11.

---

## Phase 4: User Story 2 — Expose custom Postgres schema (Priority: P1)

**Story goal**: `supabase postgres-config update --project-ref <ref> --db-schema "public,app_v2"` works end-to-end. PostgREST starts serving the new schema within 30s; previously-served schemas keep working.

**Independent test**: per spec US2 Independent Test — issue the CLI command, then a request to `/rest/v1/app_v2.<table>` against the per-instance Kong stops returning 404.

- [X] T040 [US2] Create `apps/api/src/routes/management/postgrest-config.ts` registering `GET /v1/projects/:ref/postgrest` and `PATCH /v1/projects/:ref/postgrest`. Same handler shape as auth-config but uses `data_api_config.read/write` actions, `UpdatePostgrestConfigBodySchema`, and `runtime-config-store.patchConfig(ref, 'postgrest', body, ...)`.
- [X] T041 [US2] Edit `apps/api/src/server.ts` — register the postgrest-config route module alongside auth-config (single edit may cover both if T031 is still in-flight; otherwise this is a second edit). Both must register before `notImplementedRoutes`.
- [X] T042 [US2] [P] Integration test `apps/api/tests/integration/postgrest-config.test.ts`: happy path GET → defaults; PATCH `{ db_schema: 'public,app_v2', max_rows: 5000 }` → 200; subsequent GET reflects both values; the per-instance PostgREST `.env` contains `PGRST_DB_SCHEMAS=public,app_v2` and `PGRST_DB_MAX_ROWS=5000`; calling `/rest/v1/app_v2.<table>` against the live per-instance Kong returns 200 within 30s (use the existing integration harness's REST helper).
- [X] T043 [US2] [P] Integration test: PATCH `{ max_rows: -1 }` → 400 `error.details.max_rows`; snapshot unchanged; `audit_log` row count for `action='mgmt_api.postgrest.update'` is unchanged (SC-003).
- [X] T044 [US2] [P] Integration test: PATCH `{ db_pool: null }` → 200; subsequent GET returns `db_pool: null`; per-instance `.env` does NOT contain a `PGRST_DB_POOL=` line (`null` means "auto-configured" per upstream; the env line is omitted so the container's default applies).
- [X] T045 [US2] [P] Integration test: concurrent-PATCH serialization. Fire two PATCHes simultaneously against the same project (one on postgrest, one on auth). One MUST return 200, the other MUST return 409 `config_write_in_progress` with `error.details.lock_ttl_seconds` populated. After the first PATCH completes, a retry of the second MUST succeed. Verifies the Redis SETNX from T019.

**Checkpoint**: US2 ships. Both P1 stories are now live; this is the MVP.

---

## Phase 5: CLI E2E + audit + polish (Cross-cutting)

- [X] T050 Create `tests/cli-e2e/postgres-config-and-auth-config.sh` per FR-012/FR-013 + quickstart.md "Running the live CLI smoke test" — script exercises `postgres-config get/update` and `config get/update --auth-jwt-expiry` end-to-end against a live project. Includes CLI-version pin check (R-010) that EXITS NON-ZERO on mismatch (not just a warning — FR-013 says "caught", not "warned"). Asserts CLI exit codes AND the persisted post-update config visible via re-`get`. Includes the validation-rejection case (negative max_rows). Restores original values at the end so the script is re-runnable.
- [X] T051 [P] Make the e2e script executable + add it to whatever CI surface invokes the other `tests/cli-e2e/*.sh` scripts (check `package.json` scripts / Makefile / CI workflow for the existing convention).
- [X] T052 [P] Audit-log assertion test `apps/api/tests/integration/auth-config-audit.test.ts`: after a successful PATCH that changes 2 fields incl. a secret, exactly one `audit_log` row exists with `action='mgmt_api.auth_config.update'`, the `payload.changed_fields` lists both, the `payload.diff` for the secret has BOTH `old` and `new` as `'***'` (no plaintext leak per data-model.md). Same shape test for postgrest.
- [X] T053 [P] Smoke-grep `apps/api/src/routes/management/not-implemented.ts` plus integration test that `/v1/projects/<ref>/postgrest` and `/v1/projects/<ref>/config/auth` (both verbs) no longer return 501 (FR-011 + SC-007).
- [X] T053a [P] Regression assertion (SC-008): run the existing integration suites that cover prior Management API surfaces and confirm they still pass against the api container built from this branch — `apps/api/tests/integration/{gen-types,secrets,functions,login-link,api-keys,projects}.test.ts`. Any failure means feature 009 introduced a regression in the route registration order or in the shared `mgmt-api-errors` plugin. Wire into the same vitest run already invoked by `pnpm -C apps/api test:integration`.
- [X] T054 [P] Update `docs/changes/` with a new `009-runtime-config-tunables.md` per the repo convention seen in `docs/changes/005-*.md` / `006-*.md` / `008-*.md` — operator-facing summary, endpoint list, the honored-vs-stored caveat with link to issue #21.

---

## Dependencies

```
Phase 1 (T001, T002) — independent

Phase 2 (Foundational) — depends on Phase 1
  T010 → (no in-phase deps)
  T011 [P], T012 [P] depend on T010 (migration)
  T013 — independent of others in this phase
  T014 [P], T015 [P], T016 [P] depend on T001
  T017 [P] depends on T015 (for UpdateAuthConfigBodySchema field list)
  T018 depends on T010 (schema), T015 (Zod), T017 (mapping), T013 (RBAC actions exist), T017a (extracted `restartOrRollback` helper)
  T019 [P], T020 [P] can land alongside T018
  T021–T023 [all P] depend on the things they test (T015, T017, T018) but can land in any order once those exist

Phase 3 (US1) — depends on Phase 2 complete
  T030 depends on T018 + T015 + T013
  T031 depends on T030
  T032–T036 [all P] depend on T030 + T031

Phase 4 (US2) — depends on Phase 2 complete (independent of US1)
  T040 depends on T018 + T014 + T013
  T041 depends on T040 (and folds into T031 if not yet shipped)
  T042–T045 [all P] depend on T040 + T041

Phase 5 (cross-cutting) — depends on US1 + US2 both shipped
  T050 depends on T030+T040 (real endpoints to call)
  T051 [P] depends on T050
  T052 [P] depends on T030 + T040
  T053 [P] depends on T031 + T041
  T054 [P] depends on US1 + US2 complete
```

**Story independence**: US1 and US2 are fully independent of each other once Phase 2 is done. Either can ship alone as a partial MVP. Both target the same `runtime-config-store` pipeline so the second one is mostly a route + test exercise.

## Parallel execution opportunities

Within Phase 2 after T010 lands: `[T011, T012, T013, T014, T015, T016]` can all run in parallel (different files, no in-flight deps). After T015 + T013, also `[T017, T019, T020]` parallel.

Within Phase 3 (after T030 + T031): `[T032, T033, T034, T035, T036]` all parallel (independent test files within the same suite, no shared mutation).

Within Phase 4 (after T040 + T041): `[T042, T043, T044, T045]` all parallel.

Within Phase 5: `[T051, T052, T053, T054]` all parallel after T050.

## Implementation strategy

**MVP option A — single P1 only**: Phases 1 + 2 + 3 (US1 alone). Ships the most-cited demand (JWT expiry extension). ~1.5 dev days.

**MVP option B — both P1s** (recommended): Phases 1 + 2 + 3 + 4. Ships both stories cited in issue #11 in roughly the same effort because US2 is mostly route + test on the same foundation. ~2 dev days.

**Full feature**: all phases. Adds the CLI e2e script + audit/cleanup. ~2.5 dev days.

Recommend B + Phase 5 polish in the same PR — the e2e script and audit-log assertion are non-optional per FR-010/FR-012.
