---

description: "Tasks: Supabase CLI Compatibility — P0 (login, link, functions deploy via --use-api, secrets)"
---

# Tasks: Supabase CLI Compatibility — P0

**Input**: Design documents from `/specs/003-supabase-cli-compat-p0/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md (all complete)

**Tests**: Test tasks are included. `research.md` R-011 explicitly specifies a three-tier strategy (unit + integration + opt-in E2E with the real CLI binary), and the user requested tests on the spec.

**Organization**: Grouped by the four P1 user stories in `spec.md`. Each story is independently testable (US2/US3/US4 functionally depend on US1's "the CLI can reach selfbase at all", but each story can be validated against a stub running upstream of it).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Different files, no in-phase dependencies — can run in parallel
- **[Story]**: User story this task belongs to (US1–US4 from spec.md)
- All file paths are repo-root-relative

## Path Conventions

Monorepo: backend at `apps/api/`, frontend at `apps/web/`, shared schemas at `packages/shared/`, DB at `packages/db/`. Per the `plan.md` Structure Decision, new management-API routes mount under `apps/api/src/routes/management/` at the `/v1/*` Fastify prefix.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Add the one new backend dependency and prep the test scaffolding so subsequent tasks have what they need.

- [X] T001 Add `@fastify/multipart` to `apps/api/package.json` dependencies (latest 9.x compatible with Fastify 5). Run `pnpm install` from repo root. Confirm `pnpm --filter @selfbase/api typecheck` still passes.
- [X] T002 Create the empty migration file `packages/db/migrations/0002_cli_compat.sql` with a top-of-file comment block; full SQL content lands in T012.
- [X] T003 [P] Add a test helper module at `apps/api/tests/helpers/mgmt-api.ts` exporting: (a) `buildAuthedApp()` — instantiates the Fastify app with an in-memory PG (or testcontainers — finalize at this step) and a recorded fake `dockerControl`, (b) `mintTestToken(userId)` — creates an `apiTokens` row and returns the plaintext PAT in `sbp_<hex40>` format, (c) `withMockInstance(ref)` — provisions a fake `supabase_instances` row plus an empty `/tmp/selfbase-test-instances/<ref>/volumes/functions/` directory tree. Used by every subsequent test in `apps/api/tests/integration/`.
- [X] T003a [P] Add service-level unit tests (Tier 1 per `research.md` R-011) — pure-function tests, no Fastify, no I/O, fast (<100ms total). Files under `apps/api/tests/unit/`: (a) `api-tokens.test.ts` — `mintApiToken` returns a string matching `^sbp_[a-f0-9]{40}$`, prefix is `raw.slice(0,12)`, hash is SHA-256 of the plaintext; 5 cases. (b) `secret-store-name.test.ts` — `validateSecretName` accepts valid names, rejects lowercase, rejects names not matching the regex, rejects each entry in `RESERVED_SECRET_NAMES`; ~10 cases. (c) `function-deploy-eszip.test.ts` — eszip magic-byte checker accepts a buffer starting with `ESZIP2`, rejects buffers starting with other bytes, rejects empty buffer; 4 cases. (d) `env-editor.test.ts` — pure function that takes a `.env` file string and a `{name, value}` entry, returns the new `.env` string with the entry upserted (replace if exists, append if not), preserves comments and unrelated lines, escapes special chars correctly; 6 cases. (e) `mgmt-api-mapping.test.ts` — for each mapper in T008, given a fixture entity, asserts the output matches the corresponding Zod schema from T007; 5 cases (one per mapper).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, error contracts, route group registration, and the shared services every user story consumes. ⚠️ **No user story work can begin until this phase is complete.**

- [X] T004 [P] Add Drizzle schema entries for `project_functions`, `function_deploys`, `project_secrets`, and the `prefix` column on `api_tokens` in `packages/db/src/schema.ts`. Mirror the column types and constraints from `data-model.md` exactly.
- [X] T005 [P] Modify `apps/api/src/services/api-tokens.ts:mintApiToken` to emit `` `sbp_${randomBytes(20).toString('hex')}` `` and persist `prefix = raw.slice(0, 12)` to the new column. Preserve the SHA-256 hash storage and the function signature.
- [X] T006 [P] Create `apps/api/src/plugins/mgmt-api-errors.ts` implementing the error envelope contract from `contracts/error-envelope.md`. Export a Fastify plugin that registers a custom error handler for the management route group, exports a `ManagementApiError` class, and remaps Zod validation errors. Apply only when registered (not globally — dashboard routes keep their existing envelope).
- [X] T007 [P] Create Zod schemas mirroring `contracts/management-api.yaml` in `packages/shared/src/mgmt-api-schemas.ts`: `ProfileSchema`, `OrganizationSchema`, `ProjectSchema`, `ApiKeySchema`, `FunctionSchema`, `FunctionDeployMetadataSchema`, `DeployFunctionResponseSchema`, `SecretInputSchema`, `SecretListEntrySchema`, `BulkUpdateFunctionEntrySchema`. Request-body schemas use `.passthrough()` per R-010. Re-export from `packages/shared/src/index.ts`.
- [X] T008 [P] Create `apps/api/src/services/mgmt-api-mapping.ts` with pure functions: `instanceToProject(row)`, `instanceApiKeys(secrets)`, `functionRowToFunction(row)`, `secretRowToListEntry(row)`. Each takes selfbase entities and returns cloud-API-shaped objects matching the Zod schemas in T007. No I/O, no Fastify imports.
- [X] T009 Write the migration SQL into `packages/db/migrations/0002_cli_compat.sql` per `data-model.md` "Migration" section (4 blocks: api_tokens prefix column + index, project_functions table + index, function_deploys table + index, project_secrets table). Every statement MUST be idempotent (`IF NOT EXISTS` everywhere).
- [X] T010 Mount the management route group in `apps/api/src/server.ts`. Add `app.register(async (mgmt) => { await mgmt.register(mgmtErrorsPlugin); await mgmt.register(multipart, {limits: {fileSize: 50*1024*1024, files: 100}}); /* US1-4 route registrations go here */ }, { prefix: '/v1' })`. Confirm the existing `auth.ts` preHandler runs before this group (bearer-token auth path).
- [X] T011 [P] Create `apps/api/src/routes/management/not-implemented.ts` that registers a catch-all wildcard `app.all('*', ...)` returning the 501 envelope from `contracts/error-envelope.md` "Not implemented" example. Register this LAST in the mgmt group from T010 (after all real routes) so real routes match first and unmatched paths fall through to it.
- [X] T012 [P] Add a vitest integration test at `apps/api/tests/integration/management-api/foundations.test.ts` asserting: (a) a request with no Authorization header returns the 401 envelope, (b) a request with a malformed PAT (`Bearer broken`) returns 401, (c) a request with a valid PAT but to an unimplemented path (e.g. `/v1/projects/abc/branches`) returns the 501 envelope with `code: "not_implemented"`. Uses the helper from T003.

**Checkpoint**: Foundation ready — `/v1/*` route group is live, errors come out in cloud shape, schema is migrated, PAT format is `sbp_<hex40>`. User story work can begin in parallel.

---

## Phase 3: User Story 1 — Connect the CLI to selfbase (Priority: P1) 🎯 MVP

**Goal**: A developer downloads a profile, mints a PAT, runs `supabase login`, and `supabase projects list` returns their selfbase projects.

**Independent Test**: With an unmodified upstream `supabase` CLI ≥2.72.7, follow the dashboard's Connect-CLI instructions; `supabase projects list` exits 0 and shows project refs matching the dashboard. (Note: this story's HTTP surface is `/v1/profile`, `/v1/organizations`, `/v1/projects`, and `/v1/projects/:ref` — US2 owns the project endpoints, so the validation here is "the CLI accepts our auth and renders the table".)

### Tests for User Story 1

- [X] T013 [P] [US1] Integration test at `apps/api/tests/integration/management-api/profile.test.ts` — `GET /v1/profile` with a valid PAT returns `{id, primary_email}`; with an invalid PAT returns 401.
- [X] T014 [P] [US1] Integration test at `apps/api/tests/integration/management-api/organizations.test.ts` — `GET /v1/organizations` returns an array; structure passes the `OrganizationSchema` from T007.
- [X] T015 [P] [US1] Integration test at `apps/api/tests/integration/connect-cli/profile-toml.test.ts` — `GET /api/v1/cli/profile.toml` (session-authed) returns `text/plain` with `api_url = "https://api.<apex>"` filled from the org's apex; `POST /api/v1/cli/mint-token` returns `{token, label, prefix}` where token matches `^sbp_[a-f0-9]{40}$`.

### Implementation for User Story 1

- [X] T016 [P] [US1] Create `apps/api/src/routes/management/profile.ts` — `GET /v1/profile` reads `request.user`, queries `users`, returns `{id, primary_email, username}` per `ProfileSchema`.
- [X] T017 [P] [US1] Create `apps/api/src/routes/management/organizations.ts` — `GET /v1/organizations` returns the orgs the authenticated user belongs to via the existing `organizations`/`organization_members` tables.
- [X] T018 [P] [US1] Create `apps/api/src/routes/connect-cli.ts` — `GET /api/v1/cli/profile.toml` (session cookie required, dashboard surface) renders the 4-line TOML with the deployment's apex inlined; `POST /api/v1/cli/mint-token` accepts optional `{label?}` body, calls `mintApiToken` from T005 with a default label like `` `CLI on ${req.body.label ?? 'cli'}` ``, returns `{token, label, prefix, id}`.
- [X] T019 [US1] Register T016, T017, T018 in `apps/api/src/server.ts` (T016, T017 inside the `/v1` group from T010; T018 outside the group at `/api/v1/cli/`).
- [X] T020 [P] [US1] Create `apps/web/src/components/CliCommandBlock.tsx` — a small monospace-styled card that shows a shell command with a copy button and an optional caption. Reuses the existing `CopyButton` from `apps/web/src/components/`.
- [X] T021 [P] [US1] Extend `apps/web/src/lib/api.ts` — add `cliApi = { profileToml: () => fetch('/api/v1/cli/profile.toml').then(r => r.text()), mintToken: (label?) => http.post('/api/v1/cli/mint-token', {label}).then(r => r.data) }`.
- [X] T022 [US1] Create `apps/web/src/pages/ConnectCli.tsx` — full page using `Shell` + `PageHeader`. Sections: (1) "Step 1 — Save profile" with a downloadable TOML and the `curl` one-liner using `cliApi.profileToml()`; (2) "Step 2 — Mint a token" with a button that calls `cliApi.mintToken()` and shows the plaintext PAT once in a `RevealDialog`-style modal with a Copy button; (3) "Step 3 — Use the CLI" with three canonical commands (`supabase login`, `supabase link --project-ref <ref>`, `supabase functions deploy hello`) each in a `CliCommandBlock`. NO `--use-api` flag — both deploy paths are supported per R-002, and the eszip path is the default. Add a small footnote: *"On systems without Docker, append `--use-api` to `functions deploy` and `functions download` commands."*
- [X] T023 [US1] Add a route for `/connect-cli` in `apps/web/src/App.tsx` pointing at `ConnectCli`. Add a top-nav entry or a CTA link from `SettingsTokens.tsx` ("→ Connect a Supabase CLI").
- [X] T024 [US1] Modify `apps/web/src/pages/SettingsTokens.tsx` — render `prefix` (from the API response) as the visual indicator in the token list (e.g. `sbp_e4cebad5…`), replacing whatever placeholder it shows today. Add an info callout above the create form: "Tokens are also used with the Supabase CLI — see [Connect CLI](/connect-cli)". Verify the create-modal's "shown-once" plaintext display still works with the new shorter token length.

**Checkpoint**: User Story 1 done — `supabase login` works against selfbase, `supabase projects list` returns projects (assuming US2's project endpoints exist; otherwise it returns the 501 envelope from T011 cleanly).

---

## Phase 4: User Story 2 — Link a local project directory (Priority: P1)

**Goal**: `supabase link --project-ref <ref>` succeeds and binds the working directory to a selfbase project.

**Independent Test**: With US1 complete, `cd` into a fresh dir with `supabase init`'d skeleton, run `supabase link --project-ref <real-ref>`, observe a success message and the presence of `.supabase/.temp/project-ref`. Subsequent `supabase functions list` (no flag) hits the linked ref.

### Tests for User Story 2

- [X] T025 [P] [US2] Integration test at `apps/api/tests/integration/management-api/projects.test.ts` — (a) `GET /v1/projects` returns array of the authed user's instances; (b) `GET /v1/projects/:ref` returns a single project per `ProjectSchema`; (c) bad ref returns 404 envelope with `code: not_found`; (d) ref the user can't access returns 404 (not 403 — match cloud's behavior to avoid leaking project existence).
- [X] T026 [P] [US2] Integration test at `apps/api/tests/integration/management-api/api-keys.test.ts` — `GET /v1/projects/:ref/api-keys` returns `[{name: "anon", api_key: "eyJ..."}, {name: "service_role", api_key: "eyJ..."}]` decrypted from `supabaseInstances.encryptedSecrets`. Per-instance, not redacted.

### Implementation for User Story 2

- [X] T027 [US2] Create `apps/api/src/services/project-store.ts` — `listProjectsForUser(userId)` returns instances the user has access to (today: all instances in the org; revisit when per-instance RBAC ships). `getProjectByRef(ref, userId)` returns single + ownership check.
- [X] T028 [US2] Create `apps/api/src/routes/management/projects.ts` — registers `GET /v1/projects` and `GET /v1/projects/:ref`. Both pipe through `mgmt-api-mapping.instanceToProject` from T008.
- [X] T029 [US2] Create `apps/api/src/routes/management/api-keys.ts` — `GET /v1/projects/:ref/api-keys` decrypts `supabaseInstances.encryptedSecrets` using the existing `decryptJson` + `loadMasterKey` from `@selfbase/crypto`, returns the legacy `anon` + `service_role` shape from `ApiKeySchema`.
- [X] T030 [US2] Register T028 and T029 in `apps/api/src/server.ts` inside the `/v1` mgmt group.
- [X] T031 [US2] Manual E2E checkpoint: from a scratch dir, run `supabase --profile <selfbase.toml> link --project-ref <real-ref>` against a running dev backend and confirm exit 0 plus `.supabase/.temp/project-ref` contains the ref.

**Checkpoint**: `link` works end-to-end against selfbase. Per-project commands now have a target.

---

## Phase 5: User Story 3 — Deploy edge functions (Priority: P1)

**Goal**: `supabase functions deploy hello --use-api` lands a function at `https://<ref>.<apex>/functions/v1/hello` in ≤15s on a first deploy.

**Independent Test**: With US1 + US2 complete, run the deploy command; curl the public URL; expect the function's response body.

### Tests for User Story 3

- [X] T032 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-deploy.test.ts` — `POST /v1/projects/:ref/functions/deploy?slug=hello` with a constructed chunked multipart body (one `metadata` JSON part + one `file` part with body `Deno.serve(()=>new Response('ok'))`). Asserts: 201 with `DeployFunctionResponse`-shaped JSON; file landed at the expected per-instance path; `dockerControl.restart()` was called exactly once with `selfbase-<ref>-functions-1`; row in `project_functions` with status `ACTIVE`; row in `function_deploys` with `status: 'SUCCEEDED'`, `source: 'cli'`.
- [X] T033 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-list-delete.test.ts` — after a successful deploy: (a) `GET /v1/projects/:ref/functions` returns the array; (b) `GET /v1/projects/:ref/functions/:slug` returns a single record matching the corresponding entry in the list (same shape, same fields); (c) `GET .../functions/:slug/body` returns the multipart bundle; (d) `DELETE .../functions/:slug` removes the file from disk and flips status to REMOVED (or hard-deletes), and a subsequent list excludes the function and a subsequent single-`GET` returns 404.
- [X] T034 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-bulk.test.ts` — `PUT /v1/projects/:ref/functions` with a `BulkUpdateFunctionBody` array returns 200 with `{functions: [...]}` (matching what's already stored). Verifies the multi-function deploy final step.
- [X] T035 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-eszip-deploy.test.ts` — `POST /v1/projects/:ref/functions` with `Content-Type: application/vnd.denoland.eszip` and the required query params (`slug`, `name`, `verify_jwt`, `import_map_path`, `entrypoint_path`, `ezbr_sha256`) and a body whose first bytes match the `ESZIP` magic, returns 201 with `DeployFunctionResponse` shape including a `ezbr_sha256` that equals the SHA-256 of the uploaded bytes. The file lands at `volumes/functions/<slug>/bundle.eszip`; a sidecar `meta.json` is written with `source_path: "bundle.eszip"`. `PATCH .../functions/:slug` with the same content-type updates an existing eszip and returns 200. Additionally: `POST` with `Content-Type: application/vnd.denoland.eszip` and bytes that DON'T start with `ESZIP` returns 422 `code: invalid_eszip`; mismatched `ezbr_sha256` returns 422 `code: ezbr_mismatch`.
- [X] T036 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-errors.test.ts` — (a) bundle > 50 MB → 413; (b) slug failing regex → 422; (c) `entrypoint_path` not matching any uploaded `file` part → 422; (d) `file` part filename with `../` → 422; (e) restart-timeout → 500 with `code: deploy_rolled_back` AND files restored to pre-deploy state.

### Implementation for User Story 3

- [X] T037 [P] [US3] Create `apps/api/src/services/function-store.ts` — pure file-system reads against `/var/selfbase/instances/<ref>/volumes/functions/`. Exports: `listFunctions(ref)` (scans subdirs, joins with `project_functions` rows for metadata), `getFunctionBundle(ref, slug)` (returns array of `{filename, contents}`), `deleteFunction(ref, slug)` (rm -rf the slug dir + DB delete + restart trigger). No multipart parsing here.
- [X] T038 [US3] Create `apps/api/src/services/function-deploy.ts` — the deploy hot path, supporting BOTH wire formats. Two entry points (routes from T039 pick the right one — no content-type sniffing inside the service): **`deployFromMultipart({req, ref, slug, deployerUserId, mode})`** (`--use-api` path) stream-parses via `@fastify/multipart`, collects `metadata` part + N `file` parts to `/tmp/selfbase-uploads/<requestId>/<filename>`, computes `ezbr_sha256` over sorted `(filename, contents)` pairs, builds a staging tree containing source files + a generated `meta.json` with `source_path: "index.ts"`. **`deployFromEszip({req, ref, slug, deployerUserId, mode, queryMeta})`** (default eszip path) streams the raw body to `/tmp/selfbase-uploads/<requestId>/bundle.eszip`, validates the `ESZIP` magic bytes, computes SHA-256, compares against the `ezbr_sha256` query param (reject `422 code: ezbr_mismatch` on mismatch), and builds a staging dir containing `bundle.eszip` + a generated `meta.json` with `source_path: "bundle.eszip"` and the rest of the metadata from `queryMeta`. Both entry points converge on a shared `commitDeploy(stagingDir, ref, slug, mode, deployerUserId, deployMetaForAudit)` helper that: validates slug regex; validates path-escape (multipart only); BEGIN tx → snapshot existing `volumes/functions/<slug>/` to `.deploy-rollback/<slug>-<ts>/` if present → atomically move staging → insert/update `project_functions` row (sets `source_path` to whichever the staging dir produced) → COMMIT; triggers `dockerControl.restart('selfbase-<ref>-functions-1')` with 5s `waitHealthy`; on restart-fail: restores snapshot, rolls back DB row, throws `ManagementApiError(500, ..., 'deploy_rolled_back')`; inserts `function_deploys` audit row; returns `DeployFunctionResponse`. Use `@selfbase/docker-control` — do NOT shell out.
- [X] T039 [US3] Create `apps/api/src/routes/management/functions.ts` — registers **seven** function endpoints: (1) `GET /v1/projects/:ref/functions` (list, populates `ezbr_sha256` from `project_functions.sha256` for skip-no-change), (2) `PUT /v1/projects/:ref/functions` (bulk-update, echoes back the array merged with stored state), (3) `POST /v1/projects/:ref/functions/deploy` (multipart `--use-api` path, calls T038 with `mode: "create"` semantically), (4) `POST /v1/projects/:ref/functions` (eszip body, default path, calls T038 with `mode: "create"`; slug comes from `?slug=` query param), (5) `PATCH /v1/projects/:ref/functions/:slug` (eszip body, default path, calls T038 with `mode: "update"`), (6) `GET /v1/projects/:ref/functions/:slug/body` (multipart response from T037), (7) `DELETE /v1/projects/:ref/functions/:slug` (via T037). Use Fastify's content-type matchers to route (3) vs (4) on `POST /v1/projects/:ref/functions` — multipart goes to the `/deploy` sub-path, eszip body goes to the root path; the CLI uses different URLs for the two paths so there's no ambiguity in practice.
- [X] T040 [US3] Register T039 in `apps/api/src/server.ts` inside the `/v1` mgmt group. Bump `bodyLimit` on the Fastify instance (or scope it to the mgmt group) to 50 MB so the raw-eszip endpoints can accept binary bodies through to T038.
- [X] T041 [P] [US3] Modify `infra/supabase-template/volumes/functions/main/index.ts` to detect per-function eszip bundles. **Add `// selfbase-functions-main:v2` as the very first line** of the file — T042 reads this marker to decide whether an existing instance has the new router or still ships the v1 variant. After the existing JWT-verification block, before dispatching: check for `${servicePath}/meta.json`; if present and `meta.source_path === "bundle.eszip"`, read `${servicePath}/bundle.eszip` into a `Uint8Array` and pass it as `maybeEszip` along with `meta.entrypoint_path` as `maybeEntrypoint` in the `EdgeRuntime.userWorkers.create({...})` options. Otherwise, fall through to the existing servicePath-based loading (raw source files or no `meta.json` at all). Preserve all current behavior for functions deployed before this feature ships. Reference implementation: `experiments/eszip-runtime-loading.md` §3.
- [X] T042 [US3] Create `apps/worker/src/scripts/sync-functions-main.ts` — a one-shot script that walks `/var/selfbase/instances/*/volumes/functions/main/index.ts` and re-syncs each from `infra/supabase-template/volumes/functions/main/index.ts` (the file T041 updated). Invoke via `pnpm --filter @selfbase/worker exec tsx src/scripts/sync-functions-main.ts` (also wire up as `"sync:functions-main": "tsx src/scripts/sync-functions-main.ts"` in `apps/worker/package.json` scripts). This is needed because existing provisioned instances ship the OLD main router; they need the eszip-aware variant for eszip-path deploys to work. Idempotent: detect whether an instance already has the new router by looking for a `// selfbase-functions-main:v2` marker comment as the first line of the new template (add this marker as part of T041); skip instances that already have it. Document the rollout sequence in the script header: deploy api with new template → run `pnpm sync:functions-main` → eszip deploys start working across the fleet. The script does NOT restart the per-instance functions containers — those restart organically on the next deploy.
- [X] T043 [P] [US3] Integration test at `apps/api/tests/integration/management-api/functions-bulk.test.ts` (NEW file, separate from T034 to keep test files small) covering: a sequence of two eszip POSTs + one bulk PUT, asserting the bulk PUT returns `{functions: [...]}` reflecting both stored functions with the per-function metadata intact (from the per-function POSTs, not from the bulk-PUT body).
- [X] T044 [P] [US3] Create the E2E script `tests/cli-e2e/deploy-hello.sh` per the template at the bottom of `quickstart.md`. Make it executable. Add `"test:cli": "tests/cli-e2e/deploy-hello.sh"` to root `package.json` scripts. Requires `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF` env. **Two variants**: one using the default eszip path (requires Docker on the runner), one using `--use-api` (no Docker). The script MUST also assert (covers spec FR-004 explicitly): (a) `supabase login --profile <toml>` exits 0 when given the PAT via stdin or `SUPABASE_ACCESS_TOKEN`; (b) `~/.supabase/profile` is written after login; (c) `supabase projects list` exits 0 and prints at least the project ref the script's `SELFBASE_PROJECT_REF` points at. Default off in PR CI; document running it locally in the script header.

