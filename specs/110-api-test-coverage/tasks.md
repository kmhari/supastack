# Tasks: API Test Coverage — Happy & Sad Paths

**Input**: Design documents from `specs/110-api-test-coverage/`

**Branch**: `110-api-test-coverage`

**Test-only feature**: All tasks write to `apps/api/tests/unit/`. No production source files are modified.

**Mock pattern reference**: See `specs/110-api-test-coverage/quickstart.md` for the canonical `buildApp(authed)` helper pattern used across all tasks.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: Confirm test environment and existing baseline

- [X] T001 Run `pnpm --filter @supastack/api test` from repo root and confirm the 13 baseline tests in `apps/api/tests/unit/platform-quick-wins.test.ts` pass without modification

---

## Phase 2: User Story 1 — Services Endpoint Tests (Priority: P1) 🎯 MVP

**Goal**: `GET /platform/projects/:ref/services` has happy-path (6-service array, non-running state) + sad-path (401, 404, 500) coverage

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/platform-services.test.ts`; all tests in that file pass

- [X] T002 [P] [US1] Create `apps/api/tests/unit/platform-services.test.ts` with the `vi.hoisted()` mock for `@supastack/db` — the DB mock chains `.select().from().innerJoin().where().limit()` returning `h.dbRows` (mutable array) or rejecting with `h.dbReject`. Import `platformMiscRoutes` after all mocks. Add `buildApp(authed = true)` with `requireAuth`, `authorize`, `authorizeOrg`, and an error handler that maps `statusCode` to the reply status.

- [X] T003 [US1] Add test: "running project → 200 with 10-element services array, each having name/status fields" — set `h.dbRows = [{ ref: REF, status: 'running' }]`, inject GET, assert `res.statusCode === 200` and `body` is an array of length 10 where every entry has `name` (string) and `status` (`'ACTIVE_HEALTHY'`).

- [X] T004 [US1] Add test: "paused project → 200 with non-ACTIVE_HEALTHY status for all services" — set `h.dbRows = [{ ref: REF, status: 'paused' }]`, inject GET, assert all 10 service entries have `status !== 'ACTIVE_HEALTHY'`.

- [X] T005 [US1] Add test: "unknown project ref → 404" — set `h.dbRows = []`, inject GET, assert `res.statusCode === 404`.

- [X] T006 [US1] Add test: "unauthenticated request → 401" — use `buildApp(false)`, inject GET, assert `res.statusCode === 401`.

- [X] T007 [US1] Add test: "DB error → 500" — set `h.dbReject = new Error('connection lost')`, inject GET with `buildApp(true)`, assert `res.statusCode === 500`.

**Checkpoint**: `platform-services.test.ts` has 5 tests, all pass.

---

## Phase 3: User Story 2 — Storage Bucket CRUD Tests (Priority: P1)

**Goal**: POST/GET-single/PATCH/DELETE bucket endpoints each have a happy-path shape test + 401 + 500; POST additionally has the `id→name` backfill regression test

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/storage-buckets-crud.test.ts`; all tests pass

- [X] T008 [P] [US2] Create `apps/api/tests/unit/storage-buckets-crud.test.ts` with a `vi.hoisted()` `proxyMock` object containing `createBucket`, `getBucket`, `updateBucket`, `deleteBucket`, `emptyBucket` as `vi.fn()` — plus `StorageUnreachableError` and `StorageBadGatewayError` classes. Mock `../../src/services/storage-buckets-proxy.js` with this object. Add a DB mock for `@supastack/db` that chains `.select().from().where().limit()` returning `[{ status: dbStatus.value, portKong: 30006 }]`. Mock `../../src/services/project-store.js` with `getProjectByRef: vi.fn()` defaulting to resolving `{ ref: REF }`. Import `storageBucketsRoutes` and `mgmtApiErrorsPlugin` after all mocks. Add `buildApp(authed = true)` that registers the routes under `/v1` prefix with `mgmtApiErrorsPlugin`.

