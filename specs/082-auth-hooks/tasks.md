---
description: "Task list for Auth Hooks (hook_*) — pg-functions:// Phase 1 (issue #64)"
---

# Tasks: Auth Hooks — pg-functions:// Phase 1

**Input**: Design documents from `/specs/082-auth-hooks/`

**Branch**: `082-auth-hooks`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, data-model.md ✓, contracts/ ✓

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3)

---

## Phase 1: Setup

**Purpose**: Verify starting state; no new project structure needed — this feature modifies existing files only.

- [X] T001 Read `apps/api/src/services/env-field-mapper.ts` lines 480-570 to confirm current `ADD_STORED('hook_', ...)` at line 491 and understand the `ALREADY_HONORED` / `newlyPromotedOauthEntries()` patterns used by `buildFieldStatus()`
- [X] T002 Read `apps/api/src/services/runtime-config-store.ts` lines 266-294 to understand the existing `crossFieldValidate()` structure before adding hook validation
- [X] T003 [P] Read `infra/supabase-template/docker-compose.yml` lines 455-480 to locate the commented-out `GOTRUE_HOOK_*` block and understand the `${VAR:-}` substitution pattern used by surrounding env vars

---

## Phase 2: Foundational (Blocking Prerequisite)

**Purpose**: Promote all 21 hook fields to `honored` in the env-field-mapper. This is the single change that gates all other phases — without it, the env vars never reach GoTrue and the cross-field validation never fires.

**⚠️ CRITICAL**: Phase 3 (validation) and Phase 4 (compose) depend on this phase being complete and tested.

- [X] T004 In `apps/api/src/services/env-field-mapper.ts`: remove the line `ADD_STORED('hook_', 'Auth hooks dispatcher — tracked in #64');` and replace with 21 explicit honored entries as specified in plan.md §A. Place the new block in the same region as the other `_HONORED` maps (near `MAILER_HONORED` or `SESSIONS_PW_ETC_HONORED`). Each `_secrets` field must carry `secret: true`. Also add the 21 new entries to the right map object fed to `buildFieldStatus()` — check that `ALREADY_HONORED` (or whichever object is used) is the correct target by following the pattern for `MAILER_HONORED`.
- [X] T005 In `apps/api/src/services/env-field-mapper.ts`: update the file-top comment that reads `honored: 169` to `honored: 190` (169 + 21 new hook fields).
- [X] T006 Write unit test `apps/api/tests/unit/env-field-mapper-hooks.test.ts`: import `AUTH_CONFIG_FIELD_STATUS` from `env-field-mapper.ts` and assert all 21 `hook_*` fields are classified `{ kind: 'honored' }`. Also assert the 7 `hook_*_secrets` fields have `secret: true`. Run `pnpm test --filter api` to confirm the new tests pass and no existing tests regress.

**Checkpoint**: `AUTH_CONFIG_FIELD_STATUS` now has 190 `honored` entries. All 21 hook fields write to env.

---

## Phase 3: User Story 2 — Reject HTTPS URIs (Priority: P2)

**Goal**: Validate URI scheme at PATCH time; reject non-`pg-functions://` with a clear 400 error.

**Independent Test**: `curl -X PATCH .../config/auth -d '{"hook_send_email_uri":"https://evil.com"}'` → `400 hook_uri_scheme_unsupported`. `curl` with a valid `pg-functions://` URI → `200`.

- [X] T007 [US2] In `apps/api/src/services/runtime-config-store.ts`, add hook URI validation inside `crossFieldValidate()` after the existing OAuth provider block (line ~292). Implement both guards from plan.md §B: (1) URI scheme check — rejects any `hook_*_uri` value that does not start with `pg-functions://`, with distinct message for HTTPS vs other schemes; (2) enabled-requires-URI check — rejects `hook_*_enabled = true` when the merged config has a null/empty URI. Use `ManagementApiError(400, ..., 'hook_uri_scheme_unsupported' | 'hook_uri_required', { field })`.
- [X] T008 [US2] Write unit test `apps/api/tests/unit/runtime-config-hook-validation.test.ts`. Import and call `crossFieldValidate` (or test via `patchConfig` with a mocked project). Cover: (a) valid `pg-functions://` → no throw; (b) `https://` URI → throws `hook_uri_scheme_unsupported`; (c) `http://` URI → throws `hook_uri_scheme_unsupported`; (d) `grpc://` URI → throws `hook_uri_scheme_unsupported`; (e) `enabled=true` + null URI → throws `hook_uri_required`; (f) `enabled=false` + null URI → no throw. Run `pnpm test --filter api` to confirm pass.

