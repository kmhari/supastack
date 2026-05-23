---
description: "Tasks for feature 006-mgmt-gen-types — Supabase CLI: gen types + migrations + snippets + backups list/restore"
---

# Tasks: Supabase CLI — `gen types` + `migration *` + `snippets *` + `backups list/restore`

**Input**: Design documents at `/specs/006-mgmt-gen-types/`
**Prerequisites**: `plan.md`, `spec.md`, `research.md`, `data-model.md`, `contracts/`, `quickstart.md`

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Parallelizable — different files, no dependency on other in-flight tasks
- **[Story]**: User Story this task serves (US1=gen types, US2=migrations, US3=snippets, US4=backups)
- Setup / Foundational / Polish tasks carry NO `[Story]` label

## Path Conventions

This is a TypeScript monorepo: `apps/api/src/`, `apps/worker/src/`, `packages/db/`, `packages/shared/src/`, `tests/cli-e2e/`. Paths are absolute from repo root.

---

## Phase 1: Setup

**Purpose**: Add shared infrastructure used by all four user stories.

- [ ] T001 Create `apps/api/src/services/per-instance-pg.ts` — shared helper exporting `withPerInstancePg<T>(ref: string, fn: (client: pg.Client) => Promise<T>): Promise<T>` per research.md Decision 8. Resolves `supabase_instances` row by ref → decrypts secrets via `loadMasterKey()` + `decryptJson` → opens an ephemeral `pg.Client` to `host.docker.internal:<port_db_direct>` as `postgres` with `s.postgresPassword` → runs `fn` → closes connection (try/finally). Throws typed errors (`InstanceNotFoundError`, `InstanceNotRunningError`, `PerInstancePgConnectError`) the route handlers translate to 404/409/502. Reuses `pg` from `packages/db/node_modules` per the earlier conversation pattern.
- [ ] T002 [P] Create `apps/api/src/services/per-instance-meta.ts` — analogous helper for the per-instance `pg-meta` container. Exports `callPerInstanceMeta(ref: string, path: string, init?: RequestInit): Promise<Response>` that resolves `port_meta` from the `supabase_instances` row and fetches `http://host.docker.internal:<port_meta><path>` via `undici`. Throws `PgMetaUnreachableError` on connection failure (route handlers translate to 502).
- [ ] T003 Add `port_meta` column to `packages/db/src/schema/instances.ts` — `portMeta: integer('port_meta')` (nullable initially; backfill in T004).
- [ ] T004 Create `packages/db/migrations/0007_port_meta_and_restore_jobs.sql` (idempotent per project conventions) — `ALTER TABLE supabase_instances ADD COLUMN IF NOT EXISTS port_meta integer`. Combined with T011 below.

---

## Phase 2: Foundational (blocking prerequisites for ALL user stories)

**Purpose**: Wire the new route file scaffolds into the api server + remove the four endpoint groups from the `not-implemented.ts` catch-all so subsequent stories can populate them.