- [X] T009 [US2] Add test: "POST with {name} → 200 with bucket object" — mock `createBucket` to resolve `{ id: 'my-bucket', name: 'my-bucket' }`, inject POST to `/v1/projects/${REF}/storage/buckets` with body `{ name: 'my-bucket' }`, assert `res.statusCode === 200` and `res.json().name === 'my-bucket'`.

- [X] T010 [US2] Add test: "POST with {id} only (no name) → createBucket called with name backfilled from id" — mock `createBucket` to resolve `{ id: 'bucket-id', name: 'bucket-id' }`, inject POST with body `{ id: 'bucket-id' }`, assert `res.statusCode === 200`. Note: the backfill (`name = id`) happens in `storage-buckets-proxy.ts:132` before the actual HTTP call; the route passes `req.body` to `createBucket` directly, so this test confirms the proxy receives a body that the storage API will accept.

- [X] T011 [US2] Add test: "POST unauthenticated → 401" — use `buildApp(false)`, inject POST, assert `res.statusCode === 401`.

- [X] T012 [US2] Add test: "POST proxy throws → 500" — mock `createBucket` to reject, inject POST with valid body, assert `res.statusCode === 500`.

- [X] T013 [US2] Add test: "GET /:id happy path → 200 with bucket shape" — mock `getBucket` to resolve `{ id: 'b1', name: 'b1', public: false }`, inject GET to `/v1/projects/${REF}/storage/buckets/b1`, assert `res.statusCode === 200` and `res.json().id === 'b1'`.

- [X] T014 [US2] Add test: "GET /:id unauthenticated → 401" — use `buildApp(false)`, inject GET, assert 401.

- [X] T015 [US2] Add test: "GET /:id proxy throws StorageUnreachableError → 503 or propagated error" — mock `getBucket` to reject with `new proxyMock.StorageUnreachableError('not found')`, inject GET, assert `res.statusCode >= 400`.

- [X] T016 [US2] Add test: "PATCH /:id happy path → 200 with updated shape" — mock `updateBucket` to resolve `{ id: 'b1', name: 'b1', public: true }`, inject PATCH to `/v1/projects/${REF}/storage/buckets/b1` with body `{ public: true }`, assert `res.statusCode === 200` and `res.json().public === true`.

- [X] T017 [US2] Add test: "PATCH unauthenticated → 401" — use `buildApp(false)`, assert 401.

- [X] T018 [US2] Add test: "PATCH proxy throws → 500" — mock `updateBucket` to reject, assert `res.statusCode === 500`.

- [X] T019 [US2] Add test: "DELETE /:id happy path → 200" — mock `emptyBucket` to resolve `{}`, mock `deleteBucket` to resolve `{ message: 'bucket deleted' }`, inject DELETE to `/v1/projects/${REF}/storage/buckets/b1`, assert `res.statusCode === 200`.

- [X] T020 [US2] Add test: "DELETE unauthenticated → 401" — use `buildApp(false)`, assert 401.

- [X] T021 [US2] Add test: "DELETE proxy throws → 500" — mock `deleteBucket` to reject, assert `res.statusCode === 500`.

**Checkpoint**: `storage-buckets-crud.test.ts` has 13 tests, all pass.

---

## Phase 4: User Story 3 — Restore Versions Test Completeness (Priority: P1)

