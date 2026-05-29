---
description: "Task list — feature 023: CI-enforced home for integration/infra-contract tests"
---

# Tasks: A CI-Enforced Home for Integration & Infra-Contract Tests

**Input**: Design documents from `/specs/023-integration-test-home/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/test-collection-guard.md, quickstart.md

**Tests**: This feature *is* test infrastructure. The "verify" tasks below are acceptance checks mapped to the spec's Success Criteria (not TDD-first); no separate unit-test tasks are generated.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no incomplete dependency)
- **[Story]**: US1 / US2 / US3 (setup, foundational, polish have no story label)

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: the node-env vitest config that becomes the home.

- [x] T001 [P] Create `tests/vitest.config.ts` — a vitest project with `environment: 'node'`, `include: ['**/*.{test,spec}.ts']`, `exclude: ['**/node_modules/**', '**/dist/**']`, rooted at `tests/` (mirror the shape of `apps/web/vitest.config.ts`, but node env, not jsdom).

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: wire the home into the workspace so `pnpm test` collects it. **Blocks US1 and US2.**

- [x] T002 Register the new project in `vitest.workspace.ts` — add `'./tests/vitest.config.ts'` to the `defineWorkspace([...])` array, keeping `'packages/*'` and `'apps/*'`.

**Checkpoint**: `pnpm test` now loads a `tests` project — user stories can proceed.

---

## Phase 3: User Story 1 — A non-package test runs in CI, node env, discoverable (P1)

**Goal**: a test placed in `tests/` is collected + executed by `pnpm test`, in node env, with no `// @vitest-environment` override; contributors can find where tests go.

**Independent test**: add a trivial test under `tests/`, confirm `pnpm test` runs it; flip it to fail → CI red.

- [x] T003 [US1] Verify the home in `tests/_home-check.test.ts` — temporarily add a node-env test that reads a repo file via `node:fs` + `fileURLToPath(import.meta.url)`; run `pnpm test` and confirm it executes with NO env-override comment; flip an assertion to fail and confirm the run goes red; then delete `tests/_home-check.test.ts`. (FR-002, FR-003)
- [x] T004 [P] [US1] Create `tests/README.md` — document the "which test goes where" convention (unit → package; integration/cross-cutting/infra-contract → `tests/` or `tests/integration/`; behavioral container `.sh` → `tests/cli-e2e/` manual-only; browser → `apps/web/tests/e2e/`) and record dispositions: cache-header contract test stays in `apps/web/tests/unit`; `.sh` checks manual-only; orphan live-stack test execution tracked in #91 (blocked on #75). (FR-009, SC-005)

**Checkpoint**: the home works for new tests and is documented (MVP complete with Phases 1–3).

---

## Phase 4: User Story 2 — No dormant tests (P2)

**Goal**: the previously-dormant root integration tests are now collected (skipped, not absent); every test file is accounted for.

**Independent test**: `pnpm test` reports `tests/integration/*` as skipped (not missing) when live-stack env is unset.

- [x] T005 [US2] Run `pnpm test` and confirm `tests/integration/backup.test.ts`, `tests/integration/backup-retention.test.ts`, `tests/integration/provision-instance.test.ts` are collected and reported **skipped** (their `describe.skipIf` on missing `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF`) — not absent. (FR-005, SC-003)
- [x] T006 [P] [US2] Confirm each orphan test loads without throwing under node env when those env vars are unset (module-level code must not error before `skipIf`); fix any top-level access that throws so they skip cleanly. Files: `tests/integration/backup.test.ts`, `tests/integration/backup-retention.test.ts`, `tests/integration/provision-instance.test.ts`. (FR-004, FR-005)

**Checkpoint**: zero dormant tests; orphans visible-as-skipped.

---

## Phase 5: User Story 3 — Future dormancy prevented (P3)

**Goal**: a guard fails CI when a test file lands in an uncollected location.

**Independent test**: a misplaced `*.test.ts` makes `pnpm lint` fail naming it; removing it passes.

- [x] T007 [US3] Create `scripts/check-test-collection.mjs` per `contracts/test-collection-guard.md` — glob `**/*.{test,spec}.{ts,tsx}` via Node 20 `fs.readdirSync(dir, { recursive: true })` (no new dependency), excluding `node_modules`, `dist`, `**/tests/e2e/**`; exit 1 listing every file outside the collected roots (`packages/*`, `apps/*`, `tests/`) with its expected home; else exit 0 printing `✓ all <N> test files are collected`. Mirror `apps/web/scripts/check-page-coverage.mjs`. (FR-006)
- [x] T008 [US3] Wire the guard into `pnpm lint` — append ` && node scripts/check-test-collection.mjs` to the `lint` script in root `package.json`. (FR-006)
- [x] T009 [US3] Negative test (SC-004): create `bogus.test.ts` at the repo root, run `pnpm lint`, confirm it fails naming `bogus.test.ts`; delete it, run `pnpm lint`, confirm it passes.

**Checkpoint**: dormancy can't silently return.

---

## Phase 6: Polish & Cross-Cutting

- [x] T010 [P] Run full `pnpm test` (orphans skipped, home green) and `pnpm lint` (guard passes) — confirm both green. (SC-001)
- [x] T011 [P] Confirm `pnpm format:check` (prettier) and `pnpm lint` (eslint) are clean on the new files: `tests/vitest.config.ts`, `scripts/check-test-collection.mjs`, `tests/README.md`.
- [x] T012 [P] Write `docs/changes/023-integration-test-home.md` runbook (per the repo `docs/changes/NNN-*.md` convention): what changed (root `tests/` project, dormancy guard, README), how to add a test, the #91/#75 follow-up.

---

## Dependencies & Execution Order

- **T001 → T002** (config before workspace wiring).
- **T002 blocks** US1 (T003, T004), US2 (T005, T006), and the verification of US3.
- Within stories: T004 ‖ T003; T006 ‖ T005; **T007 → T008 → T009** (build guard → wire into lint → negative test).
- **US3 (T007, T008) can be built in parallel with US1/US2** after T002 — different files (`scripts/` + `package.json`).
- Polish (T010–T012) runs after all stories.

## Parallel Execution Examples

- After T002: do **T004** (README) and **T007** (guard script) in parallel — disjoint files.
- Polish: **T010, T011, T012** in parallel.

## Implementation Strategy (MVP first)

- **MVP = Phases 1–3 (T001–T004)**: the home exists, collects tests in node env, and is documented; the dormant `tests/integration/*` immediately become collected. Demoable on its own.
- **+ US2 (T005–T006)**: confirm/clean the orphans → zero dormant tests.
- **+ US3 (T007–T009)**: lock it in with the dormancy guard.
- **Polish (T010–T012)**: full green + runbook.

**Total**: 12 tasks — Setup 1 · Foundational 1 · US1 2 · US2 2 · US3 3 · Polish 3.
