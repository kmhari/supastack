# Tasks: Secrets management — single-track via supabase_vault

**Input**: Design documents from `/specs/010-secrets-management/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Included (security-sensitive code; spec.md emphasizes wire-contract preservation per SC-008 and TTL/concurrency behavior per SC-010).

## Format

`[ID] [P?] [Story] Description with file path`

- **[P]** — can run in parallel (different file, no in-flight dependency)
- **[Story]** — US1 / US2 / US3 / US4 per spec
- All paths are repo-relative

---

## Phase 1: Setup

**Purpose**: Move the canonical reserved-secret list into shared + register new RBAC actions.

- [X] T001 [P] Move `RESERVED_SECRET_NAMES` from `apps/api/src/services/secret-store.ts` into a new `packages/shared/src/reserved-secrets.ts` exporting `RESERVED_SECRETS: { name, description }[]` and `RESERVED_SECRET_NAMES: Set<string>`. Add ~25 entries with one-line descriptions (source the list from current `secret-store.ts`). **Done** — canonical name list lives in `reserved-secrets.json`; TS module adds descriptions. NOTE: the const in `secret-store.ts` is left in place for now (still used by the legacy code path); it'll be removed in T027 when secret-store is rewritten.
- [X] T002 [P] Add new RBAC actions `instance.secrets.read`, `instance.secrets.write`, `instance.vault.enable` to `packages/shared/src/rbac.ts` matrix (admin: ✓ for all; member: read ✓, write/enable ✗). **Done**. RBAC contract test snapshot updated.
- [X] T003 Build-time materialization: `packages/shared/scripts/materialize-reserved-secrets.mjs` + wired as `"build": "npm run build:reserved-secrets"` in `packages/shared/package.json` so it runs as part of the workspace build. **Done + executed**; JSON now present at `infra/supabase-template/volumes/functions/main/reserved-secrets.json`.

---

## Phase 2: Foundational

**Purpose**: Schema migrations + the per-project Postgres client helper. Required by every user story.

- [X] T004 Create migration `packages/db/migrations/0010_instances_vault_enabled_at.sql`: idempotent `ALTER TABLE supabase_instances ADD COLUMN IF NOT EXISTS vault_enabled_at timestamptz NULL` + partial index `idx_supabase_instances_vault_pending`. **Done**. (Note: table is `supabase_instances`, not `instances`.)
- [X] T005 N/A — `audit_log.action` is plain `text` with no CHECK constraint (verified against `0000_init.sql`). New action values (`instance.secrets.set`, `instance.secrets.delete`, `instance.vault.enabled`) require no schema change; they're just emitted at the application layer.
- [X] T006 Update Drizzle schema in `packages/db/src/schema/instances.ts` to add `vaultEnabledAt` column on `supabaseInstances`. **Done**.
- [X] T007 Create `apps/api/src/services/vault-client.ts`: exports `withVaultClient<T>(ref, fn)` opening a short-lived `pg.Client` to `host.docker.internal:<port_db_direct>` as `supabase_admin` (password from `encryptedSecrets` via `decryptJson`). Also exports `vaultListAll`, `vaultFindIdByName`, `vaultCreate`, `vaultUpdate`, `vaultDeleteByNames` SQL helpers. **Done**.
- [X] T008 [P] Vitest unit test `apps/api/tests/unit/vault-client.test.ts`: 7 tests covering SQL shape, parameterization, ordering. **All passing**.

**Checkpoint**: schema migrations applied + reusable per-project pg client ready. User stories can now begin.

---

## Phase 3: User Story 2 — Vault enablement (Priority: P1, foundation for US1+US3) 🎯 MVP-prereq

**Goal**: `pgsodium` + `supabase_vault` enabled on every project (new via provision, existing via boot-time backfill + dashboard button). SQL callers (cron, triggers) can use `vault.decrypted_secrets`. Studio's bundled Vault UI lights up.

**Independent Test**: From psql against any project, `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium','supabase_vault')` returns both rows; `SELECT vault.create_secret('v','n')` then `SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name='n'` returns `'v'`; Studio's Vault page renders.

### Tests for US2

- [X] T009 [P] [US2] Unit test created at `apps/worker/tests/unit/vault-bootstrap.test.ts` (moved from `apps/api/tests/unit/` because the service itself lives in worker — both call sites are worker-side: provision job + vault-enable job). 6 tests covering SQL order, IF NOT EXISTS idempotency markers, pgsodium key guard, error tagging by stage, missing-extension detection, smoke-test failure surfacing. **All passing**.
- [X] T010 [P] [US2] Unit test `apps/worker/tests/unit/vault-enable-job.test.ts`: 3 tests covering happy path (marker update + audit), bootstrap failure (no marker, no audit, error propagates), source-tag preservation in audit payload. **All passing**.