**Checkpoint**: `supabase functions deploy hello --use-api` works end-to-end on a real deployment.

---

## Phase 6: User Story 4 — Manage runtime secrets (Priority: P1)

**Goal**: `supabase secrets set FOO=bar` updates the runtime env in ≤5s; the next function invocation sees the new value without a redeploy.

**Independent Test**: With US3 complete, deploy a function that returns `Deno.env.get('FOO')`, set `FOO=hello`, curl the function, expect `hello`. Unset `FOO`, curl, expect empty.

### Tests for User Story 4

- [X] T045 [P] [US4] Integration test at `apps/api/tests/integration/management-api/secrets-list.test.ts` — `GET /v1/projects/:ref/secrets` returns `[{name, value: '<sha256>'}, ...]`. Plaintext values MUST NOT appear in the response anywhere.
- [X] T046 [P] [US4] Integration test at `apps/api/tests/integration/management-api/secrets-set.test.ts` — `POST .../secrets` with `[{name: 'FOO', value: 'bar'}]` returns 201, persists encrypted row, writes `FOO=bar` to the per-instance `.env`, calls `dockerControl.restart('...functions-1')` exactly once. A second POST with the same name replaces (not duplicates). Setting `JWT_SECRET` returns 409 with `code: reserved_name`. Setting `foo` (lowercase) returns 422.
- [X] T047 [P] [US4] Integration test at `apps/api/tests/integration/management-api/secrets-delete.test.ts` — `DELETE .../secrets` with `["FOO"]` removes the DB row and the `.env` line and restarts. Deleting a non-existent name returns success (idempotent), not 404.

