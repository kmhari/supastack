# Tasks: Auth Config (GoTrue settings per project) — Studio parity

**Feature**: `085-auth-config-studio-bridge` | **Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md)

**Tests**: included (spec defines acceptance scenarios; project convention = happy + sad coverage).

## Format: `[ID] [P?] [Story] Description`

- **[P]** = parallelizable (different file, no incomplete dependency).
- **[USn]** = user-story phase task.
- All four bridge handlers live in the SAME file (`apps/api/src/routes/platform-misc.ts`), so the route edits (T009, T012, T015, T019, T020) are **sequential**; their tests (separate files) are **[P]**.

## Path Conventions

- API service: `apps/api/src/`
- Unit tests: `apps/api/tests/unit/`
- Live E2E: `tests/cli-e2e/`
- Coverage doc: `scripts/studio-mock-api/API-FULL-COMPARISON.md`

---

## Phase 1: Setup (Shared Infrastructure)

- [X] T001 Confirm `apps/api/src/services/env-field-mapper.ts` exports a usable set of valid lowercase auth-config field keys (the FIELD_MAP keys + the `hook_*` keys); if not directly exportable, add a named export `AUTH_CONFIG_FIELD_KEYS: ReadonlySet<string>` derived from the existing map — this is the source of truth the translation validates against.

---

## Phase 2: Foundational (Blocking Prerequisites)

**⚠️ BLOCKS all user stories** — the pure case-translation module is used by US1 (PATCH), US2 (GET), US3 (error details) and US4 (hooks).

- [X] T002 Capture the full Studio auth-config field-name set into a fixture `apps/api/tests/unit/fixtures/studio-auth-config-keys.json` (from the deployed Studio's GoTrueConfig payload / `tbnqljlgozpxzhkjxats`), and assert every `key.toLowerCase()` is in `AUTH_CONFIG_FIELD_KEYS`; record any divergence as an alias entry. Resolves research R1 (clean case-flip) and R4 (whether Studio's hooks page posts to `/config/hooks` or routes hook fields through `/config/auth`).
- [X] T003 Implement the pure module `apps/api/src/services/auth-config-case.ts`: `toApiKeys(body)` (UPPERCASE→lowercase or alias; unknown keys pass through unchanged), `toStudioKeys(obj)` (lowercase→UPPERCASE or reverse-alias; **exclude** meta keys `_supastack` from translation), `ALIASES` table (from T002), backed by `AUTH_CONFIG_FIELD_KEYS`. No I/O — pure functions.
- [X] T004 [P] Unit tests `apps/api/tests/unit/auth-config-case.test.ts`: happy (round-trip `toStudioKeys(toApiKeys(x))` key-equal for known fields; provider + non-OAuth fields), sad/edge (alias field flips correctly; `_supastack` object passes through untouched both directions; partial payload emits only its keys; unknown key passes through unchanged so the strict schema can reject it).

**Checkpoint**: translation module exists + green → user stories can begin.

---

## Phase 3: User Story 1 - Configure an OAuth provider / auth setting from the dashboard (Priority: P1) 🎯 MVP

**Goal**: A Studio-shaped (UPPERCASE) `PATCH /platform/auth/:ref/config` is accepted and applied — the reported "internal error" is gone.

**Independent test**: Send the exact failing payload (`EXTERNAL_GITHUB_ENABLED` + creds) → 200; provider becomes active after reload.

### Tests for User Story 1

- [X] T005 [P] [US1] Bridge unit test `apps/api/tests/unit/auth-config-bridge.test.ts` (PATCH cases): Studio uppercase PATCH (GitHub enable) → 200; a non-OAuth uppercase field (e.g. `SITE_URL`) → 200; partial payload changes only its keys. Mock the `/v1` re-inject to assert it receives **lowercase** keys.
- [X] T006 [P] [US1] No-regression check in `apps/api/tests/unit/auth-config-response-shape.test.ts` (extend): the `/v1` `UpdateAuthConfigBodySchema` + lowercase request/response shape are unchanged; an uppercase key sent directly to `/v1` still 400s (intended).