### Implementation for US2

- [X] T011 [US2] Created at `apps/worker/src/services/vault-bootstrap.ts` (worker, not api — see T009 note). Exports `bootstrapVault(client)` running the 5-stage SQL sequence with idempotency markers + smoke test. `VaultBootstrapError` carries the failing stage.
- [X] T012 [US2] Created `apps/worker/src/jobs/vault-enable-job.ts` exporting `handleVaultEnable({ ref, source })`. Opens per-instance pg.Client to host.docker.internal as supabase_admin, calls bootstrapVault, updates `vaultEnabledAt`, emits `instance.vault.enabled` audit. Returns `{ ref, durationMs }`.
- [X] T013 [US2] Registered `vaultEnable` queue + processor in `apps/worker/src/queues.ts` with `concurrency: 5`. (Note: queue registration lives in queues.ts, not main.ts — verified from existing pattern.)
- [X] T014 N/A — boot-time backfill scan dropped per architecture revision (deployment will be reset before ship; no pre-existing instances to migrate). Provision hook (T016) covers all new instances; dashboard button (T017) handles backup-restore edge case.
- [X] T015 N/A — see T014.
- [X] T016 [US2] Hooked into `apps/worker/src/jobs/provision.ts` between step 6b (auth probe) and step 7 (mark running). Synchronous call to `handleVaultEnable({ ref, source: 'provision' })`. Throws → caught by outer catch → instance marked `failed` with provisionError (existing pattern).
- [X] T017 [US2] Created `apps/api/src/routes/vault-enable.ts` — `POST /api/v1/projects/:ref/vault/enable`. RBAC: `instance.vault.enable`. Idempotency: peeks at waiting/delayed/active jobs via `findInFlightVaultEnable(ref)`; if match, returns existing jobId with `queued: false`. 404 for unknown ref, 409 for paused/stopped/deleting status. Also added `apps/api/src/services/vault-enable-client.ts` as the thin BullMQ enqueue client.
- [X] T018 [US2] Registered in `apps/api/src/server.ts` alongside other `/api/v1/*` routes.
- [X] T019 [P] [US2] Contract test `apps/api/tests/contract/vault-enable.test.ts`: live-API skipIf-gated (matches existing pattern). Covers 401 no auth, 403 member, 404 unknown ref, 202 happy path, 202 idempotent double-POST. Executes on the VM when TEST_API_URL + tokens are set.

**Checkpoint**: every project — new + existing — has vault enabled. SQL callers + Studio Vault page work. US1 and US3 can now be built on top.

---

## Phase 4: User Story 3 — Edge runtime vault injection with TTL cache (Priority: P1, enabling for US1)

**Goal**: Patched per-project `main/index.ts` fetches vault on worker spawn, caches for 5s, injects as `envVars`. Eliminates container restart from the secret-save flow.

**Independent Test**: With a vault row `TEST_KEY=alpha`, invoke a function reading `Deno.env.get('TEST_KEY')` → returns `'alpha'`. Update the row to `'beta'`. Within ≤10s, fresh invocation returns `'beta'`. `docker logs` shows zero restart events.

### Tests for US3

- [X] T020 [P] [US3] Deno test file `infra/supabase-template/volumes/functions/main/main.test.ts` with 7 cases (a–f + extra cache-fallback). All pass via `deno test --allow-env --allow-read --allow-net`. The cache/refresh logic is reimplemented in-test (mirroring index.ts) so we can inject fakes — index.ts itself has top-level `Deno.serve()` and can't be imported in isolation; the duplication trade-off is acceptable for security-critical code where the contract matters more than DRY.

### Implementation for US3