- [ ] T005 Create empty route stubs (`return reply.status(501).send({error:{code:'todo'}})` placeholders) at `apps/api/src/routes/management/gen-types.ts`, `apps/api/src/routes/management/migrations.ts`, `apps/api/src/routes/management/snippets.ts`, `apps/api/src/routes/management/backups-mgmt.ts`. Export each as a `FastifyPluginAsync` named `genTypesRoutes`, `migrationsRoutes`, `snippetsRoutes`, `backupsMgmtRoutes`.
- [ ] T006 Edit `apps/api/src/server.ts` to import + register the four new route modules under prefix `/v1` (matching `notImplementedRoutes` and other `/v1/*` mounts). Register BEFORE `notImplementedRoutes` so the new specific paths win over the catch-all.
- [ ] T007 Edit `apps/api/src/routes/management/not-implemented.ts` — remove the catch-all entries for `GET /projects/:ref/types/typescript`, `* /projects/:ref/database/migrations*`, `GET /snippets*`, and `* /projects/:ref/database/backups*` so they fall through to the new handlers. (Other tier-1 paths stay 501.)
- [ ] T008 [P] Create `packages/shared/src/schemas/mgmt-api-gen-types.ts` — Zod schemas for query (`schemas: z.array(z.string()).optional().default(['public'])`) and response (`{ types: z.string() }`). Re-export from `packages/shared/src/schemas/index.ts`.
- [ ] T009 [P] Create `packages/shared/src/schemas/mgmt-api-migrations.ts` — Zod: `MigrationRow = { version: z.string().regex(/^\d{14}$/), name: z.string().nullable(), statements: z.array(z.string()).nullable() }`; `MigrationsListResponse = { migrations: z.array(MigrationRow) }`; `UpsertRequest = MigrationRow.partial({ name: true, statements: true })`. Re-export.
- [ ] T010 [P] Create `packages/shared/src/schemas/mgmt-api-snippets.ts` — Zod: `SnippetSummary = { id, name, description, project: {id,name}, owner: {id}, visibility: enum('user','project','org'), type, inserted_at, updated_at }`; `SnippetFull = SnippetSummary.extend({ content: z.string() })`. Re-export.
- [ ] T011 [P] Create `packages/shared/src/schemas/mgmt-api-backups.ts` — Zod: `BackupListItem`, `BackupsListResponse` (with `backups[]`, `physical_backup_data`, `pitr_enabled`, `walg_enabled`), `RestoreRequest = { backup_id: z.string().uuid().optional(), recovery_time_target: z.string().datetime().optional() }.refine(d => d.backup_id || d.recovery_time_target, 'either field required')`, `RestoreJobResponse`, `RestoreStatusResponse`. Re-export.

---

## Phase 3: User Story 1 — Generate TypeScript types (Priority P1)

**Story goal**: `supabase gen types typescript --project-id <ref>` returns a typed `Database` definition.

**Independent test**: `supabase gen types typescript --project-id enzyxdtrbosuwjwzkmvl --schema public > db.ts && pnpm tsc --noEmit db.ts` exits 0; output references project's actual tables.

- [ ] T012 [P] [US1] Create `apps/api/src/services/gen-types-service.ts` — exports `generateTypes(ref: string, schemas: string[]): Promise<string>`. Implementation: validate each `schemas[]` entry exists in the per-instance PG (`SELECT 1 FROM information_schema.schemata WHERE schema_name = ANY($1)` via `per-instance-pg.ts`); if any missing, throw `SchemaNotFoundError`. Then call `per-instance-meta` at `/types/typescript?included_schemas=<csv>&excluded_schemas=&excluded_tables=` (mirroring upstream pg-meta param names). Forward the response body as a string.
- [ ] T013 [US1] Implement `apps/api/src/routes/management/gen-types.ts` — `GET /projects/:ref/types/typescript`. Parse `schemas` query (Zod from T008). Resolve instance status (404 unknown / 409 not running). Call `generateTypes`. Return `{ types }`. Map `SchemaNotFoundError → 400`, `PgMetaUnreachableError → 502`.
- [ ] T014 [P] [US1] Edit `apps/worker/src/jobs/provision.ts` to populate `port_meta` in the `supabase_instances` row from the allocated port for the per-instance pg-meta container (it's the existing port-allocator's next-available slot). Compose template already maps pg-meta's :8080 → that host port.
- [ ] T015 [P] [US1] Create `apps/api/scripts/backfill-port-meta.ts` — one-shot script. For each `supabase_instances` row WHERE `port_meta IS NULL`: shell out to `docker port selfbase-<ref>-meta-1 8080` via the docker.sock unix proxy, parse the host port, UPDATE the row. Log per-row outcome. Idempotent. Document invocation in script header.
- [ ] T016 [US1] Create `tests/cli-e2e/gen-types.sh` — exercises Quickstart US1 scenarios against the test VM. Asserts: exit 0, output non-empty, output contains `export type Database`, output passes `tsc --noEmit` after writing to a temp file alongside a stub `@supabase/supabase-js` import.