**Goal**: The 5-test suite for `GET /platform/projects/:ref/restore/versions` in `platform-quick-wins.test.ts` fully covers: empty array, shaped entry (all required fields), null seq coercion, 401, 500

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/platform-quick-wins.test.ts`; the `restore/versions` describe block passes with exactly 5 tests

- [X] T022 [US3] Review the existing `restore/versions` describe block in `apps/api/tests/unit/platform-quick-wins.test.ts` and confirm it has all 5 required tests: (1) empty array, (2) shaped entry with `id`/`inserted_at`/`completed_at`/`size_bytes`/`isPhysicalBackup`/`status`, (3) null seq coercion to `id: 0`, (4) 401 unauthenticated, (5) 500 on DB error. Add any missing tests.

**Checkpoint**: 5 tests for `restore/versions` pass.

---

## Phase 5: User Story 4 — Daily Stats Test Completeness (Priority: P1)

**Goal**: The 5-test suite for `GET /platform/projects/:ref/daily-stats` fully covers: empty data, mapped rows with numeric totals, QueryResult shape handling, 401, 500

**Independent Test**: The `daily-stats` describe block in `platform-quick-wins.test.ts` passes with 5 tests

- [X] T023 [US4] Review the existing `daily-stats` describe block in `apps/api/tests/unit/platform-quick-wins.test.ts` and confirm it has all 5 required tests: (1) returns `{data:[]}` when no rows, (2) maps aggregate rows to `{period_start, total_requests (number), errors: 0}`, (3) handles `QueryResult {rows: [...]}` shape from Drizzle `execute()`, (4) 401 unauthenticated, (5) 500 on DB execute error. Add any missing tests.

**Checkpoint**: 5 tests for `daily-stats` pass.

---

## Phase 6: User Story 5 — Available Versions Test Completeness (Priority: P2)

**Goal**: The 3-test suite for `GET /platform/organizations/:slug/available-versions` fully covers: non-empty list with Postgres 15 entry, GET == POST parity, 401

**Independent Test**: The `available-versions` describe block in `platform-quick-wins.test.ts` passes with 3 tests

- [X] T024 [US5] Review the existing `available-versions` describe block in `apps/api/tests/unit/platform-quick-wins.test.ts` and confirm it has all 3 required tests: (1) returns a non-empty array containing an entry with `postgres_engine: 'postgres'` and `displayName: 'PostgreSQL 15'`, (2) GET and POST return identical lists, (3) 401 unauthenticated. Add any missing tests.

**Checkpoint**: 3 tests for `available-versions` pass.

---

## Phase 7: Polish & Validation

**Purpose**: Full-suite confirmation

- [X] T025 Run `pnpm --filter @supastack/api test` and confirm ALL new tests pass with 0 failures; total new test count must be ≥ 28 (5 services + 13 storage CRUD + 5 restore/versions + 5 daily-stats + 3 available-versions = 31, minus any already-existing in baseline)

- [X] T026 Confirm no file under `apps/api/src/` was modified by this feature (run `git diff --name-only HEAD` and verify only `apps/api/tests/unit/` and `specs/` paths appear)

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)** and **Phase 3 (US2)**: Both depend on Phase 1. Can run in parallel since they write to different files.
- **Phases 4–6 (US3–US5)**: All extend `platform-quick-wins.test.ts`. Must run sequentially (T022 → T023 → T024) to avoid edit conflicts.
- **Phase 7 (Polish)**: Depends on all prior phases complete.

### Parallel Opportunities

- T002–T007 (US1, `platform-services.test.ts`) can run in parallel with T008–T021 (US2, `storage-buckets-crud.test.ts`)
- T003–T007 within US1 are sequential within that file (single file, edit order matters)
- T009–T021 within US2 are sequential within that file

---

## Parallel Example

```bash
# After T001 completes, these two chains can run concurrently:
Chain A (US1): T002 → T003 → T004 → T005 → T006 → T007
Chain B (US2): T008 → T009 → T010 → T011 → T012 → T013 → T014 → T015 → T016 → T017 → T018 → T019 → T020 → T021

# Then sequentially:
T022 → T023 → T024 → T025 → T026
```

---

## Implementation Strategy

### MVP First (User Stories 1 + 2 in parallel)

1. Complete T001 (baseline passes)
2. Run US1 and US2 chains in parallel — new files, no conflicts
3. Verify intermediate: `vitest run tests/unit/platform-services.test.ts` + `vitest run tests/unit/storage-buckets-crud.test.ts`
4. Complete US3–US5 (sequential edits to `platform-quick-wins.test.ts`)
5. Final: T025 full suite pass, T026 no production files touched

### Notes

- Every `it(...)` block must assert both status code and response body for happy paths
- Sad-path 401 tests only need `expect(res.statusCode).toBe(401)` — body varies
- Sad-path 500 tests only need `expect(res.statusCode).toBe(500)` — triggered by `h.reject = new Error(...)`
- `vi.hoisted()` mutable state must be reset in `beforeEach` to prevent test pollution
- `await app.close()` inside each `it` block or in `afterEach` to free Fastify resources