### Implementation for User Story 4

- [X] T048 [P] [US4] Create `apps/api/src/services/secret-store.ts` — pure logic plus disk + DB. Exports: `RESERVED_SECRET_NAMES` (the 25-entry list from R-005), `validateSecretName(name)` (regex + reserved-check), `listSecrets(ref)` (DB rows + redaction), `setSecrets(ref, entries)` (per-instance Redis lock → backup `.env` → upsert DB rows (encrypted) → rewrite `.env` → restart container → release lock; rollback on any failure), `deleteSecrets(ref, names)` (same lock + restart cycle).
- [X] T049 [US4] Create `apps/api/src/routes/management/secrets.ts` — registers `GET /v1/projects/:ref/secrets`, `POST /v1/projects/:ref/secrets`, `DELETE /v1/projects/:ref/secrets`. Wire each to the corresponding T048 service function.
- [X] T050 [US4] Register T049 in `apps/api/src/server.ts` inside the `/v1` mgmt group.
- [X] T051 [US4] Manual E2E checkpoint: after T039 and T049 are live, run the Story 4 acceptance sequence from `quickstart.md` against a real instance: deploy `hello` that returns `Deno.env.get('EXAMPLE_KEY')`, set the secret, curl, observe propagation in <5s.

**Checkpoint**: All four P1 stories work end-to-end. The MVP is shippable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T052 [P] Run `quickstart.md`'s performance assertions on a real selfbase deployment and record the actual numbers (first deploy via eszip path, first deploy via `--use-api` path, repeat deploy, secret propagation) in `quickstart.md`'s "Performance assertions" table. Confirm they meet SC-003/SC-004/SC-005. **Also covers SC-006 (95% no shape-mismatch errors)**: during the quickstart run, pipe all CLI output through `tee /tmp/quickstart-cli.log` and grep the log afterward for `Try rerunning the command with --debug`, `json: cannot unmarshal`, and `Unexpected error` lines. Expect zero occurrences across the full quickstart sequence; record the count alongside the perf numbers.
- [X] T053 [P] OpenAPI conformance test at `apps/api/tests/integration/management-api/openapi-conformance.test.ts` — for every endpoint defined in `contracts/management-api.yaml`, hit a representative request and assert the response shape conforms via a JSON-schema validator. Single test file, one `describe.each` per endpoint. Catches drift between our implementation and the contract. **Also covers FR-023 (forward-compat)**: add an additional `describe('forward compat', ...)` block that issues representative requests to each write endpoint (`POST /secrets`, `POST /functions/deploy`, `PUT /functions`) with one extra unknown JSON field in the body (e.g. `{"name":"FOO","value":"bar","__future_field__":"ignored"}`); asserts the response is NOT 4xx — selfbase MUST silently ignore the unknown field.
- [X] T054 [P] Idempotency test: a vitest job that runs `0002_cli_compat.sql` twice against a freshly-migrated PG, expects zero errors and identical schema both times.
- [X] T055 [P] Cleanup: search for any remaining `sb_<hex64>` token-format references in code or docs, replace or remove. Grep `apps/`, `packages/`, `infra/`, `specs/` for the literal `sb_` followed by 64 hex chars or for any reference to the old format.
- [X] T056 Update `apps/web/src/pages/SettingsTokens.tsx` UI copy: add a one-line note "Tokens use the `sbp_…` format compatible with the Supabase CLI" near the create-token CTA. Verify the existing rendering still works.
- [X] T057 [P] Add a one-paragraph "Supabase CLI compatibility" section to the root `README.md` linking to the Connect-CLI dashboard page. No detailed instructions — point at the in-app page.
- [X] T058 Run the end-to-end `pnpm test:cli` script (T044) against staging — both eszip and `--use-api` variants — and confirm exit 0 on both.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)** → **Phase 2 (Foundational)** → all User Story phases → **Phase 7 (Polish)**.
- **Phase 2 → Phase 3, 4, 5, 6**: Foundational must complete before any user story phase begins (every story touches the mgmt route group, the auth path, the error envelope, the Zod schemas, the entity-mapping service).
- **User Story phases**: Logically independent once Phase 2 ships, but **functionally** US2 is needed for US3 (deploy needs `getProjectByRef` to resolve `<ref>`) and US3 is needed for US4's E2E checkpoint (you can't test a secret reaching a function without a function). The integration tests of each story can be written and pass independently (using fake instance rows + recorded docker-control); the E2E checkpoints are sequential.
- **Phase 7**: Depends on the four stories being feature-complete.

