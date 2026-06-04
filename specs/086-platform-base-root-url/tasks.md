---
description: "Task list — feature 086 platform base=root + legacy studio reduced to /setup"
---

# Tasks: Platform Studio base=root API URL + legacy studio reduced to /setup

**Input**: Design documents from `specs/086-platform-base-root-url/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/{routing,setup-org,studio-build}.md, quickstart.md

**Tests**: INCLUDED — the spec's US4 is a regression-guard story, the plan calls for an `org-store` unit test + trimming `api.test.ts`, and the operator preference is happy+sad path coverage.

**Organization**: by user story (US1 P1, US2 P2, US3 P2, US4 P3). `/api/v1` is the RETAINED internal engine — not deleted (removal of the redundant façade copies is DEFERRED per FR-010).

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

**Purpose**: none. The three user stories are independent; US1 is the only one requiring a coordinated deploy. No shared blocking work.

- [ ] T003 (no-op gate) Confirm through all phases: no DB migration is introduced (Constitution I); the `/v1` OpenAPI snapshot is untouched (Constitution IV); and **no `/api/v1` route is removed** (FR-010 — the redundant façade copies stay; their removal is a deferred follow-up, T035).

---

## Phase 3: US1 — Platform studio clean Cloud-parity URLs (Priority: P1)

**Goal**: studio calls resolve at `/platform/*` + `/v1/*` (no `/api/v1/v1/*`).
**Independent test**: quickstart §1 — network panel shows 0 `…/api/v1/v1/…` requests; `/v1/*` + `/platform/*` at apex return 200.

- [ ] T004 [US1] In `apps/api/src/server.ts`, add a root mount `await app.register(platformMiscRoutes);` immediately after the existing root `platformProxyRoutes` (~line 225). Keep the `/api/v1`-prefixed mounts (228-229) for now.
- [ ] T005 [P] [US1] In `apps/caddy/Caddyfile`, add `handle /v1* { reverse_proxy api:3001 }` to the `:80` block, ordered after `/api/*` and before the studio catch-all.
- [ ] T006 [US1] In `apps/caddy/Caddyfile`, add the same `handle /v1* { reverse_proxy api:3001 }` to the `:443`/apex block (same ordering). (same file as T005 → sequential)
- [ ] T007 [P] [US1] In `apps/api/src/services/caddy-config.ts`, add a `/v1*` → `api:3001` subroute to `dashboardSubroutes`, mirroring the existing `/api/v1*` entry, ordered before the studio catch-all (this is the VM source of truth).
- [ ] T008 [P] [US1] In `infra/docker-compose.yml`, change the studio `NEXT_PUBLIC_API_URL` from `https://${SUPASTACK_APEX}/api/v1` to `https://${SUPASTACK_APEX}`. Do NOT touch `NEXT_PUBLIC_GOTRUE_URL`.
- [ ] T009 [US1] Write the coordinated-deploy + rollback procedure into `docs/changes/086-platform-base-root-url.md` per `contracts/studio-build.md` (build api → reload Caddy → `rm -rf .next` + `--force-recreate studio`).
- [ ] T010 [US1] DEPLOY (operator-run on the VM): rsync; `docker compose build api && up -d api`; wipe studio `.next`; `--force-recreate studio`.
- [ ] T011 [US1] LIVE VERIFY (quickstart §1): in the studio network panel 0 requests to `…/api/v1/v1/…`; curl `https://<apex>/v1/projects/<ref>/api-keys` → 200, `https://<apex>/platform/profile` → 200.
- [ ] T012 [US1] After the rebuilt studio is confirmed live: remove the `/api/v1/v1/*` shim (`apps/api/src/server.ts:323-335`) and the `/api/v1`-prefixed `platformProxyRoutes`/`platformMiscRoutes` mounts (228-229).
- [ ] T013 [US1] Guard: `grep -rn "/api/v1/v1" apps/api/src` returns no matches (quickstart §5); re-verify the studio still renders project pages.

**Checkpoint**: studio fully on clean URLs; shim gone.

---

## Phase 4: US2 — Legacy SPA reduced to the /setup wizard (Priority: P2)

**Goal**: `apps/web` serves only `/setup`; non-setup pages + their client methods removed.
**Independent test**: quickstart §2 — `/setup` loads (HTTP + HTTPS); `vite build` green; former routes redirect to `/setup`.

- [ ] T014 [US2] In `apps/web/src/App.tsx`, trim `<Routes>` to `<Route path="/setup" element={<Setup/>} />` + catch-all `<Route path="*" element={<Navigate to="/setup" replace/>} />`; remove `RequireAuth`/`SetupGate`/`LegacyProjectRedirect` usage (keep `AuthProvider` — Setup uses `useAuth().refresh`).
- [ ] T015 [P] [US2] Delete all non-setup pages: every `apps/web/src/pages/*.tsx` except `Setup.tsx`, plus the dirs `pages/auth-providers/`, `pages/auth-url-config/`, `pages/auth-hooks/`.
- [ ] T016 [P] [US2] Delete page-only components (`apps/web/src/components/{ProjectShell,SettingsLayout,Shell,SetupGate,RequireAuth,CardRow,CliCommandBlock,InputWithCopy,PageHeader,RevealDialog,StatusPill,WildcardCertCard}.tsx` and page-only `ui/*` primitives) and unused libs `apps/web/src/lib/{safe-next,health-poll,use-reveal-credentials}.ts`. Keep `CopyButton.tsx` + `ui/{button,input,label,alert}.tsx`.
- [ ] T017 [US2] In `apps/web/src/lib/api.ts`, keep only `setupApi`, `apexApi`, `wildcardCertApi`, `orgApi.patch`, `authApi.me` (+ backing types `ApexCert/ApexStatus/ChallengeRecord/DnsCheck/WildcardCert*`); delete all other method groups (`instancesApi/membersApi/authConfigApi/backupsApi/auditApi/cliApi/secretsApi/vaultApi/cliLoginApi/poolerApi/oauthApi` + non-kept `authApi`/`orgApi` methods).
- [ ] T018 [P] [US2] Trim `apps/web/tests/unit/api.test.ts` to assertions for the kept methods only (happy: correct URL/method/body; sad: a removed-group assertion deleted). Keep `setupApi`, `authApi.me`, `apexApi`, `orgApi.patch`, `wildcardCertApi.{initiate,verify,status}`.
- [ ] T019 [P] [US2] Delete the page-bound unit tests under `apps/web/tests/unit/`: `Instances.test.tsx`, `Login.test.tsx`, `MorePages.test.tsx`, `ProjectAuthProviders.test.tsx`, `ProjectAuthUrlConfig.test.tsx`, `ProjectSecrets.test.tsx`, `provider-registry.test.ts`, `redirect-url-helpers.test.ts` (+ `safe-next.test.ts` if `safe-next.ts` is removed).
- [ ] T020 [US2] Remove the Playwright e2e harness `apps/web/tests/e2e/**`, reset/remove `apps/web/tests/e2e/expected-pages.ts` + `apps/web/scripts/check-page-coverage.mjs` (and its `lint:page-coverage` wiring in `apps/web/package.json`), and drop/adjust the `e2e` job in `.github/workflows/ci.yml`. (Rehoming to target Studio is a filed follow-up, not this task.)
- [ ] T021 [US2] Verify build: `pnpm --filter @supastack/web build` succeeds (no dangling imports) and `pnpm --filter @supastack/web test` + `pnpm --filter @supastack/web lint` are green.
- [ ] T022 [US2] LIVE VERIFY `/setup` (FR-007 / SC-003): after the slimmed SPA is served, confirm `https://<apex>/setup` loads + completes over HTTPS, AND `http://<server-ip>/setup` loads over plain HTTP (pre-DNS, before TLS) with `GET /api/v1/setup/status` responding; confirm any former route (e.g. `/dashboard`, `/settings/org`) redirects to `/setup`.

**Checkpoint**: apps/web is setup-only; builds + tests green; `/setup` verified live over HTTP + HTTPS.

---

## Phase 5: US3 — Setup reuses the platform org primitive (Priority: P2)

**Goal**: one shared org-creation implementation; first user via GoTrue.
**Independent test**: quickstart §3 — fresh setup → operator is a GoTrue `auth.users` row, org owned + visible via `/platform/organizations`; `createOrganizationWithOwner` unit test passes.

- [X] T023 [US3] Create `apps/api/src/services/org-store.ts` exporting `createOrganizationWithOwner(tx, { userId, name })` — `generateRef()` → insert `organizations{id,name}` → insert `organization_members{organizationId:id,userId,role:'owner'}` → return `{id,name}`. Reuse the `Inserter` type from `services/api-tokens.ts`. (per `contracts/setup-org.md`)
- [X] T024 [P] [US3] Add `apps/api/tests/unit/org-store.test.ts` — happy: inserts exactly one org + one `owner` membership, returns `{id,name}`, id matches ref format (mock `db`/`tx`). Sad: name handling is the caller's contract (assert the primitive forwards `name` verbatim; empty-name rejection is asserted at the route in T025).
- [X] T025 [US3] Wire `POST /platform/organizations` (`apps/api/src/routes/platform-misc.ts:284-297`) to call `createOrganizationWithOwner` inside `db().transaction`; keep `requireAuth`, the empty-name 400, and the `buildOrg(...)` + `pending_payment_intent_secret` response shape unchanged. (T002 already settled the stray change in this file.)
- [X] T026 [US3] Wire `apps/api/src/routes/setup.ts`: inside the existing transaction, after the in-tx `setup_state` re-check, replace the pre-tx `generateRef()` (line 48) + inline org/member inserts (67-77) with `const { id: orgId } = await createOrganizationWithOwner(tx, { userId: operator.id, name: body.orgName })`. Keep installation insert, `setup_state`, audit (`targetId: orgId`), `mintApiToken`, and the ownerless-org backfill.
- [X] T027 [US3] Verify first-user creation is GoTrue-only: confirm `setup.ts` uses `ensureGotrueUser` as the sole identity path and writes no local `public.users` row (note `schema.users` = `auth.users`); add an assertion/comment.
- [X] T028 [US3] Run `pnpm --filter @supastack/api test` (org-store unit + existing org/setup tests green); on a clean control plane, run a fresh setup and confirm quickstart §3 (operator in `auth.users`, org owned, listed by `/platform/organizations`; setup re-POST → 410, atomic rollback on forced failure).

**Checkpoint**: org creation has a single implementation; setup atomic + GoTrue-only user.

---

## Phase 6: US4 — No regression (CLI, login, /api/v1 engine) (Priority: P3)

**Goal**: external contracts + the retained engine unbroken.
**Independent test**: quickstart §4 — CLI/login/integration all pass.

- [ ] T029 [P] [US4] `/v1` contract no-drift: run `pnpm --filter @supastack/api test` management-api + contract suites green (Constitution IV; no OpenAPI snapshot change).
- [ ] T030 [P] [US4] CLI/MCP regression on the VM: `tests/cli-e2e/{db-push,migration-list,gen-types,mcp-roundtrip}.sh` pass against `api.<apex>/v1`.
- [ ] T031 [P] [US4] Login smoke: sign in to the studio → dashboard loads (token POST to `/auth/v1/token`; confirm not derived from the changed base).
- [ ] T032 [US4] Integration suite (live VM): `tests/integration/{provision-instance,backup,backup-retention}.test.ts` pass — confirms the `/api/v1` engine (instances + backups) is retained.
- [ ] T033 [US4] Engine-delegation smoke: in the studio, create a project (delegates `/platform/projects` → `/api/v1/instances` → worker) and trigger a restart (→ `/api/v1/instances/:ref/restart`); both succeed.

**Checkpoint**: no regression confirmed.

---

## Phase 7: Polish & Cross-Cutting

- [ ] T034 [P] Finalize the runbook `docs/changes/086-platform-base-root-url.md` (deploy, rollback, verification results).
- [ ] T035 [P] File follow-up issues: (a) make platform backup/restore + audit routes real (they're stubs — Studio backups page shows nothing, restore no-ops); (b) rehome a browser e2e harness to target the platform studio (replacing the removed apps/web Playwright suite); (c) remove the redundant `/api/v1` façade copies (`secrets-dashboard` + `/api/v1` `config/auth` mount) + migrate the `secrets-wire`/smoke tests that still hit `/api/v1/projects/:ref/secrets` (deferred per FR-010).
- [ ] T036 Update `CLAUDE.md` active-feature status to implemented/deployed and refresh the `project_legacy_studio_retire` memory with the outcome.

---

## Dependencies & Execution Order

- **US1 (P1)** code edits (T004-T008) are mutually parallel except T005/T006 (same Caddyfile). T010-T013 are the coordinated deploy + cleanup, sequential, and gated on the studio rebuild.
- **US2 (P2)** and **US3 (P2)** are independent of US1 and of each other (different files: `apps/web/*` vs `apps/api/{services/org-store,routes/setup,routes/platform-misc}`). T025 touches `platform-misc.ts` — T002 already settled the stray change there.
- **US4 (P3)** runs after the others are in place (it verifies them).
- **No `/api/v1` removal** in any phase (FR-010); the redundant-copy removal is filed as a follow-up in T035.

## Parallel Example

- US1 edits together: T005/T007/T008 in one batch (Caddyfile :80, caddy-config.ts, compose — distinct files), then T006 (Caddyfile :443), then T004 (server.ts).
- US2 deletes together: T015/T016/T018/T019 (distinct files).

## Implementation Strategy (MVP first)

- **MVP = US1**: the base=root cutover alone delivers the clean URLs + shim removal. Demoable independently (0 `/v1/v1` requests).
- **Increment 2 = US2 + US3**: SPA slim + setup org dedup (no deploy coupling; can land before or after US1).
- **Increment 3 = US4**: regression sign-off.