**Checkpoint**: Submitting an HTTPS URI to PATCH returns 400. Submitting a `pg-functions://` URI returns 200 (or 409 if project not running, which is expected).

---

## Phase 4: User Story 1 — Activate GoTrue Hook Dispatch (Priority: P1)

**Goal**: GoTrue receives `GOTRUE_HOOK_*` env vars and dispatches `pg-functions://` hooks at auth event time.

**Independent Test**: Enable `hook_custom_access_token` with a valid plpgsql function URI, sign in, inspect issued JWT for the custom claim.

- [X] T009 [US1] In `infra/supabase-template/docker-compose.yml`: replace the 21 commented-out `GOTRUE_HOOK_*` lines (the block at ~lines 459-475) with active `${VAR:-}` substitution lines as specified in plan.md §C. All 21 vars must be present; each uses the pattern `GOTRUE_HOOK_XXXX: "${GOTRUE_HOOK_XXXX:-}"`. Remove the comment markers (`#`) from each line.
- [X] T010 [US1] Update the contract test `apps/api/tests/contract/upstream-auth-config-snapshot.test.ts`: find the assertion that checks the `honored` field count (currently expects 169 or similar) and update it to 190. Run the test to confirm it passes.

**Checkpoint**: `docker-compose.yml` passes a valid `pg-functions://` URI through to GoTrue. GoTrue dispatches the hook on the next auth event.

---

## Phase 5: User Story 3 — Auth Hooks Dashboard Page (Priority: P3)

**Goal**: Operators can configure all 7 hook types from the dashboard without needing API calls.

**Independent Test**: Open `/dashboard/project/<ref>/auth/hooks`, enable one hook with a `pg-functions://` URI, click Save, see restart toast, reload — URI is persisted.

### Implementation for User Story 3

- [X] T011 [P] [US3] Create `apps/web/src/pages/auth-hooks/HookForm.tsx`: a single-hook form component accepting props `{ hookType, label, description, enabled, uri, secrets, isAdmin, onSave }`. Renders: a labelled section header, an `enabled` Switch/Toggle, a URI Input (placeholder `pg-functions://postgres/public/<func_name>`, disabled when not admin), a Secrets Input (`type="password"`, optional, placeholder `v1,whsec_...`, disabled when not admin), and a Save Button (disabled when not admin or when enabled=true and URI is empty). On save, calls `onSave({ hook_<type>_enabled, hook_<type>_uri, hook_<type>_secrets })`.
- [X] T012 [US3] Create `apps/web/src/pages/ProjectAuthHooks.tsx`: the page component. Use `useParams` for `ref`, `useAuth` for `isAdmin`, `useQuery(['auth-config', ref], () => authConfigApi.get(ref))` for current config, and `useRestartToast(ref)` from `apps/web/src/pages/auth-providers/use-restart-toast.ts` for the save flow. Render `ProjectShell` wrapper with 7 `HookForm` instances (one per hook type). Pass current config values and `save` from `useRestartToast` as `onSave`. Hook type list: `custom_access_token`, `mfa_verification_attempt`, `password_verification_attempt`, `send_sms`, `send_email`, `before_user_created`, `after_user_created`. Labels and descriptions should match upstream Supabase dashboard terminology.
- [X] T013 [US3] In `apps/web/src/App.tsx`: add the import `import { ProjectAuthHooksPage } from './pages/ProjectAuthHooks.js';` and a new `<Route path="/dashboard/project/:ref/auth/hooks" element={<AdminOnly><ProjectAuthHooksPage /></AdminOnly>} />` after the url-configuration route (around line 133).
- [X] T014 [US3] In `apps/web/src/components/ProjectShell.tsx`: add `{ label: 'Hooks', suffix: '/auth/hooks' }` to the Authentication sidebar nav group, after the URL Configuration entry. Verify it renders in the nav by checking the existing sidebar entries array for the auth group.
- [X] T015 [US3] In `apps/web/tests/e2e/expected-pages.ts`: add the hooks page entry to `EXPECTED_PAGES` array: `{ file: 'ProjectAuthHooks.tsx', path: '/dashboard/project/{ref}/auth/hooks', label: 'Auth Hooks' }`. Also add `{ label: 'Hooks', suffix: '/auth/hooks' }` to the sidebar nav entries array. Run `pnpm lint` (which executes `check-page-coverage.mjs`) to confirm no coverage failure.
- [X] T016 [US3] Create Playwright spec `apps/web/tests/e2e/auth-hooks.spec.ts`: (a) admin session — navigate to `/auth/hooks`, assert 7 hook sections are visible, assert URI input and toggle are enabled; (b) member session — navigate to `/auth/hooks`, assert all inputs are disabled (read-only RBAC); (c) smoke test — navigate from sidebar "Hooks" link, assert page loads without error. Use existing fixtures from `apps/web/tests/e2e/fixtures/` (admin-session, member-session, test-project).

