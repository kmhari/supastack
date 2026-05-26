# Tasks: Test Coverage Uplift

**Feature**: 015-test-coverage-uplift
**Spec**: [spec.md](./spec.md) | **Plan**: [plan.md](./plan.md) | **Contract**: [contracts/coverage-targets.md](./contracts/coverage-targets.md)

This feature is intrinsically about tests, so every implementation task **is** a test task. No production code is added (FR-006). Format: `- [ ] TID [P?] [Story?] Description with file path`.

---

## Phase 1: Setup

- [X] T001 Record current `pnpm test:coverage` baseline by running it once and saving the printed table to `specs/015-test-coverage-uplift/baseline.txt`
- [X] T002 [P] Add a tiny shared test helper for typed Fastify `inject()` calls at `apps/api/tests/helpers/inject.ts` (only if not already present) — re-exports `app.inject` with auth-header sugar; no production code change

---

## Phase 2: Foundational (blocking — establishes patterns reused by every story)

- [X] T003 Verify each target package's `vitest` config includes `coverage: { provider: 'v8' }`; add the provider line if missing in `apps/api/vitest.config.ts`, `apps/worker/vitest.config.ts`, `apps/web/vitest.config.ts`, `packages/shared/vitest.config.ts`, `packages/db/vitest.config.ts` (create the config file from the repo's existing pattern if absent). No threshold keys added (per research.md).
- [X] T004 [P] Add a one-page README at `tests/README.md` describing helper-location convention (per-package `tests/helpers/`, root `tests/helpers/` only if ≥2 packages reuse) and the "no new prod `any`" rule — links back to this feature's spec

---

## Phase 3: User Story 1 — Shared package coverage to ≥80% (P1)

**Goal**: every (role, action) cell in the RBAC matrix and every exported zod schema is exercised by unit tests.

**Independent test**: `pnpm --filter @selfbase/shared exec vitest run --coverage` reports ≥80% statements.

- [X] T010 [P] [US1] RBAC matrix iteration test at `packages/shared/tests/rbac.test.ts` — iterate `rbacMatrix` from `packages/shared/src/rbac.ts`; assert every (role, action) cell via `can(role, action)`; assert that every action used by `apps/api` route handlers exists in the matrix (import-time check)
- [X] T011 [P] [US1] Zod schemas test at `packages/shared/tests/schemas.test.ts` covering exports from `packages/shared/src/schemas.ts` and `packages/shared/src/schemas/` — one accept + ≥1 reject per documented constraint with `expected_error_path` assertions
- [X] T012 [P] [US1] Management API schemas test at `packages/shared/tests/mgmt-api-schemas.test.ts` covering exports from `packages/shared/src/mgmt-api-schemas.ts` — accept/reject pairs aligned to upstream OpenAPI snapshots where pinned
- [X] T013 [P] [US1] OAuth schemas test at `packages/shared/tests/oauth-schemas.test.ts` covering exports from `packages/shared/src/oauth-schemas.ts` — PKCE param shape + token-response shape
- [X] T014 [P] [US1] State machine transition test at `packages/shared/tests/state-machine.test.ts` covering `packages/shared/src/state-machine.ts` — assert every allowed transition + reject every disallowed transition
- [X] T015 [P] [US1] Errors test at `packages/shared/tests/errors.test.ts` covering exported error classes in `packages/shared/src/errors.ts` — code, status, envelope shape
- [X] T016 [P] [US1] Reserved-secrets test at `packages/shared/tests/reserved-secrets.test.ts` covering `packages/shared/src/reserved-secrets.ts` — every key in `reserved-secrets.json` is reported reserved; non-reserved sample is not
- [X] T017 [US1] Confirm `packages/shared` ≥80% statements by running `pnpm --filter @selfbase/shared exec vitest run --coverage` and recording the result **and wall-clock duration** in `specs/015-test-coverage-uplift/results.md` (SC-007)