### Implementation for User Story 1

- [X] T007 [US1] In `apps/api/src/routes/platform-misc.ts` PATCH `/platform/auth/:ref/config`: apply `toApiKeys(req.body)` before the in-process re-inject to `/api/v1/projects/:ref/config/auth` (or `/v1/...` per US3). Preserve partial-update semantics; do not touch the `/v1` handler.

**Checkpoint**: dashboard provider/setting saves succeed (SC-001, SC-002 partial). MVP write-path works.

---

## Phase 4: User Story 2 - See current auth settings accurately (Priority: P1)

**Goal**: `GET /platform/auth/:ref/config` returns UPPERCASE keys so the dashboard displays current settings; round-trips with US1.

**Independent test**: After enabling GitHub + Site URL, the GET shows `EXTERNAL_GITHUB_ENABLED` truthy and `SITE_URL` set.

### Tests for User Story 2

- [X] T008 [P] [US2] Bridge unit test (GET cases) in `apps/api/tests/unit/auth-config-bridge.test.ts`: GET returns UPPERCASE config keys; the `_supastack` meta object is present + NOT upper-cased; a value written via the US1 PATCH path is returned by GET (round-trip).

### Implementation for User Story 2

- [X] T009 [US2] In `apps/api/src/routes/platform-misc.ts` GET `/platform/auth/:ref/config`: apply `toStudioKeys(resp.body)` to the response before returning; preserve status code and secret-masking from the underlying response. (Sequential after T007 — same file.)

**Checkpoint**: read + write parity (SC-003). Dashboard auth pages are usable end-to-end (MVP complete).

---

## Phase 5: User Story 3 - Clear, actionable error feedback (Priority: P2)

**Goal**: invalid input → 400 with the offending field named (uppercase), not a masked 500 "internal error".

**Independent test**: PATCH an unknown field → 400 + `details` naming it; project-not-running → 409.

### Tests for User Story 3

- [X] T010 [P] [US3] Bridge unit test (error cases) in `apps/api/tests/unit/auth-config-bridge.test.ts`: unknown field PATCH → 400 with the field named in the **uppercase** key space (not `{code:'internal'}` 500); a paused/not-running project → 409 `project_not_running`.

### Implementation for User Story 3

- [X] T011 [US3] Fix the error masking (research R5): route the bridge re-inject through the `/v1/projects/:ref/config/auth` surface (which carries the `ManagementApiError` envelope → 400 + `details`) **or** teach the platform error handler (`apps/api/src/server.ts:190`) to honor `ManagementApiError`'s `statusCode` + `details`. Choose the route-via-`/v1` option if it keeps `app.inject` simplest.
- [X] T012 [US3] In `apps/api/src/routes/platform-misc.ts` PATCH handler: when the underlying response is a validation 400, translate the `details` keys back to the Studio (uppercase) key space via `toStudioKeys` before returning, so the dashboard highlights the right field. (Sequential — same file.)

**Checkpoint**: validation failures are diagnosable (SC-006).

---

## Phase 6: User Story 4 - Manage auth hooks from the dashboard (Priority: P3)