### Within Each User Story

- Test tasks marked [P] are file-independent and can run in parallel.
- Service tasks (T037, T038, T048) precede route tasks (T039, T049) within the same story — different files but the route imports the service.
- Server-registration tasks (T019, T030, T040, T050) are sequential because they all edit `apps/api/src/server.ts`.

### Parallel Opportunities

- **Phase 1**: T003 and T003a in parallel with T001/T002 (different files). T003a can also run anytime later — its unit tests don't import any production code that doesn't yet exist (the imports land progressively as T005, T008, T038, T048 ship).
- **Phase 2**: T004, T005, T006, T007, T008 all parallel (different files). T009 serializes after T004 because the migration file needs the Drizzle schema understood. T010 serializes after T006/T007 (it imports them). T011, T012 parallel after T010.
- **Phase 3** (US1): Tests T013/T014/T015 in parallel; implementations T016/T017/T018/T020/T021 in parallel; T019, T022, T023, T024 serialize on `server.ts` or `App.tsx`.
- **Phase 4** (US2): T025/T026 in parallel; T027/T028/T029 mostly parallel (T028 and T029 import T027 but write different files).
- **Phase 5** (US3): T032–T036 (tests) all in parallel; T037 and T038 in parallel; T039 imports both. T041 (router update) and T044 (E2E) parallel with everything else. T042 (worker re-sync) serializes after T041 because it ships the file T041 created. T043 (bulk test) parallel.
- **Phase 6** (US4): T045/T046/T047 parallel (tests); T048 then T049.
- **Phase 7**: All polish tasks fully parallelizable except T056 (modifies a file owned by US1).