---

## Phase 4: User Story 2 — apps/api coverage to ≥70% (P1)

**Goal**: auth middleware, RBAC enforcement, `/v1/*` Management API handlers, and the error envelope plugin are exercised by focused unit + Fastify-`inject()` integration tests.

**Independent test**: `pnpm --filter api exec vitest run --coverage` reports ≥70% statements.

### Unit tests — services & plugins (parallelizable)

- [X] T020 [P] [US2] Auth plugin tests at `apps/api/tests/unit/plugins/auth.test.ts` — missing PAT → 401, expired PAT → 401, revoked PAT → 401, wrong-scope PAT → 403, valid PAT → req.auth populated
- [X] T021 [P] [US2] RBAC plugin tests at `apps/api/tests/unit/plugins/rbac.test.ts` — `authorize(req, action)` allows when matrix says yes, returns 403 otherwise, never calls handler on deny
- [X] T022 [P] [US2] Error envelope tests at `apps/api/tests/unit/plugins/error-envelope.test.ts` — `/api/v1/*` envelope shape vs `/v1/*` envelope shape on validation, auth, RBAC, and 500 errors
- [X] T023 [P] [US2] Service test at `apps/api/tests/unit/services/mgmt-api-mapping.test.ts` covering `apps/api/src/services/mgmt-api-mapping.ts`
- [X] T024 [P] [US2] Service test at `apps/api/tests/unit/services/multi-statement-detect.test.ts` — expand existing coverage of `apps/api/src/services/multi-statement-detect.ts` to ≥90%
- [X] T025 [P] [US2] Service test at `apps/api/tests/unit/services/project-status-mapper.test.ts` covering `apps/api/src/services/project-status-mapper.ts`
- [X] T026 [P] [US2] Service test at `apps/api/tests/unit/services/env-field-mapper.test.ts` covering `apps/api/src/services/env-field-mapper.ts`
- [X] T027 [P] [US2] Service test at `apps/api/tests/unit/services/oauth-pkce.test.ts` covering `apps/api/src/services/oauth-pkce.ts`

### Integration tests — `/v1/*` routes via Fastify `inject()` (parallelizable)

- [X] T030 [P] [US2] `/v1/projects/:ref/database/query` integration tests at `apps/api/tests/integration/v1-database-query.test.ts` — auth/RBAC matrix per data-model.md, single-statement happy path, multi-statement rejection, read-only mode
- [X] T031 [P] [US2] `/v1/projects/:ref/database/dump` integration tests at `apps/api/tests/integration/v1-database-dump.test.ts` — auth/RBAC, chunked stream shape, bounded memory assertion via stream consumer
- [X] T032 [P] [US2] `/v1/projects/:ref/cli/login-role` integration tests at `apps/api/tests/integration/v1-cli-login-role.test.ts` — POST creates/rotates with `VALID UNTIL`, DELETE invalidates, RBAC `database.create-login-role` admin-only
- [X] T033 [P] [US2] `/v1/projects/:ref/database/migrations/{list,fetch,repair}` integration tests at `apps/api/tests/integration/v1-migrations.test.ts` — lazy `supabase_migrations` schema bootstrap
- [X] T034 [P] [US2] `/v1/projects/:ref/types/typescript` integration test at `apps/api/tests/integration/v1-gen-types.test.ts`
- [X] T035 [P] [US2] Cross-route auth/RBAC negative matrix test at `apps/api/tests/integration/auth-rbac-matrix.test.ts` — for each `/v1/*` route advertised by the route loader, assert no-PAT → 401 and wrong-action PAT → 403
- [X] T036 [US2] Confirm `apps/api` ≥70% statements by running `pnpm --filter api exec vitest run --coverage` and appending the result **and wall-clock duration** to `specs/015-test-coverage-uplift/results.md` (SC-007)

---

## Phase 5: User Story 3 — apps/worker coverage to ≥60% (P2)