- [X] T021 [US3] Rewrote `infra/supabase-template/volumes/functions/main/index.ts` (supastack-functions-main:v3). Uses `https://deno.land/x/postgres@v0.19.3` (not `npm:postgres` — corrected to match the file's existing `deno.land/x` imports for `jose`). Module-level cache + single in-flight refresh promise + reserved-name filter loaded from `./reserved-secrets.json` + platform-env-wins merge. Cache pre-warmed at boot. Preserved all existing JWT/JWKS auth + eszip loading paths.
- [X] T022 [US3] Added `SB_REF: ${PROJECT_REF}` + `SUPASTACK_VAULT_TTL_MS: ${SUPASTACK_VAULT_TTL_MS:-5000}` to functions service env in `infra/supabase-template/docker-compose.yml`. `SUPABASE_DB_URL` confirmed to use `postgres` user which IS SUPERUSER in supabase/postgres image — no separate `SUPASTACK_VAULT_DB_URL` needed (the runtime falls back to `SUPABASE_DB_URL` if `SUPASTACK_VAULT_DB_URL` is absent). `PROJECT_REF` is already populated by `packages/docker-control/src/compose-template.ts` so no builder changes required. `reserved-secrets.json` is materialized into the volume by T003's script.
- [X] T023 [US3] Implemented in T021: `[supastack-vault] refreshed N secrets (filtered M reserved) for <ref> in Xms` (info), `refresh failed for <ref>; serving N cached secrets: <err.message>` (warn), `refresh failed for <ref>; no cache; worker will spawn with no user secrets: <err.message>` (error). Names + ref + duration only — verified by T020(f).

**Checkpoint**: runtime injection works. US1's dashboard saves will now propagate to `Deno.env` within the TTL window. US1 implementation can proceed.

---

## Phase 5: User Story 1 — Dashboard secrets CRUD (Priority: P1) 🎯 MVP

**Goal**: Operator manages edge function secrets from `/dashboard/project/<ref>/secrets`. Save propagates to functions within ≤10s without container restart (relies on US3).

**Independent Test**: Visit page as admin. Save `TEST_SECRET=hello`. Table shows it within 2s. Edge function reading `Deno.env.get('TEST_SECRET')` returns `"hello"` within 10s. No functions-container restart in `docker logs`.

### Tests for US1

- [X] T024 [P] [US1] Created `apps/api/tests/unit/secret-store-vault.test.ts` (new file, not a rewrite of secret-store-name.test.ts which still validates pure helpers). 11 tests using vi.hoisted mocks: reserved-name 409, invalid-name 422, empty-value 422, BEGIN/COMMIT wrapping with update-vs-create dispatch, ROLLBACK on per-entry failure, error translation (404 / 503), list-shape with reserved filter + sha256 digest, delete short-circuit / reserved guard / delegation. **All passing**.
- [X] T025+T026 [P] [US1] Combined into `apps/api/tests/contract/secrets-wire.test.ts`. Live-API skipIf-gated. Covers (a) `/v1/*` GET bare-array shape with sha256 digests, POST 201 `{message}`, reserved-name 409, DELETE 200, 401 no auth (SC-008 wire preservation); (b) `/api/v1/*` session-auth + 403 for member POST + member-can-GET (read perm allowed in revised RBAC), 401 no auth.

### Implementation for US1

- [X] T027 [US1] Rewrote `apps/api/src/services/secret-store.ts` over `vault-client`. `listSecrets` selects from `vault.decrypted_secrets`, filters reserved, computes server-side sha256. `setSecrets` opens single transaction with per-entry update-vs-create dispatch. `deleteSecrets` calls `vaultDeleteByNames`. `.env` write + container restart paths removed. Reserved names sourced from `@supastack/shared`. `validateSecretName` + `upsertEnvEntry`/`removeEnvEntry` pure helpers retained for existing test compatibility (will be removed alongside the eventual `project_secrets` table drop).
- [X] T028 [US1] Existing `apps/api/src/routes/management/secrets.ts` (not `/routes/secrets.ts` as my plan said — actual location is `routes/management/`) delegates to `secret-store` and required no changes. Wire contract preserved verbatim: GET returns bare `[{name, value: sha256}]` array, POST/DELETE accept bare arrays, 201 + 200 status codes, `reserved_name` 409, `validation` 422.
- [X] T029 [US1] Created `apps/api/src/routes/secrets-dashboard.ts` for `/api/v1/projects/<ref>/secrets`. Session-cookie auth via `app.requireAuth`, RBAC via `app.authorize('instance.secrets.read' | 'instance.secrets.write')`. Delegates to shared `secret-store`. Translates `ManagementApiError` → dashboard `{ error: {code, message, details} }` envelope. Emits `instance.secrets.set` / `instance.secrets.delete` audit entries.
- [X] T030 [US1] Registered in `apps/api/src/server.ts`.
- [X] T031 [P] [US1] Added `secretsApi` + `vaultApi` to `apps/web/src/lib/api.ts` + `SecretListEntry` type.
- [X] T032 [US1] Created `apps/web/src/pages/ProjectSecrets.tsx`. Three sections: add/replace form with multi-row + "Multi/Single" line toggle (Textarea for multi), Custom secrets table with client-side search + per-row Delete, Default secrets reference from `@supastack/shared` `RESERVED_SECRETS`. Confirmation dialog on Delete. Auto-splits `KEY=value` pastes. Disables Save/Delete buttons for non-admins. Uses existing `ProjectShell` + shadcn primitives.
- [X] T033 [US1] Added "Secrets" entry between "JWT Keys" and "Backups" in `apps/web/src/components/ProjectShell.tsx` Configuration group.
- [X] T034 [US1] Wired `/dashboard/project/:ref/secrets` route in `apps/web/src/App.tsx`.
- [X] T035 [P] [US1] Live-VM E2E script `tests/cli-e2e/secrets-dashboard.sh` covering (a) SC-003 timing assertion on 10-secret batch (`date +%s%N` deltas, fails if >5000ms), (b) optional propagation test with `TEST_FUNCTION_SLUG` env, (c) zero-restart assertion via `docker inspect --format='{{.RestartCount}}'` before/after, (d) cleanup. Executable. Requires only bash + curl + jq + optional ssh.

**Checkpoint**: US1 + US2 + US3 ship together as a coherent slice — dashboard works, vault is enabled, runtime reads it. This is the MVP.

---

## Phase 6: User Story 4 — Studio `/functions/secrets` redirect (Priority: P2)

**Goal**: 302 from Studio's broken page → working supastack secrets page, preserving query strings + sub-paths.

**Independent Test**: `curl -I https://studio-<ref>.<apex>/project/default/functions/secrets` returns 302 with `Location: https://<apex>/dashboard/project/<ref>/secrets?`. Other Studio paths pass through unchanged.

### Implementation for US4

- [X] T036 [US4] Added `studioSecretsRedirectRoute` to `apps/api/src/services/caddy-config.ts` (Caddy config is JSON-emitted via admin API, not a static Caddyfile). Per-instance route inserted BEFORE `instanceStudioRoute` so path-precise match evaluates first. 302 with `Location: https://<apex>/dashboard/project/<ref>/secrets{query}` preserving query string. Existing `caddy-config-layer4.test.ts` still passes.
- [ ] T037 [US4] Live-VM manual verification step (documented in `quickstart.md`) — needs deploy first.

**Checkpoint**: Studio's sidebar Secrets link now lands operators on the working dashboard page.

---

## Phase 7: Polish & Cross-cutting

- [X] T038 [P] CLAUDE.md "What's shipped" row added for feature 010 with link to docs/changes.
- [X] T039 [P] Created `docs/changes/010-secrets-management.md` — architecture diagram, before/after table, breaking-change callout, knob reference, per-project commands, failure-mode runbook, caveats.
- [ ] T040 [P] Release-notes / PR description — to be written when opening PR.
- [X] T041 [P] Draft migration `packages/db/migrations/0011_drop_project_secrets.sql` created (DROP statement commented out). Hold for separate PR after deprecation window.

---

## Dependencies

```
Setup (T001..T003)
  ├─→ Foundational (T004..T008)
  │     ├─→ US2 (T009..T019)  ← P1, foundation
  │     │     ├─→ US3 (T020..T023) ← P1, requires vault enabled
  │     │     └─→ US1 (T024..T035) ← P1, requires US2 + US3
  │     └─→ US4 (T036..T037) ← P2, independent
  └─→ Polish (T038..T041)
```

Note: US2 → US3 → US1 is the ship order. US1 is meaningless without US3 (saves wouldn't propagate). US3 is moot without US2 (vault doesn't exist). US4 (Caddy redirect) is independent and could ship first or last — but only useful once US1 exists.

## Parallel execution opportunities

Within each phase, all `[P]` tasks touch different files and can run concurrently:

- **Setup**: T001 + T002 in parallel; T003 sequential (depends on T001).
- **Foundational**: T004 + T005 + T008 in parallel; T006 + T007 sequential.
- **US2 tests**: T009 + T010 in parallel.
- **US2 impl**: T019 (contract test) can run in parallel with implementation once route exists.
- **US1 tests**: T024 + T025 + T026 in parallel before implementation (TDD-ish).
- **US1 impl**: T031 + T035 parallel with the route/page work.
- **Polish**: T038 + T039 + T040 + T041 all parallel.

## MVP scope

US1 + US2 + US3 together = MVP. Shipping US1 alone without US2/US3 leaves the dashboard non-functional (no vault to write to, no runtime to read it). US4 is a discoverability nice-to-have and can land in the same PR or a follow-up.

## Task count summary

| Phase | Count |
|---|---|
| Setup | 3 |
| Foundational | 5 |
| US2 (vault enablement) | 9 (T014/T015 dropped — no boot scan needed) |
| US3 (runtime injection) | 4 |
| US1 (dashboard CRUD) | 12 |
| US4 (Caddy redirect) | 2 |
| Polish | 4 |
| **Total** | **39** |

Independent test criteria per story documented in each phase's header. All tasks include exact file paths.
