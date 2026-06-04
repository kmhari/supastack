---
description: "Task list — feature 086 platform base=root + legacy studio to /setup (gated) + real DB backups"
---

# Tasks: Platform Studio base=root + legacy studio to /setup (gated) + real database backups

**Input**: Design documents from `specs/086-platform-base-root-url/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{routing,setup-org,studio-build,setup-gate,backups}.md, quickstart.md

**Tests**: INCLUDED — US4 is a regression-guard story; the plan calls for unit tests (org-store, gate config, backup adapter); operator preference is happy+sad path coverage.

**Organization**: by user story (US1 P1; US2/US3/US5/US6 P2; US4 P3). `/api/v1` is the RETAINED internal engine (the backup engine is **reused** by US6, not retired). **US6 adds ONE idempotent migration** (numeric `seq` surrogate on `backups`).

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete deps)
- Paths are repo-relative.

---

## Phase 1: Setup (baseline)

**Purpose**: capture a green baseline before changes.

- [ ] T001 Confirm on branch `086-platform-base-root-url`; capture baseline: run `pnpm --filter @supastack/api test` and `pnpm --filter @supastack/web build` + `pnpm --filter @supastack/web test`, record pass counts in the runbook draft `docs/changes/086-platform-base-root-url.md`.
- [X] T002 (DONE — committed `8d91b52`) Settle the unrelated uncommitted change in `apps/api/src/routes/platform-misc.ts` (billing stubs `free`→`pro` + `buildOrg` mocks): committed standalone as `feat(studio-mock)`, kept out of 086's diff.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: none. The user stories are independent; US1 is the only one requiring a coordinated deploy.

- [ ] T003 (gate) Confirm through all phases: the **only** DB migration is the US6 backup-`seq` surrogate `0019` (idempotent + additive, Constitution I); the `/v1` OpenAPI snapshot is untouched (Constitution IV); no `/api/v1` route is removed (FR-010/FR-013 — the US2 SPA deletion touched only `apps/web/*`, never the `apps/api` engine; façade-copy removal stays a deferred follow-up).

---

## Phase 3: US1 — Platform studio clean Cloud-parity URLs (Priority: P1)

**Goal**: studio calls resolve at `/platform/*` + `/v1/*` (no `/api/v1/v1/*`).
**Independent test**: quickstart §1 — network panel shows 0 `…/api/v1/v1/…` requests; `/v1/*` + `/platform/*` at apex return 200.

- [X] T004 [US1] In `apps/api/src/server.ts`, add a root mount `await app.register(platformMiscRoutes);` immediately after the existing root `platformProxyRoutes` (~line 225). Keep the `/api/v1`-prefixed mounts (228-229) for now.
- [X] T005 [P] [US1] In `apps/caddy/Caddyfile`, add `handle /v1* { reverse_proxy api:3001 }` to the `:80` block, ordered after `/api/*` and before the studio catch-all.
- [X] T006 [US1] In `apps/caddy/Caddyfile`, add the same `handle /v1* { reverse_proxy api:3001 }` to the `:443`/apex block (same ordering). (same file as T005 → sequential)
- [X] T007 [P] [US1] In `apps/api/src/services/caddy-config.ts`, add a `/v1*` → `api:3001` subroute to `dashboardSubroutes`, mirroring the existing `/api/v1*` entry, ordered before the studio catch-all (this is the VM source of truth).
- [X] T008 [P] [US1] In `infra/docker-compose.yml`, change the studio `NEXT_PUBLIC_API_URL` from `https://${SUPASTACK_APEX}/api/v1` to `https://${SUPASTACK_APEX}`. Do NOT touch `NEXT_PUBLIC_GOTRUE_URL`.
- [X] T009 [US1] Write the coordinated-deploy + rollback procedure into `docs/changes/086-platform-base-root-url.md` per `contracts/studio-build.md` (build api → reload Caddy → `rm -rf .next` + `--force-recreate studio`).
- [X] T010 [US1] DEPLOY (operator-run on the VM): rsync; `docker compose build api && up -d api`; wipe studio `.next`; `--force-recreate studio`.
- [X] T011 [US1] LIVE VERIFY (quickstart §1): in the studio network panel 0 requests to `…/api/v1/v1/…`; curl `https://<apex>/v1/projects/<ref>/api-keys` → 200, `https://<apex>/platform/profile` → 200.
- [X] T012 [US1] After the rebuilt studio is confirmed live: remove the `/api/v1/v1/*` shim (`apps/api/src/server.ts:323-335`) and the `/api/v1`-prefixed `platformProxyRoutes`/`platformMiscRoutes` mounts (228-229).
- [X] T013 [US1] Guard: `grep -rn "/api/v1/v1" apps/api/src` returns no matches (quickstart §5); re-verify the studio still renders project pages.

**Checkpoint**: studio fully on clean URLs; shim gone.

---

## Phase 4: US2 — Legacy SPA reduced to the /setup wizard (Priority: P2)

**Goal**: `apps/web` serves only `/setup`; non-setup pages + their client methods removed.
**Independent test**: quickstart §2 — `/setup` loads (HTTP + HTTPS); `vite build` green; former routes redirect to `/setup`.

- [X] T014 [US2] In `apps/web/src/App.tsx`, trim `<Routes>` to `<Route path="/setup" element={<Setup/>} />` + catch-all `<Route path="*" element={<Navigate to="/setup" replace/>} />`; remove `RequireAuth`/`SetupGate`/`LegacyProjectRedirect` usage (keep `AuthProvider` — Setup uses `useAuth().refresh`).
- [X] T015 [P] [US2] Delete all non-setup pages: every `apps/web/src/pages/*.tsx` except `Setup.tsx`, plus the dirs `pages/auth-providers/`, `pages/auth-url-config/`, `pages/auth-hooks/`.
- [X] T016 [P] [US2] Delete page-only components (`apps/web/src/components/{ProjectShell,SettingsLayout,Shell,SetupGate,RequireAuth,CardRow,CliCommandBlock,InputWithCopy,PageHeader,RevealDialog,StatusPill,WildcardCertCard}.tsx` and page-only `ui/*` primitives) and unused libs `apps/web/src/lib/{safe-next,health-poll,use-reveal-credentials}.ts`. Keep `CopyButton.tsx` + `ui/{button,input,label,alert}.tsx`.
- [X] T017 [US2] In `apps/web/src/lib/api.ts`, keep only `setupApi`, `apexApi`, `wildcardCertApi`, `orgApi.patch`, `authApi.me` (+ backing types `ApexCert/ApexStatus/ChallengeRecord/DnsCheck/WildcardCert*`); delete all other method groups.
- [X] T018 [P] [US2] Trim `apps/web/tests/unit/api.test.ts` to assertions for the kept methods only. Keep `setupApi`, `authApi.me`, `apexApi`, `orgApi.patch`, `wildcardCertApi.{initiate,verify,status}`.
- [X] T019 [P] [US2] Delete the page-bound unit tests under `apps/web/tests/unit/`: `Instances/Login/MorePages/ProjectAuthProviders/ProjectAuthUrlConfig/ProjectSecrets.test.tsx`, `provider-registry.test.ts`, `redirect-url-helpers.test.ts` (+ `safe-next.test.ts`).
- [X] T020 [US2] Remove the Playwright e2e harness `apps/web/tests/e2e/**`, `expected-pages.ts` + `scripts/check-page-coverage.mjs` (+ `lint:page-coverage` wiring), and drop the `e2e` job in `.github/workflows/ci.yml`.
- [X] T021 [US2] Verify build: `pnpm --filter @supastack/web build` succeeds and `pnpm --filter @supastack/web test` + `lint` are green.
- [ ] T022 [US2] LIVE VERIFY the slimmed SPA **serves** `/setup` (FR-007 / SC-003): `https://<apex>/setup` loads + completes over HTTPS and `http://<server-ip>/setup` loads over plain HTTP (pre-DNS) with `GET /api/v1/setup/status` responding. (The `/`→`/setup` redirect + post-setup release is verified by US5's **T034** — not re-checked here.)

**Checkpoint**: apps/web is setup-only; builds + tests green; `/setup` verified live over HTTP + HTTPS.

---

## Phase 5: US3 — Setup reuses the platform org primitive (Priority: P2)

**Goal**: one shared org-creation implementation; first user via GoTrue.
**Independent test**: quickstart §3 — fresh setup → operator is a GoTrue `auth.users` row, org owned + visible via `/platform/organizations`; `createOrganizationWithOwner` unit test passes.

- [X] T023 [US3] Create `apps/api/src/services/org-store.ts` exporting `createOrganizationWithOwner(tx, { userId, name })`. Reuse the `Inserter` type from `services/api-tokens.ts`. (per `contracts/setup-org.md`)
- [X] T024 [P] [US3] Add `apps/api/tests/unit/org-store.test.ts` — happy: inserts one org + one `owner` membership, returns `{id,name}`, id matches ref format. Contract: forwards `name` verbatim.
- [X] T025 [US3] Wire `POST /platform/organizations` (`platform-misc.ts:284-297`) to `createOrganizationWithOwner` inside `db().transaction`; keep `requireAuth`, empty-name 400, and `buildOrg(...)` shape.
- [X] T026 [US3] Wire `apps/api/src/routes/setup.ts`: replace the inline org/member inserts with `createOrganizationWithOwner(tx, {...})` inside the existing tx. Keep installation/`setup_state`/audit/PAT/backfill.
- [X] T027 [US3] Verify first-user creation is GoTrue-only (`ensureGotrueUser`, no `public.users` write; `schema.users` = `auth.users`).
- [X] T028 [US3] Run `pnpm --filter @supastack/api test` (org-store unit + org/setup green); fresh-setup live check (quickstart §3).

**Checkpoint**: org creation has a single implementation; setup atomic + GoTrue-only user.

---

## Phase 6: US5 — Setup-completion gate (Priority: P2)

**Goal**: until setup completes, all dashboard routes (`/`, `/dashboard`, project URLs) redirect to `/setup`; after, `/` serves the platform studio.
**Independent test**: quickstart §6 — pre-setup `/`→302 `/setup`; post-setup `/`→studio 200; `<ref>.<apex>` host unaffected.

- [X] T029 [US5] In `apps/api/src/services/caddy-config.ts` `buildCaddyConfig()`, after the existing `installation` read, read `setup_state.completed_at`; on read error default `setupDone=false` (fail-safe). (per `contracts/setup-gate.md`)
- [X] T030 [US5] In `apps/api/src/services/caddy-config.ts`, make the apex `dashboardSubroutes` **catch-all** conditional: `setupDone===false` → `static_response` 302 `Location:/setup`; `true` → `reverse_proxy studio:3000`. Replace ONLY the final catch-all (handles 1-8 + per-instance `<ref>.<apex>` terminal routes untouched).
- [X] T031 [US5] In `apps/api/src/routes/setup.ts`, make `reloadCaddy()` on completion **unconditional** (drop the `if (body.apexDomain)` guard ~setup.ts:114) so completion drops the gate.
- [X] T032 [P] [US5] In `apps/caddy/Caddyfile` (`:80` + `:443`), change the boot catch-all from `reverse_proxy studio:3000` to a gated default (redirect to `/setup`) so a fresh box (pre-`/load`) redirects.
- [X] T033 [P] [US5] Unit test `apps/api/tests/unit/caddy-config-setup-gate.test.ts` — gated 302→/setup catch-all when `setup_state` incomplete; studio catch-all when complete; sad: read-error → gated (mock the `setup_state` query).
- [ ] T034 [US5] LIVE VERIFY (quickstart §6): pre-setup `GET /` → 302 `/setup`, `/api/v1/setup/status` reachable; complete setup → `GET /` → studio 200 (no redirect); `<ref>.<apex>` data-plane host unaffected throughout.

**Checkpoint**: the gate funnels to `/setup` pre-install and releases `/` to the studio post-install.

---

## Phase 7: US6 — Migrate the real database-backup engine into the platform studio (Priority: P2)

**Goal**: the platform studio Backups page lists real backups, runs real restores, and polls real status (Cloud-shaped).
**Independent test**: quickstart §7 — list real backups (numeric ids), restore → 201, status `RESTORING`→`ACTIVE_HEALTHY`; `/v1` uuid contract unchanged.

- [X] T035 [US6] Add idempotent migration `packages/db/migrations/0019_backup_seq.sql` — `ADD COLUMN IF NOT EXISTS seq bigint` on `backups` + a backing sequence (guarded) + backfill (`WHERE seq IS NULL`) + `SET DEFAULT nextval(...)` + a unique index on `(instance_ref, seq)` (per `contracts/backups.md`). Re-runnable (verify `migrate.ts` re-applies cleanly).
- [X] T036 [P] [US6] Add `listBackupsForPlatform(ref)` + a **ref-scoped** `resolveBackupSeq(ref, seq) → uuid|null` (query `WHERE seq=$seq AND instance_ref=$ref` — **never a global `seq` lookup**; returns null when the seq isn't a backup of THIS project) to `apps/api/src/services/backups-mgmt-service.ts` — Studio Cloud shape: `{ region:'local', pitr_enabled:false, walg_enabled:false, backups:[{ isPhysicalBackup:true, id:seq(number), inserted_at:ISO, status:UPPER, project_id:hashRefToInt(ref) }], physicalBackupData:{earliest/latestPhysicalBackupDateUnix} }` — `project_id` = a stable positive 31-bit int from a hash of `ref` (display-only). Do NOT reuse `listBackupsForCli` (CLI snake_case shape).
- [X] T037 [P] [US6] Unit test `apps/api/tests/unit/backups-platform-shape.test.ts` — `listBackupsForPlatform` mapping (status UPPER, `typeof id === 'number'` = seq, unix-sec dates, empty list ok); **drift guard**: assert top-level keys are exactly `{region,pitr_enabled,walg_enabled,backups,physicalBackupData}` and per-row keys are exactly `{isPhysicalBackup,id,inserted_at,status,project_id}` (catches Studio-shape drift); `resolveBackupSeq` happy + not-found→null + **a `seq` belonging to a DIFFERENT `ref` → null (the cross-project IDOR guard)**.
- [X] T038 [US6] Replace the `GET /platform/database/:ref/backups` stub (`platform-misc.ts:650-653`) with `listBackupsForPlatform` + `app.authorize(req,'backup.list')` + org-membership check.
- [X] T039 [US6] Wire `POST /platform/database/:ref/backups/restore-physical` (`platform-misc.ts:1946-1949`): `app.authorize(req,'backup.restore')`, resolve the body `{id}` via the **ref-scoped** `resolveBackupSeq(ref, id)` (**404 if the seq isn't a backup of THIS project — prevents cross-project restore**), then `initiateRestore(ref,{backup_id:uuid})` + `restoreQueue().add('restore',{restore_job_id})` (queue `selfbase.restore`), `reply.status(201).send()`; map `RestoreError`→HTTP (409 in-flight). Wire the sibling `/restore` (1941-1944) to the same path or note deferral.
- [X] T040 [US6] Add `GET /platform/projects/:ref/status` (NEW) in `platform-misc.ts` — org-scoped (model on `:ref` detail 378-397), `{ status: inst.status==='running' ? 'ACTIVE_HEALTHY' : inst.status.toUpperCase() }`.
- [X] T041 [P] [US6] Unit test `apps/api/tests/unit/platform-backups-restore.test.ts` — restore route 201 + enqueue (mock `initiateRestore`/queue); sad: unknown seq → 404, in-flight → 409; status route maps `restoring→RESTORING`, `running→ACTIVE_HEALTHY`.
- [ ] T042 [US6] LIVE VERIFY (quickstart §7): list real backups (numeric ids), restore → 201, `/platform/projects/:ref/status` `RESTORING`→`ACTIVE_HEALTHY`; `/v1` uuid backup contract unchanged; re-run the migration = no-op.

**Checkpoint**: the platform studio Backups page is functional end-to-end; the engine is reused, not retired.

---

## Phase 8: US4 — No regression (CLI, login, /api/v1 engine, migration) (Priority: P3)

**Goal**: external contracts + the retained engine unbroken; the new migration + gate don't regress anything.
**Independent test**: quickstart §4 — CLI/login/integration all pass.

- [ ] T043 [P] [US4] `/v1` contract no-drift: `pnpm --filter @supastack/api test` management-api + contract suites green (incl. the uuid backup contract unchanged; Constitution IV).
- [ ] T044 [P] [US4] CLI/MCP regression on the VM: `tests/cli-e2e/{db-push,migration-list,gen-types,mcp-roundtrip}.sh` pass against `api.<apex>/v1`.
- [ ] T045 [P] [US4] Login smoke: sign in to the studio → dashboard loads (token POST to `/auth/v1/token`).
- [ ] T046 [US4] Integration suite (live VM): `tests/integration/{provision-instance,backup,backup-retention}.test.ts` pass; confirm the US6 backup-`seq` migration applied cleanly at api boot (idempotent re-run).
- [ ] T047 [US4] End-to-end smokes: project create/restart delegate to `/api/v1/instances` (US1); the US6 restore actually runs (`RESTORING`→`ACTIVE_HEALTHY`); the US5 gate redirects pre-setup and releases post-setup.

**Checkpoint**: no regression confirmed.

---

## Phase 9: Polish & Cross-Cutting

- [ ] T048 [P] Finalize the runbook `docs/changes/086-platform-base-root-url.md` (deploy, rollback, the backup migration, the gate, verification results).
- [ ] T049 [P] File follow-up issues: (a) make the platform **audit** routes real (still a stub — backups are now done by US6); (b) rehome a browser e2e harness to target the platform studio; (c) remove the redundant `/api/v1` façade copies (`secrets-dashboard` + `/api/v1` `config/auth` mount) + migrate the `secrets-wire`/smoke tests; (d) rename the `selfbase.restore` BullMQ queue → `supastack.restore` (the rename missed it).
- [ ] T050 Update `CLAUDE.md` active-feature status to implemented/deployed and refresh the `project_legacy_studio_retire` memory with the outcome.

---

## Dependencies & Execution Order

- **US1 (P1)** code edits (T004-T008) are mutually parallel except T005/T006 (same Caddyfile). T010-T013 are the coordinated deploy + cleanup. **US1 + US5 both touch `caddy-config.ts`** (T007 `/v1*` rule, T030 gate catch-all) — sequence them or do in one edit pass.
- **US2/US3 [done]** are independent and already landed.
- **US5 (P2)** is independent (caddy-config.ts + setup.ts + Caddyfile); ships with the US1 deploy (shared Caddy reload).
- **US6 (P2)** is independent (migration + backups-mgmt-service.ts + platform-misc.ts). The migration (T035) runs at api boot — land it before/with the US1 deploy.
- **US4 (P3)** runs after the others (it verifies them, incl. US5/US6).
- **No `/api/v1` removal** (FR-010); façade-copy removal is the T049 follow-up.

## Parallel Example

- US5 + US6 are file-disjoint and can proceed in parallel: US5 (caddy-config/setup/Caddyfile) ∥ US6 (migration/backups-mgmt-service/platform-misc), then their unit tests (T033, T037, T041) [P].
- US1 edits together: T005/T008 (Caddyfile :80, compose), then T006/T007 sequenced with T030 (same caddy-config), then T004 (server.ts).

## Implementation Strategy (MVP first)

- **MVP = US1**: base=root cutover → clean URLs + shim removal (demoable independently).
- **Increment 2 (landed) = US2 + US3**: SPA slim + setup org dedup.
- **Increment 3 = US5 + US6**: the setup gate + real backups (file-disjoint, parallelizable; US6 carries the only migration). US5 ships with the US1 Caddy reload.
- **Increment 4 = US4**: regression sign-off across all of the above.