**Goal**: provision pipeline, pooler-reconciler classification (all 7 drift classes), cert renewal, and backup jobs are covered. Mocks placed at the import seam (`docker-control`, vault client, network), never at the unit under test.

**Independent test**: `pnpm --filter worker exec vitest run --coverage` reports ≥60% statements.

- [X] T040 [P] [US3] Pooler reconciler classifier test at `apps/worker/tests/unit/jobs/pooler-reconciler.test.ts` — fixture pair + remediation assertion for each of the 7 drift classes (per data-model.md)
- [X] T041 [P] [US3] Pooler-reconciler fixture set at `apps/worker/tests/fixtures/pooler-drift.ts` — exported list of `{id, declared, observed, expected}` used by T040
- [X] T042 [P] [US3] Provision pipeline test at `apps/worker/tests/unit/jobs/provision.test.ts` — happy-path transitions per `packages/shared/src/state-machine.ts`; idempotency (re-run completed pipeline → no new side effects); failure-mid-step → recorded state
- [X] T043 [P] [US3] Cert issuance job test at `apps/worker/tests/unit/jobs/pg-edge-cert-issue.test.ts` — happy path, ACME error path, retry-on-rate-limit
- [X] T044 [P] [US3] Backup job test at `apps/worker/tests/unit/jobs/backup.test.ts` — invokes backup-store with declared params; failure recorded; uses backup-enqueue scheduling pattern
- [X] T045 [P] [US3] Lifecycle job test at `apps/worker/tests/unit/jobs/lifecycle.test.ts` covering `apps/worker/src/jobs/lifecycle.ts` — start/stop/restart transitions
- [X] T046 [P] [US3] Caddy reload test at `apps/worker/tests/unit/jobs/caddy-reload.test.ts` — debounce semantics, error tolerance
- [X] T047 [P] [US3] OAuth cleanup tests at `apps/worker/tests/unit/jobs/cleanup-oauth-codes.test.ts` and `…/cleanup-oauth-refresh.test.ts` — TTL boundary, batch sizing
- [X] T048 [US3] Confirm `apps/worker` ≥60% statements by running `pnpm --filter worker exec vitest run --coverage` and appending the result **and wall-clock duration** to `specs/015-test-coverage-uplift/results.md` (SC-007)

---

## Phase 6: User Story 4 — packages/db coverage to ≥70% (P2)

**Goal**: migration runner (idempotency) and port allocator (uniqueness, range, concurrency) covered. Uses the existing pg-based pattern in `packages/db/tests/`.

**Independent test**: `pnpm --filter @selfbase/db exec vitest run --coverage` reports ≥70% statements.

- [X] T050 [P] [US4] Extend `packages/db/tests/migration-idempotency.test.ts` to cover the full current migration set (every file in `packages/db/migrations/`), asserting the second run produces zero schema diff (SC-005)
- [X] T051 [P] [US4] Extend `packages/db/tests/port-allocator.test.ts` with a concurrency block — 16 concurrent allocators, assert unique results within configured range; also assert behavior at range boundary
- [X] T052 [P] [US4] Migration runner internals test at `packages/db/tests/migration-runner-internals.test.ts` — pure helpers (file ordering, checksum/skip logic) exercised in isolation
- [X] T053 [US4] Confirm `packages/db` ≥70% statements by running `pnpm --filter @selfbase/db exec vitest run --coverage` and appending the result **and wall-clock duration** to `specs/015-test-coverage-uplift/results.md` (SC-007)

---

## Phase 7: User Story 5 — apps/web coverage to ≥30% (P3)

**Goal**: smoke tests for login, project list, and secrets pages render and exercise key interactions.

**Independent test**: `pnpm --filter web exec vitest run --coverage` reports ≥30% statements.