---

## Parallel Example: Phase 2 Foundational

```text
# Day 1, morning — three engineers grab one task each:
T004 [P]  Drizzle schema entries (packages/db/src/schema.ts)
T005 [P]  Token format change (apps/api/src/services/api-tokens.ts)
T006 [P]  Error envelope plugin (apps/api/src/plugins/mgmt-api-errors.ts)

# Day 1, afternoon — same engineers, different files:
T007 [P]  Zod schemas (packages/shared/src/mgmt-api-schemas.ts)
T008 [P]  Entity-mapping service (apps/api/src/services/mgmt-api-mapping.ts)

# Day 2 — needs T004 done:
T009      Migration SQL (packages/db/migrations/0002_cli_compat.sql)

# Day 2 afternoon — needs T006, T007 done:
T010      Mount /v1 group (apps/api/src/server.ts)

# Day 2 evening — parallel after T010:
T011 [P]  Not-implemented catch-all
T012 [P]  Foundations integration test

# Checkpoint passes when T012 runs green.
```

---

## Implementation Strategy

### MVP First (US1 + US2 + US3, skip US4 for first cut)

1. Setup + Foundational (~2 days for one engineer).
2. US1 + US2 (~2 days) — `supabase login` + `supabase link` works against selfbase.
3. US3 (~2 days) — `supabase functions deploy hello --use-api` lands.
4. **STOP and validate**. Run the full `quickstart.md` for stories 1–3.
5. Demo: real CLI ships a function to a real selfbase instance.