**Checkpoint**: After T012-T016, `supabase gen types typescript --project-id <ref>` works end-to-end against a fresh selfbase install.

---

## Phase 4: User Story 2 — Manage database migrations (Priority P1, INDEPENDENT of US1)

**Story goal**: `supabase migration list/up/repair/fetch` round-trip works against selfbase.

**Independent test**: Quickstart US2 round-trip (create → push → list → drift-simulate → repair → list → fetch) exits 0 at every step; final state matches initial.

- [ ] T017 [P] [US2] Create `apps/api/src/services/migrations-service.ts` — exports:
  - `listMigrations(ref): Promise<MigrationRow[]>`
  - `upsertMigration(ref, row): Promise<MigrationRow>`
  - `deleteMigration(ref, version): Promise<{ version, deleted: boolean }>`

  All implementations use `withPerInstancePg(ref, async (client) => { … })`. The first statement in each is the idempotent bootstrap from research.md Decision 3:
  ```sql
  CREATE SCHEMA IF NOT EXISTS supabase_migrations;
  CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (
    version text PRIMARY KEY, name text, statements text[]
  );
  ```
  followed by the actual SELECT / INSERT ON CONFLICT / DELETE.
- [ ] T018 [US2] Implement `apps/api/src/routes/management/migrations.ts` — three handlers per `contracts/migrations.md`. Validate `version` regex with the Zod schema from T009 (400 → `invalid_version_format`). On write success, call the audit-log service with event `mgmt_api.migration.upsert` or `mgmt_api.migration.delete` (T040).
- [ ] T019 [P] [US2] Create `tests/cli-e2e/migration-roundtrip.sh` — exercises Quickstart US2 end-to-end. Uses the existing PAT mechanism + `supabase migration list/up/repair/fetch` against the test VM. Cleans up at the end (drops the demo table, marks the version reverted).

**Checkpoint**: After T017-T019, all four migration CLI subcommands work end-to-end.

---

## Phase 5: User Story 3 — Snippets list/download (DEFERRED to issue #13)