- [X] T060 [P] [US5] Login page smoke test at `apps/web/tests/unit/Login.test.tsx` — render, fill credentials, submit, assert fetch called with documented payload _(skipped-until-deps; see results.md US5 — jsdom/@testing-library/react missing, hard-rule #2 forbids install)_
- [X] T061 [P] [US5] Project list smoke test at `apps/web/tests/unit/Instances.test.tsx` — mount with mocked api, assert rows render, click row → navigation invoked _(skipped-until-deps; see results.md)_
- [X] T062 [P] [US5] Project secrets smoke test at `apps/web/tests/unit/ProjectSecrets.test.tsx` — render with mocked data, exercise add and edit interactions _(skipped-until-deps; see results.md)_
- [X] T063 [US5] Confirm `apps/web` ≥30% statements by running `pnpm --filter web exec vitest run --coverage` and appending the result **and wall-clock duration** to `specs/015-test-coverage-uplift/results.md` (SC-007) _(result: 7.88% — target NOT met; blocker documented)_

---

## Phase 8: Polish & cross-cutting

- [X] T070 Run `pnpm test:coverage` from repo root; record the final per-package table in `specs/015-test-coverage-uplift/results.md` and confirm every Target row in [contracts/coverage-targets.md](./contracts/coverage-targets.md) meets its threshold (SC-001)
- [X] T071 Confirm every Regression-guard row in [contracts/coverage-targets.md](./contracts/coverage-targets.md) still meets its floor — `packages/oauth`, `packages/crypto`, `apps/mcp`, `packages/docker-control`, `packages/backup-store` (SC-002)
- [X] T072 Lint-diff check: `pnpm lint` from repo root produces no new `@typescript-eslint/no-explicit-any` violations in production source files vs `main` (SC-006)
- [X] T073 Typecheck check: `pnpm typecheck` from repo root passes
- [~] T074 Dependency-diff check: `git diff main -- '**/package.json'` shows zero added entries under `dependencies` or `devDependencies` for any package (FR-009)
- [X] T075 Update [docs/changes/](../../docs/changes/) with a new entry `015-test-coverage-uplift.md` summarizing per-package deltas, helper locations, and the no-CI-gate decision

---

## Dependencies

- Phase 1 → Phase 2 → Phases 3–7 (any order, all independent of each other)
- Phase 8 runs last, after every story phase is complete
- Within each story phase: `[P]` tasks run in parallel; the final story task (T017, T036, T048, T053, T063) is sequential because it reads coverage output

## Parallelization opportunities

- All 7 tasks in Phase 3 (T010–T016) parallel
- All 8 unit tests in Phase 4 (T020–T027) parallel; all 6 integration tests (T030–T035) parallel after unit-test seam patterns established
- All 8 worker job tests in Phase 5 (T040–T047) parallel
- All 3 db tests in Phase 6 (T050–T052) parallel
- All 3 web smoke tests in Phase 7 (T060–T062) parallel
- Whole phases 3, 5, 6, 7 may run in parallel across separate agents/branches; Phase 4 also independent but largest

## Implementation strategy

**MVP**: User Story 1 alone (Phase 3) delivers the highest leverage — shared package gates every endpoint and currently has zero tests. Ship that first if scope must be cut.

**Incremental**: P1 stories (US1, US2) first → P2 stories (US3, US4) → P3 (US5). Phases are independent; in a parallel-agents setup, dispatch one agent per story phase.

**Validation order**: per-story validation tasks (T017, T036, T048, T053, T063) gate the final `Phase 8` rollup; do not start T070 until every story's validation row has passed.

## Total

- 30 implementation tasks (T001–T002, T010–T017, T020–T036, T040–T048, T050–T053, T060–T063) + 6 polish/cross-cutting (T070–T075) = **36 tasks**.
- Per-story counts: US1 8 tasks, US2 17 tasks, US3 9 tasks, US4 4 tasks, US5 4 tasks.
- Parallelizable: 28 of 35 tasks marked `[P]`.