US4 adds in another day. Total: **~5-7 dev-days** for one engineer, more compressible with parallel team execution.

### Incremental Delivery

Each story's checkpoint produces a shippable increment. US1 alone is demonstrable ("the CLI talks to selfbase") even before US3 — a useful interim release.

### Parallel Team Strategy (2 engineers)

- Engineer A: Foundational backend + US1 backend + US2 backend + US3 backend.
- Engineer B: Foundational frontend (T021 client) + US1 frontend (T020/T022/T023/T024) + US3/US4 E2E scripts and integration tests.

The frontend can land entirely after Foundational and before any backend story is wired, because it talks to the dashboard surface (T018) — independent of the management API.

---

## Notes

- Test tasks are included per `research.md` R-011 — three tiers. The opt-in E2E (T044, T058) requires Docker + an apex; it's not on PR-time CI by default.
- Both deploy paths (eszip default + `--use-api` fallback) are supported per `research.md` R-002 and the empirical proof in `experiments/eszip-runtime-loading.md`. T022's dashboard page shows the eszip-default canonical command; T035 verifies the eszip path serves; T044's E2E script runs both variants.
- No CLI fork, no CLI patches, no `/etc/hosts` shims. The entire feature is server-side + a dashboard page.
- The deploy SLO (SC-003: 15s first deploy) is defended by T038's 5s container-restart budget; the rest of the budget belongs to the developer's local Deno bundling, multipart upload, and runtime cold start.
- `dockerControl` is the only abstraction across container restarts — no `child_process.exec('docker ...')` anywhere in the new code.
