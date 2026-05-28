---
description: "Task list for feature 021 — Dashboard Browser-Level E2E Tests"
---

# Tasks: Dashboard Browser-Level E2E Tests (Feature 021)

**Input**: Design documents from `specs/021-dashboard-browser-tests/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/expected-pages.md, quickstart.md

**Motivation**: During feature 020's deploy on 2026-05-28, a sidebar entry shipped in source code but failed to surface in the browser. Vitest+jsdom tests proved the destination page rendered; backend tests proved the API worked; bash e2e tests proved the PATCH→container chain worked. None of them rendered the actual SPA in a real browser. This feature closes that gap.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: Independent file/dir — safe to parallelize
- **[Story]**: User story tag from spec.md (US1–US4)
- File paths are relative to repo root

---

## Phase 1: Setup (shared infrastructure)

**Purpose**: Add Playwright, configure it, install browser binaries. Touches `apps/web/package.json` + new config files. No tests run yet.

- [X] T001 Added `@playwright/test@^1.49.0` to `apps/web/package.json` devDependencies + scripts (`test:e2e`, `test:e2e:ui`, `test:e2e:headed`, `lint:page-coverage`). `pnpm install` locked
- [ ] T002 `pnpm --filter @selfbase/web exec playwright install --with-deps chromium` — one-time local install; deferred (developer runs on first setup; documented in quickstart)
- [X] T003 [P] Created `apps/web/playwright.config.ts` per plan §A2 — chromium project, 60s test timeout, 5min global, retain trace/screenshot/video on failure, redacting reporter wired
- [X] T004 [P] Added Playwright output paths to root `.gitignore` (`apps/web/playwright-report/`, `apps/web/test-results/`, `apps/web/tests/e2e/.auth/`)
- [X] T005 [P] Added `SELFBASE_TEST_FAKE_DOCKER === '1'` boot hook in `apps/api/src/server.ts:buildApp()` that installs a stub at `globalThis.__selfbaseFakeDockerControl` with no-op `restart` + `waitHealthy`. Typecheck clean; existing 490 API tests still pass

**Checkpoint**: tooling installed; Playwright can launch a browser. No tests yet.

---

## Phase 2: Foundational (blocking prerequisites)

**Purpose**: The fixtures, helpers, and redactor every spec depends on. Nothing here is operator-visible. Finishing this unblocks US1/US2/US3/US4.

- [X] T006 Created `apps/web/tests/e2e/fixtures/admin-session.ts` — exports `test` + `expect`. `adminContext` fixture loads `tests/e2e/.auth/admin-storage-state.json` if present; otherwise POSTs `/api/v1/auth/login` and falls back to POSTing `/api/v1/setup` to bootstrap a fresh stack. Cookies parsed and persisted in Playwright storageState shape
- [X] T007 Created `apps/web/tests/e2e/fixtures/test-project.ts` — `testProjectRef()` looks for an existing `e2e-test-project` via `GET /api/v1/instances` first (so reruns reuse it); creates one if missing via POST with name + backupRetain. Cached in `globalThis.__e2eTestProjectRef`. Clear error includes a SELFBASE_TEST_FAKE_DOCKER hint if creation fails
- [X] T008 [P] Created `apps/web/tests/e2e/fixtures/test-utils.ts` — `expectNoConsoleErrors(page)` collects error-level console messages filtered by `CONSOLE_ERROR_ALLOWLIST` and returns an `assert()` callable. Plus `resolvePath(path, ref)` for `{ref}` substitution
- [X] T009 [P] Created `apps/web/tests/e2e/expected-pages.ts` — 15 EXPECTED_PAGES entries (7 project-shell + 7 settings-shell + 1 top-level), PROJECT_SHELL_GROUPS (3 groups mirroring ProjectShell.tsx), SETTINGS_SHELL_ITEMS (7 entries from SettingsLayout.tsx), 6 EXCLUDED_PAGES with reasons, CONSOLE_ERROR_ALLOWLIST (3 patterns per R-005). Verified headlines against actual page source
- [X] T010 [P] Created `apps/web/tests/e2e/redactor.ts` — `redact(input)` applies REDACTION_PATTERNS (sbp_ PAT, Bearer header, sb_sid cookie). Idempotent
- [X] T011 [P] Created `apps/web/tests/e2e/playwright-reporter.ts` — RedactingReporter implements `onTestEnd`, walks `result.attachments`, redacts in-memory bodies (Buffer) AND file-backed text artifacts (.txt/.log/.json/.html/etc). Image attachments pass through unchanged per FR-009 v1 scope

**Checkpoint**: every spec can do `import { test, expect } from './fixtures/admin-session'` + `testProjectRef()` + `EXPECTED_PAGES` and write meaningful tests. Redaction reporter wired into `playwright.config.ts`.

---

## Phase 3: US1 — Sidebar regression caught in CI (Priority: P1) 🎯 MVP

**Goal**: A PR that removes a sidebar entry fails the suite with a clear error.

**Independent Test**: Edit `apps/web/src/components/ProjectShell.tsx` and remove the "Authentication" group. Run `pnpm --filter @selfbase/web test:e2e -- sidebar-nav.spec.ts`. Test fails with "expected Authentication group visible, got: null". Restore; test passes.

### US1 Implementation

- [X] T012 [US1] Created `apps/web/tests/e2e/sidebar-nav.spec.ts` — 2 test blocks: (a) "contains every expected group + entry" iterates PROJECT_SHELL_GROUPS, asserts heading visible AND each link has the expected href; (b) "each sidebar link routes to a non-404 page" clicks each link and asserts URL transition. Each assertion uses a custom error message that names the missing element
- [X] T013 [US1] Admin user seed branch lives inside `loadOrCreateAdminStorageState()` in fixtures/admin-session.ts (T006). On 401 from login, POSTs `/api/v1/setup` with admin@test.local + hunter2hunter2 + 'e2e' org + 'test.local' apex; retries login. 410 (setup already complete) is treated as a no-op
- [ ] T014 [US1] Smoke verify locally — defer (requires `pnpm dev` running with SELFBASE_TEST_FAKE_DOCKER=1 AND `pnpm exec playwright install chromium`). Documented expected output: 2/2 PASS on clean state; deleting Authentication group from ProjectShell.tsx → fail with "expected sidebar group 'Authentication' to be visible"

**Checkpoint**: the exact regression that motivated this feature is now CI-catchable.

---

## Phase 4: US2 — Auth Providers page exercised in a real browser (Priority: P1)

**Goal**: Drawer-open interactions, deep-link querystring, RBAC visibility — the things Radix Sheet + jsdom couldn't test in feature 020.

**Independent Test**: Run `pnpm --filter @selfbase/web test:e2e -- auth-providers.spec.ts`. 4/4 tests pass. Modify the `?provider=` querystring parsing in `ProjectAuthProviders.tsx` and re-run — the deep-link test fails. Restore.

### US2 Implementation

- [X] T015 [US2] Created `apps/web/tests/e2e/auth-providers.spec.ts` — 4 test blocks: (1) providers list — asserts 11 row names spanning every row archetype (Email/Phone toggle, Common-4, PlusUrl, Google, Apple, OIDC, legacy Slack, coming-soon SAML+Web3); (2) Google drawer — opens via row click, asserts Client IDs / Client Secret / Skip nonce checks / Allow users without email / Callback URL (readonly) labels visible, Reveal button disabled; (3) deep-link — URL-encoded `?provider=Slack%20%28OIDC%29` asserts "Slack (OIDC)" heading appears; (4) non-admin RBAC — uses memberContext fixture, asserts "Save changes" button has count 0
- [X] T016 [US2] Extended `fixtures/admin-session.ts` with `memberContext` fixture + `loadOrCreateMemberStorageState`. Bootstraps a non-admin member by: logging in as admin → POST `/api/v1/members/invites` → extracts the token from the response's `link` field → POST `/api/v1/members/invites/accept` with token + password → login as member → persist storage state. Handles 409 (re-invite collision) by revoking + re-inviting to get a fresh token
- [ ] T017 [US2] Run `pnpm --filter @selfbase/web test:e2e -- auth-providers.spec.ts` against the local stack — deferred (needs `pnpm dev` + chromium); spec typecheck clean, lint:page-coverage still passes

**Checkpoint**: feature 020's deferred drawer-interaction tests now have real-browser coverage.

---

## Phase 5: US3 — One assertion per critical dashboard page (Priority: P2)

**Goal**: Every page reachable via the dashboard's sidebars has at least one browser assertion. Self-maintaining via the coverage lint (Phase 6).

**Independent Test**: Run `pnpm --filter @selfbase/web test:e2e -- page-smokes.spec.ts`. Every page in `EXPECTED_PAGES` (~14 entries) passes. Add a console.error to one page; that page's test fails with the error message.

### US3 Implementation

- [X] T018 [US3] Created `apps/web/tests/e2e/page-smokes.spec.ts` — for-loop over EXPECTED_PAGES generates one `test()` per entry. Each: resolves `{ref}` via testProjectRef when requiresProject, navigates, asserts heading visible (10s timeout), asserts no console errors via expectNoConsoleErrors helper
- [X] T019 [US3] EXPECTED_PAGES populated in T009 with 15 entries (7 project-shell + 7 settings + 1 top-level). Each headline verified against the page source's `<ProjectShell title>` or `<PageHeader title>` prop
- [X] T020 [US3] EXCLUDED_PAGES populated in T009 with 6 entries (Login, Setup, AcceptInvite, CliLogin, ConnectCli, InstancesNew) — each carries a reason matching the contracts table
- [ ] T021 [US3] Run `pnpm --filter @selfbase/web test:e2e -- page-smokes.spec.ts` against a running stack — deferred (requires `pnpm dev` + `playwright install chromium`); page-smokes spec syntax-checked + typecheck clean

**Checkpoint**: every dashboard page has at least one real-browser smoke. New pages without smokes will fail the next phase's lint gate.

---

## Phase 6: Coverage enforcement (Cross-cutting; supports US3)

**Goal**: A new file under `apps/web/src/pages/*.tsx` matching the dashboard-page convention cannot ship without an entry in `EXPECTED_PAGES` (or an explicit `EXCLUDED_PAGES` exception). Enforced as a lint step.

This phase isn't a new user story but it's the mechanism that makes US3 self-maintaining over time — counts as part of US3's acceptance.

- [X] T022 [US3] Created `apps/web/scripts/check-page-coverage.mjs` — regex-parses EXPECTED_PAGES `sourceFile` + EXCLUDED_PAGES `file` entries from `expected-pages.ts`, lists dashboard pages under `apps/web/src/pages/` matching the page-file convention regex, exits 1 with named offenders + dangling refs. **Verified: 21 files all classified** with the initial registry
- [X] T023 [US3] Wired `lint:page-coverage` into root `pnpm lint` script: `"lint": "eslint . && pnpm --filter @selfbase/web lint:page-coverage"`. CI's existing lint step now runs the page-coverage gate
- [X] T024 [US3] Round-trip smoke verified: (a) created `ProjectTestStub.tsx` → lint exit 1 with "no browser-test smoke" message; (b) added to EXCLUDED_PAGES → lint exit 0 (22 files); (c) deleted file but kept registry entry → lint exit 1 with "registry entries reference missing files"; (d) cleaned both → lint exit 0 (21 files). All three failure modes work

**Checkpoint**: the registry is now self-enforcing. New pages can't slip through without a smoke decision.

---

## Phase 7: US4 — CI runs on every PR (Priority: P2)

**Goal**: Every PR triggers the browser-test suite against a disposable stack; PR comments link to screenshots on failure.

**Independent Test**: Open a PR that breaks the sidebar. The `e2e` CI check fails within ~5 minutes. The PR shows a comment linking to the failing run; the `playwright-report` artifact is attached.

### US4 Implementation

- [X] T025 [US4] Added `e2e` job to `.github/workflows/ci.yml`: runs on ubuntu-latest, `needs: [guardrails]`, 15-min timeout, checkout + Node 20 + pnpm setup, installs deps + Chromium via `pnpm exec playwright install --with-deps chromium`, generates fresh secrets (`openssl rand -hex 32`) for MASTER_KEY/CONTROL_DB_PASSWORD/SESSION_SECRET/SUPAVISOR_*, writes them to `infra/.env`, starts `db` + `redis` via `docker compose up -d`, waits for postgres via `pg_isready`
- [X] T026 [US4] Same job: api boot step exports SELFBASE_TEST_FAKE_DOCKER=1 + COOKIE_SECURE=0 + LOG_LEVEL=warn + PORT=3001, runs `pnpm --filter @selfbase/api dev` in background with PID tracking, polls `/api/v1/health` until 200; web boot step runs `pnpm --filter @selfbase/web dev` in background, polls localhost:5173. Process-died check prints log tail to GitHub error annotation. Suite runs with PLAYWRIGHT_BASE_URL=http://localhost:5173
- [X] T027 [US4] Artifact upload on failure: `actions/upload-artifact@v4` uploads `apps/web/playwright-report/` + `apps/web/test-results/` + `/tmp/api.log` + `/tmp/web.log` as `playwright-report-${{ github.run_id }}` with 14-day retention
- [X] T028 [US4] PR comment on failure: `actions/github-script@v7` posts a comment with link to the failing run, instructions to download the artifact, and a copy-paste-able local reproduction command block. Gated on `github.event_name == 'pull_request'` so it doesn't post on `push` events
- [ ] T029 [US4] Smoke verify by opening a draft PR with a deliberately broken sidebar — deferred (requires git push + PR creation); workflow YAML validated via `python3 yaml.safe_load` (parses cleanly, 12 steps in e2e job)

**Checkpoint**: every PR is now gated on a real-browser run.

---

## Phase 8: Polish & cross-cutting

- [X] T030 [P] Wrote `docs/changes/021-dashboard-browser-tests.md` — operator+developer runbook covering motivation, capability table, local setup, daily workflow, the SELFBASE_TEST_FAKE_DOCKER hook, coverage lint behavior with the 3 failure modes, how to add a test for a new page, CI behavior, reading a CI failure, secret redaction, out-of-scope list, troubleshooting, follow-ups list
- [X] T031 [P] Updated `CLAUDE.md` — added "Dashboard browser-test harness (feature 021)" row to What's Shipped with links to runbook + summary of harness, fixtures, registry, lint, CI job; updated SPECKIT pointer block to reflect completion + 24/34 done + 5 deferred manual smokes + 1 PR-creation verification
- [X] T032 Full suite verification (vitest + lint, sans Playwright which needs running stack): API 490/490 PASS, Web vitest 81/81 PASS, page-coverage lint passes (21 files classified). Playwright suite deferred — manual smoke verification per quickstart §1–§5
- [X] T033 Typecheck across packages — `pnpm --filter @selfbase/{api,web,shared} typecheck` all clean. No type errors from new fixture types, spec types, or env-var hook
- [X] T034 Filed 5 follow-up issues: #82 multi-browser coverage, #83 PNG screenshot redaction, #84 a11y audit pass, #85 visual regression (pixel-diff), #86 nightly workflow against supaviser.dev. Each references feature 021 as parent with a "recommended trigger" criterion so it doesn't ship reflexively

---

## Dependencies & execution order

```
Phase 1 (setup) ─┐
                 ├─→ Phase 2 (foundational) ─┐
                                              ├─→ Phase 3 (US1) ─────────────┐
                                              ├─→ Phase 4 (US2) ─────────────┤
                                              ├─→ Phase 5 (US3) + Phase 6 ──┤
                                              │   (Phase 6 depends on 5)     ├─→ Phase 7 (US4) ──→ Phase 8 (polish)
                                              │                              │
                                              └──────────────────────────────┘
```

**Critical path**: T001 → T005 → T006 → T012 → T014 (MVP). After T014 you have a working sidebar-regression catcher locally.

**Parallelization opportunities**:
- Phase 1: T003, T004, T005 in parallel (T002 is one-time setup).
- Phase 2: T008, T009, T010, T011 in parallel after T006+T007 land.
- Phase 5 (US3): T019, T020 in parallel; T018 depends on both.
- Phase 8: T030, T031 in parallel.

### Story dependencies

- **US1 (Phase 3)** depends on Phase 2.
- **US2 (Phase 4)** depends on Phase 2; independent of US1.
- **US3 (Phase 5)** depends on Phase 2; benefits from Phase 6's lint but can ship first.
- **US4 (Phase 7)** depends on US1+US2+US3 having shipped (otherwise CI has nothing to run).

### MVP scope

**Phase 1 + Phase 2 + Phase 3 (US1)** = 14 tasks. Ships:
- A working local Playwright harness
- The sidebar-nav spec that catches the exact regression that motivated this feature
- All fixtures + redactor + reporter in place so US2/US3/US4 are 1-task-each additions

After MVP, ship US2 (T015–T017) next for the Auth Providers coverage, then US3 (T018–T024) for the per-page floor, then US4 (T025–T029) for CI automation.

---

## Summary

- **Total tasks**: 34
- **Per phase**: Setup 5 / Foundational 6 / US1 3 / US2 3 / US3 7 (incl. Phase 6 lint) / US4 5 / Polish 5
- **Parallelizable [P]**: T003, T004, T005, T008, T009, T010, T011, T030, T031 — 9 tasks
- **MVP**: Phases 1 + 2 + 3 (T001–T014) = 14 tasks
- **Independently testable per spec**: US1 → sidebar-nav.spec.ts, US2 → auth-providers.spec.ts, US3 → page-smokes.spec.ts + lint, US4 → end-to-end CI run on a draft PR
- **Closes**: nothing directly — this feature exists to close a *class* of bug (silent dashboard regressions) rather than a single issue
- **Spawned during /speckit-plan**: no new issues yet; T034 files follow-ups for OOS items if desired