**Checkpoint**: Auth Hooks page renders in the browser, hook forms accept input, Save triggers restart toast, hook values persist across page reload.

---

## Phase 6: Polish & Cross-Cutting Concerns

- [X] T017 [P] Run `pnpm lint` from repo root; fix any TypeScript or lint errors introduced by the new files and env-field-mapper changes.
- [X] T018 [P] Run `pnpm test --filter api` and `pnpm test --filter web` to confirm all new and existing tests pass.
- [X] T019 Run `pnpm run build --filter web` to confirm the new React page compiles without errors.
- [X] T020 Verify `quickstart.md` — manually trace through the steps: confirm the 21 env var names in plan.md §C match what's in `docker-compose.yml` after T009, and that `crossFieldValidate()` covers all 7 hook types added in T007.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — read-only, can start immediately
- **Phase 2 (Foundational)**: Depends on Phase 1 reads — BLOCKS Phases 3 and 4
- **Phase 3 (US2 — Validation)**: Depends on Phase 2 (env-field-mapper change must precede validation since validation fires on honored fields)
- **Phase 4 (US1 — Compose)**: Depends on Phase 2; can run in parallel with Phase 3
- **Phase 5 (US3 — Dashboard)**: Depends on Phase 2; can run in parallel with Phases 3/4
- **Phase 6 (Polish)**: Depends on all implementation phases complete

### User Story Dependencies

- **US1** (GoTrue dispatch, Phase 4): Depends on Phase 2 (honored fields) + compose activation
- **US2** (validation, Phase 3): Depends on Phase 2 (honored fields); compose not required
- **US3** (dashboard, Phase 5): Depends on Phase 2 (fields honored so PATCH actually writes env); Phases 3/4 should also be done before testing end-to-end

### Within Each Phase

- T004 → T005 → T006 (sequential within Phase 2)
- T007 → T008 (T008 tests T007)
- T011 and T012 can be split (T012 depends on T011 for `HookForm`)
- T013 → T014 → T015 → T016 (sequential within Phase 5 dashboard work)

### Parallel Opportunities

- T003 (compose read) can run in parallel with T001 + T002
- T007 (validation) and T009 (compose) can run in parallel after Phase 2
- T011 (HookForm component) can be built in parallel with T007 + T009

---

## Parallel Example: Phase 2 (Foundational)

```bash
# These are sequential — each builds on the previous:
Task T004: "Replace ADD_STORED('hook_') with 21 honored entries in env-field-mapper.ts"
Task T005: "Update honored count comment 169→190 in env-field-mapper.ts"
Task T006: "Write unit test for all 21 hook_* fields classified honored"
```

## Parallel Example: After Phase 2

```bash
# These can run in parallel:
Task T007: "Add hook URI validation to crossFieldValidate() in runtime-config-store.ts"
Task T009: "Activate GOTRUE_HOOK_* env vars in docker-compose.yml"
Task T011: "Create HookForm.tsx component"
```

---

## Implementation Strategy

### MVP First (US1 — GoTrue Dispatch Works)

1. Complete Phase 1: Setup (reads)
2. Complete Phase 2: Foundational (env-field-mapper change + unit test)
3. Complete Phase 4: US1 (docker-compose activation + contract test count update)
4. **STOP and VALIDATE**: On a live project, set `hook_custom_access_token_uri` via API, trigger sign-in, verify JWT has custom claim
5. Then add Phase 3 (US2 validation) + Phase 5 (US3 dashboard)

### Incremental Delivery

1. Phase 2 → fields are honored, env write path works → backend ready
2. Phase 3 → HTTPS rejection guard in place → safe to expose in dashboard
3. Phase 4 → compose activated → GoTrue actually dispatches
4. Phase 5 → dashboard UI → operator can configure without API calls
5. Phase 6 → polish → ship

---

## Notes

- [P] tasks = different files, no dependencies on each other
- [Story] label maps task to specific user story for traceability
- No database migrations in this feature
- No new npm packages required
- `pnpm lint` must pass before merging (check-page-coverage.mjs will fail if `EXPECTED_PAGES` isn't updated in T015)
- The 21 env var lines in T009 must use `${VAR:-}` (empty default) — hardcoded values from the existing commented examples must NOT be used