**Goal**: `GET/PATCH /platform/auth/:ref/config/hooks` work (they don't exist today), backed by the `hook_*` auth-config subset.

**Independent test**: GET loads (all hooks disabled on a fresh project); PATCH enable a hook with a valid `pg-functions://` URI → 200 → present on reload.

### Tests for User Story 4

- [X] T013 [P] [US4] Unit tests `apps/api/tests/unit/auth-config-hooks.test.ts`: GET returns the 7 hook flags UPPERCASE and loads with all disabled (no error); PATCH enable with valid `pg-functions://` URI → 200 + round-trip; happy (valid) and sad (enabled-without-URI → 400; non-`pg-functions://` scheme → 400, reusing feature 082 validation).

### Implementation for User Story 4

- [X] T014 [US4] In `apps/api/src/routes/platform-misc.ts`: add GET `/platform/auth/:ref/config/hooks` — read the project's current config, project the `hook_*` subset, `toStudioKeys`, return. (Sequential — same file.)
- [X] T015 [US4] In `apps/api/src/routes/platform-misc.ts`: add PATCH `/platform/auth/:ref/config/hooks` — `toApiKeys`, route through `patchConfig('auth', …)` (same store as `/config/auth`), reuse feature 082 `pg-functions://` cross-field validation; secrets via the existing encrypted path. (Sequential — same file.)
- [X] T016 [US4] In `packages/shared/src/rbac.ts` + the hooks routes: confirm/declare `auth_config.read` (GET) and `auth_config.write` (PATCH) authorize the new endpoints; no new matrix cell unless a distinct action is preferred.

**Checkpoint**: all four Auth Config rows functional (SC-007).

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T017 [P] Flip the four "Auth Config (GoTrue settings per project)" rows ⚠️→✅ (`supastack`) in `scripts/studio-mock-api/API-FULL-COMPARISON.md`, update the section note, and recompute the coverage summary counts (FR-012 / SC-008).
- [X] T018 [P] Add `tests/cli-e2e/auth-config-studio.sh` implementing quickstart §1–6 (uppercase PATCH→200, GET uppercase round-trip, provider-in-effect after reload, invalid→400, hooks round-trip, `/v1` no-regression) — the live behavioral guard.
- [X] T019 Run `pnpm exec vitest run apps/api/tests/unit/auth-config-*.test.ts` + repo typecheck; ensure the full pre-existing `/v1` auth-config suite passes with zero diffs (SC-005).
- [X] T020 Deploy to `supaviser.dev` (rsync `apps/api` + rebuild api) and run `tests/cli-e2e/auth-config-studio.sh` against `tbnqljlgozpxzhkjxats`; record results in `docs/changes/085-auth-config-studio-bridge.md`.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (T001)** → **Foundational (T002–T004)** → all user stories.
- **US1 (P1)** and **US2 (P1)** both depend only on Foundational, but their *implementation* tasks edit the same file (`platform-misc.ts`), so T007 → T009 are sequential; their test tasks (T005/T006/T008) are [P].
- **US3 (P2)** builds on the US1 PATCH path (T007) — do after US1.
- **US4 (P3)** depends on Foundational; its route edits are sequential with the other `platform-misc.ts` edits.
- **Polish (T017–T020)** after all desired stories.

### MVP scope

**US1 + US2** (both P1) = read/write parity = the dashboard auth pages work. That is the MVP. US3 (error UX) and US4 (hooks) are incremental.

### Parallel opportunities

- **Foundational**: T004 (tests) parallels nothing critical but runs alongside doc reading.
- **Tests across stories**: T005, T006, T008, T010, T013 are all separate test files → [P] once the module (T003) exists.
- **Polish**: T017 (doc) and T018 (e2e script) are [P].

## Implementation Strategy

1. **Setup + Foundational** (T001–T004): the pure translation module is the keystone — get it + its tests green first.
2. **MVP** (T005–T009): wire PATCH then GET into the bridge → demo: enable GitHub from the dashboard, reload, see it stick.
3. **US3** (T010–T012): make errors legible.
4. **US4** (T013–T016): hooks endpoints.
5. **Polish** (T017–T020): doc flip, live e2e guard, VM verification, runbook.

## Notes

- **Constitution IV is the guardrail**: never edit `management/auth-config.ts`, `runtime-config-store.ts` validation, or `UpdateAuthConfigBodySchema`. All change is at the platform edge + the new module. T006/T019 enforce this.
- **Zero Studio / `apps/web` source changes** — Studio is upstream; the platform adapts to its shape.
- The `_supastack` meta-key exclusion (T003) is load-bearing — mangling it breaks feature 020's existing contract test.