**Status**: Deferred during implementation. The spec assumed `/v1/snippets` reads from `user_content.content` on the per-instance Postgres; selfbase Studio actually stores snippets in browser localStorage (no server-side store). Tracked in [#13](https://github.com/kmhari/selfbase/issues/13).

- [~] T020 [P] [US3] **DEFERRED** — see #13 — Create `apps/api/src/services/snippets-service.ts` — exports:
  - `listSnippets(callerUserId, callerAccessibleProjects, opts?: { projectRef?: string }): Promise<SnippetSummary[]>`
  - `getSnippet(callerUserId, callerAccessibleProjects, snippetId): Promise<SnippetFull | null>`

  Both iterate accessible projects (cap 50). Per project, use `withPerInstancePg`. Probe `to_regclass('user_content.content')` first — if null, contribute zero rows (FR-015). Apply visibility filter in SQL (`WHERE type='sql' AND (visibility='project' OR visibility='org' OR owner_id=$1)`). Sort merged result by `updated_at DESC`. Cap at 200.

  For `getSnippet`, optionally Redis-cache the `snippet_id → project_ref` mapping for 60s (Decision 4) under key `snippet-project:<id>`. On hit, jump straight to that project's PG.
- [~] T021 [US3] **DEFERRED — see #13** — Implement `apps/api/src/routes/management/snippets.ts` — `GET /snippets[?project_ref=]` and `GET /snippets/:id`. Pulls callerUserId from `req.session.userId`; resolves accessible projects via the existing RBAC helper (whichever util `instances.ts` and `secrets.ts` already use). If `project_ref` provided and caller has no access → 403. On no result for `:id` → 404 (never 403, to match FR + edge case).
- [~] T022 [P] [US3] **DEFERRED — see #13** — Create `tests/cli-e2e/snippets.sh` — creates a snippet directly in the per-instance PG (`INSERT INTO user_content.content`), runs `supabase snippets list` + `supabase snippets download`, asserts shape + content match, cleans up.

**Checkpoint**: After T020-T022, snippet list + download work end-to-end.

---

## Phase 6: User Story 4 — Backups list/restore (DEFERRED to issue #14)

**Status**: Deferred from feature 006 to its own implementation session. All design + tasks below are kept verbatim so a fresh session can lift them directly. Track in [#14](https://github.com/kmhari/selfbase/issues/14).


**Story goal**: `supabase backups list/restore` works; restore is async with rollback guarantee.

**Independent test**: Quickstart US4 round-trip — take backup → make destructive change → restore → poll until success → verify state matches snapshot. Plus negative tests: concurrent restore, missing blob, incompatible PG version.

### Backups data model + foundational

- [ ] T023 [US4] Extend `packages/db/migrations/0007_port_meta_and_restore_jobs.sql` (created at T004) with the `restore_jobs` table per data-model.md, including `timeout_budget_seconds integer NOT NULL` column and `pre_restore_dir text NULL`. Includes the partial unique index `uq_restore_jobs_one_inflight ON (instance_ref) WHERE status IN ('pending','running')`. Idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`).
- [ ] T024 [P] [US4] Create `packages/db/src/schema/restore-jobs.ts` — Drizzle schema mirroring T023. Add to `packages/db/src/schema/index.ts` exports.
- [ ] T025 [P] [US4] Add new `status` value `'restoring'` to `supabase_instances` — update the existing CHECK constraint (or text column with no enum). Same migration 0007. Edit any TypeScript union types in `packages/db/src/schema/instances.ts` to include `'restoring'`.
- [ ] T026 [P] [US4] Edit `apps/worker/src/jobs/health-reconciler.ts` to skip `'restoring'` rows (analogous to the `'deleting'` skip already in place).

### Backups list (read-only)

- [ ] T027 [US4] Create `apps/api/src/services/backups-mgmt-service.ts` — exports `listBackupsForCli(ref): Promise<BackupsListResponse>`. Reads from the existing `backups` table, derives `physical_backup_data` min/max from `inserted_at` of COMPLETED rows, returns the contract shape from `contracts/backups.md`.
- [ ] T028 [US4] Implement `GET /v1/projects/:ref/database/backups` in `apps/api/src/routes/management/backups-mgmt.ts` calling `listBackupsForCli`. Resolve instance, 404/409 as standard.

### Restore worker + API

- [ ] T029 [P] [US4] Add to `apps/api/src/services/backups-mgmt-service.ts` (or a new sibling `restore-service.ts`):
  - `initiateRestore(ref, callerUserId, payload: RestoreRequest): Promise<{ restore_job_id }>` — resolves backup_id from either field, runs preflight in order: (1) RBAC admin-only check, (2) project not paused, (3) backup status COMPLETED, (4) blob present in store, (5) PG-version match, (6) **disk-space pre-flight per FR-024**: stat `data` dir size, compare to `df` available on the volume; reject 409 `disk_space_insufficient` with `{ required_bytes, available_bytes, data_dir_bytes }` if insufficient. (7) Compute `timeout_budget_seconds = 300 + ceil(backup_bytes/1e9)*60 + 300`. Then wrap INSERT `restore_jobs` (with timeout_budget_seconds) + UPDATE `supabase_instances.status='restoring'` in a single TX, enqueue the BullMQ `restore` job, emit audit log `mgmt_api.backup.restore_started`.
  - `getRestoreStatus(ref): Promise<RestoreStatusResponse>` — returns current + history per the contract.
- [ ] T030 [US4] Implement `POST /v1/projects/:ref/database/backups/restore-pitr` and `GET /v1/projects/:ref/database/backups/restore-status` in `backups-mgmt.ts`. Map errors: `restore_in_progress → 409`, `project_paused → 409`, `backup_status_invalid → 409`, `backup_blob_missing → 410`, `incompatible_pg_version → 400`, non-admin → 403.
- [ ] T031 [P] [US4] Create `apps/worker/src/jobs/restore.ts` — BullMQ worker handling `{ restore_job_id }`. Implements the full state machine from `contracts/backups.md` "Worker job: restore" section. Wraps the entire job body in a watchdog that aborts at `timeout_budget_seconds` (read from the row), triggering the rollback path. Key steps in order: (1) load job + idempotency, (2) set running, (3) fetch blob, (4) **stop the WHOLE per-instance compose stack** (FR-025) via `@selfbase/docker-control`, (5) `mv` data dir to pre-restore snapshot, (6) extract blob into new empty data dir, (7) **start the WHOLE stack**, (8) wait db healthcheck, (9) smoke probe via `withPerInstancePg`, (10) wait sibling-service healthchecks (auth, rest, kong), (11) success: status=`success` + `supabase_instances.status='running'` + enqueue delayed 24h GC msg + audit `restore_completed`. On any failure or timeout: rollback per "On any error" in the contract — swap dirs back, start whole stack, mark `failed` (`error_message = 'timeout_exceeded (budget: <N>s)'` if watchdog fired), audit `restore_failed`, clear `pre_restore_dir`.
- [ ] T032 [US4] Edit `apps/worker/src/index.ts` to register the restore queue + worker AND a separate `restore-gc` queue + worker. The `restore-gc` worker handles delayed messages enqueued by the success path of T031: load job, if `pre_restore_dir` is null exit (idempotent), else `rm -rf <pre_restore_dir>` then UPDATE `restore_jobs.pre_restore_dir = null`.
- [ ] T033 [P] [US4] Create `tests/cli-e2e/backups-restore.sh` — Quickstart US4 round-trip. Takes a backup, makes a destructive change, runs `supabase backups restore`, polls `/restore-status` until success/failed, asserts final state matches the backup snapshot AND that all sibling services (curl `/auth/v1/health`, `/rest/v1/`, kong) are healthy after restore. Also covers the negative tests: disk-insufficient → 409 (set up by truncating `df` artificially or pointing the data volume to a tmpfs), concurrent restore → 409, missing blob → 410.

**Checkpoint**: After T023-T033, backups list + restore work end-to-end with rollback guarantee.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T034 [P] Edit the existing audit-log service / table at `apps/api/src/services/audit.ts` (or equivalent — find it during implementation) to accept the new `event_type` values from research.md Decision 9. Add a `severity` field if not already present; default `'normal'`, override `'high'` for restore events.
- [ ] T035 [P] Create `apps/api/src/services/audit-helpers.ts` (or add to T034 file) exporting `logAuditEvent(req, eventType, payload, severity?)` so each route handler can emit a structured event with one call.
- [ ] T036 [P] Create `docs/management-api.md` (or extend the existing one if it exists) documenting the 11 new endpoints with curl examples — gen-types, migrations CRUD, snippets list/download, backups list/restore/status. Reference Cloud's OpenAPI for shape compatibility.
- [ ] T037 [P] Create `apps/api/src/services/__tests__/per-instance-pg.test.ts` — vitest unit tests for the helper from T001. Mock the underlying secrets + pg, assert error mapping (unknown ref → `InstanceNotFoundError`, etc.).
- [ ] T038 [P] Create `apps/api/src/services/__tests__/gen-types-service.test.ts` — mock `per-instance-meta`, assert schema validation logic + forwarding behavior.
- [ ] T039 [P] Create `apps/api/src/services/__tests__/migrations-service.test.ts` — use a temp PG (existing test fixtures pattern) to verify lazy bootstrap + idempotent upsert + idempotent delete.
- [ ] T040 [P] Create `apps/api/src/services/__tests__/restore-service.test.ts` — verify preflight checks: RBAC admin gate, concurrency (partial unique index), backup status validation, PG version mismatch, blob-missing handling. Mock the BullMQ enqueue.
- [ ] T041 [P] Create `apps/worker/src/jobs/__tests__/restore.test.ts` — verify the worker state machine: happy path, failure mid-extract triggers rollback, failure mid-restart leaves instance `failed`. Mock docker-control + backup-store + per-instance-pg.
- [ ] T042 Run full VM E2E from `quickstart.md` end-to-end (all 4 stories). Capture output for the PR description. Verify zero regressions in the existing P0 + feature-005 CLI commands.

---

## Dependencies

```
T001 (per-instance-pg helper)
  └── T012, T017, T020, T027, T029 (services depending on it)

T002 (per-instance-meta helper)
  └── T012 (gen-types service)

T003 + T004 (port_meta column)
  └── T014 (worker writes it) → T015 (backfill) → T012 (service reads it)

T005 (route stubs)
  └── T006 (server registers them) → T013, T018, T021, T028, T030 (handlers fill them)

T008-T011 (Zod schemas) — parallel with each other; each blocks its matching handler

T023 (restore_jobs migration)
  └── T024 (schema), T029 (service uses table), T031 (worker uses table)

T031 (restore worker)
  └── T032 (worker registration), T033 (E2E), T040 (preflight tests), T041 (worker tests)

T002 → T012 → T013 → T016 (US1 vertical slice — independently shippable after T001+T003+T004+T014+T015)
T001 → T017 → T018 → T019 (US2 vertical slice — independently shippable after T005+T007+T009)
T001 → T020 → T021 → T022 (US3 vertical slice — independently shippable after T005+T007+T010)
T001+T023 → T027,T029 → T028,T030 → T031 → T032 → T033 (US4 vertical slice — heaviest)

T042 (final VM E2E) — after all stories are individually checked
```

## Parallel execution opportunities

**Within Setup (Phase 1)**: T002, T003 in parallel after T001 (different files).

**Within Foundational (Phase 2)**: T008, T009, T010, T011 all parallel (4 separate schema files). T005 must finish before T006-T007.

**Within US1 (Phase 3)**: T012 + T014 + T015 all parallel after Phase 1+2 done; T013 depends on T012; T016 depends on T013.

**Within US2 (Phase 4)**: T017 alone (single service file); T019 after T018. No parallelism beyond Phase 2's prep.

**Within US3 (Phase 5)**: T020 alone; T022 after T021. No parallelism beyond Phase 2's prep.

**Within US4 (Phase 6)**: T024, T025, T026 parallel after T023; T027 + T029 parallel; T031 + T032 sequential; T033 last.

**Across stories**: US1, US2, US3 are fully independent of each other once Phase 2 is done. US4 has its own data-model work (T023-T026) but is independent of the others. All four can run in parallel after Phase 2.

**Within Polish (Phase 7)**: T034-T041 all parallel (different files); T042 last.

## Implementation strategy — MVP first

**Recommended MVP**: ship US1 alone first (T001-T016). Smallest scope, highest user impact (every TS project uses gen-types), no DB schema changes beyond `port_meta`. Estimated 1-2 days.

**Then US2** (T017-T019). Reuses the per-instance-pg helper from US1. Estimated 1 day.

**Then US3** (T020-T022). Read-only, low risk. Estimated 0.5 day.

**Then US4** (T023-T033). Heaviest piece — async restore worker, new entity, rollback semantics. Estimated 2-3 days. Worth its own clarify pass before starting if any of the contract shapes feel uncertain.

**Polish (Phase 7)** runs alongside / after the slices, mostly parallel.

## Total task counts

| Phase | Count |
|---|---|
| Setup | 4 |
| Foundational | 7 |
| US1 (gen types) | 5 |
| US2 (migrations) | 3 |
| US3 (snippets) | 3 |
| US4 (backups list/restore) | 11 |
| Polish | 9 |
| **Total** | **42** |

**Independent test criteria per story**:
- US1: `supabase gen types typescript --project-id <ref>` exits 0; output passes `tsc --noEmit`; emitted `Database` lists project's tables.
- US2: `migration new` → edit → `migration up` → `migration list` → drift simulation → `migration repair` → `migration list` → `migration fetch` — every step exits 0; final state matches initial.
- US3: snippet created in Studio appears in `supabase snippets list`; `supabase snippets download` returns the exact body byte-for-byte.
- US4: backup → destructive change → restore → polling completes with success → state matches snapshot; concurrent restore returns 409; missing blob returns 410.
