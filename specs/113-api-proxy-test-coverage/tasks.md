# Tasks: Comprehensive API & Proxy Test Coverage

**Input**: Design documents from `specs/113-api-proxy-test-coverage/`

**Prerequisites**: plan.md ✓, spec.md ✓, research.md ✓, quickstart.md ✓

**Branch**: `113-api-proxy-test-coverage`

**Organization**: Pure test addition — 8 new test files, ~80 test cases. No source files changed. Tasks organized by user story (P1→P4) for independent implementation and verification.

---

## Phase 1: Setup (Shared Infrastructure)

**No tasks required.** All infrastructure is already in place:
- Vitest workspace: `apps/api` project + root `tests/` project
- `TEST_KONG_BASE_URL` seam in `platform-proxy-helpers.ts`
- Exported transform functions in `platform-proxy.ts`
- Integration test script (`pnpm test:integration`) already wired in `package.json`

---

## Phase 2: Foundational (Blocking Prerequisites)

**No tasks required.** Each test file is independently self-contained. All mocking patterns are already established in:
- `apps/api/tests/unit/platform-organizations.test.ts` (db() fluent chain pattern)
- `apps/api/tests/unit/realtime-config.test.ts` (buildApp + store mock pattern)
- `apps/api/tests/unit/platform-proxy.test.ts` (resolveInstance mock pattern)

---

## Phase 3: User Story 1 — VM-Backed Proxy Smoke Tests (Priority: P1) 🎯

**Goal**: A single command (`pnpm test:integration` with env vars set) verifies the live proxy is routing correctly to real upstream services on the VM — all 5 proxy surface groups return 2xx.

**Independent Test**: Set `TEST_API_URL`, `TEST_TOKEN_ADMIN`, `TEST_INSTANCE_REF`, run `pnpm test:integration` against the live VM. Without those env vars the suite skips cleanly.

- [X] T001 [US1] Create `tests/integration/platform-proxy-smoke.test.ts` with `describe.skipIf(!ENABLED)` guard, Node.js built-in `fetch` client, and 6 smoke tests: pg-meta GET tables (2xx + array body), storage GET buckets (2xx + array), storage POST objects/list (2xx + array, not 400), auth GET admin/users (2xx), analytics GET logs.all (not 500), failed-project pg-meta (not 503 — guards the UNAVAILABLE_STATUSES fix); failed-project test additionally gated by `TEST_FAILED_INSTANCE_REF`

**Checkpoint**: `pnpm test:integration` (without env vars) skips cleanly. With env vars + live VM → all 6 tests pass.

---

## Phase 4: User Story 2 — Fake-Upstream Integration Tests (Priority: P2)

**Goal**: Without any live infrastructure, tests verify that proxy path rewriting, body normalization, and header injection work correctly by recording what a real HTTP server receives.

**Independent Test**: `pnpm --filter @supastack/api test -- --reporter=verbose platform-proxy-fake-upstream` — completes in under 10s with zero network calls.

- [X] T002 [US2] Create `apps/api/tests/unit/platform-proxy-fake-upstream.test.ts`:
  - `beforeAll`: spin up `http.createServer` bound to port 0, store `lastRequest = {path, method, headers, body}` on each request, start listening
  - `afterAll`: close server
  - `beforeEach`: set `process.env.TEST_KONG_BASE_URL = http://localhost:<port>`; mock `resolveInstance` from `platform-proxy-helpers.js` to return `{ portKong: 0, serviceRoleKey: 'test-srk', apiKey: 'test-key', portMeta: 0, portAuth: 0, portStorage: 0, portAnalytics: 0 }`
  - `afterEach`: delete `process.env.TEST_KONG_BASE_URL`
  - Test: **pg-meta** — `GET /platform/pg-meta/:ref/tables` → upstream receives `GET /pg/tables`, `apikey` header present, `Authorization: Bearer test-srk` header present
  - Test: **storage list** — `POST /platform/storage/:ref/buckets/test/objects/list` → upstream receives `POST /storage/v1/object/list/test`, body has `prefix` field (normalized)
  - Test: **storage bucket-create** — `POST /platform/storage/:ref/buckets` with `{ id: 'my-bucket', type: 'private' }` → upstream body has `name: 'my-bucket'` (backfilled from `id`)
  - Test: **auth admin** — `GET /platform/auth/:ref/users` → upstream receives `GET /auth/v1/admin/users`, `apikey` + `Authorization: Bearer` headers present
  - Test: **analytics** — `GET /platform/projects/:ref/analytics/endpoints/logs.all` → upstream path is `/analytics/v1/api/endpoints/logs.all` (not doubled — guards feature 112 regression)

**Checkpoint**: `pnpm --filter @supastack/api test -- platform-proxy-fake-upstream` — all 5 tests pass in under 10s.

---

## Phase 5: User Story 3 — Management Route Unit Tests (Priority: P3)

**Goal**: Three previously-untested management routes (`gen-types`, `migrations`, `postgrest-config`) each have complete happy + sad path unit test coverage.

**Independent Test**: `pnpm --filter @supastack/api test -- --reporter=verbose gen-types migrations postgrest-config` — all pass in under 30s.

- [X] T003 [P] [US3] Create `apps/api/tests/unit/gen-types.test.ts`:
  - Use `buildApp` pattern (same as `realtime-config.test.ts`): register `genTypesRoutes` plugin wrapped in `fp()` + `mgmtApiErrorsPlugin`
  - Mock `gen-types-service.js` (`generateTypes` export): use `vi.mock` + per-test `vi.mocked(generateTypes).mockResolvedValue(...)` / `mockRejectedValue(...)`
  - Mock `project-store.js` (`getProjectByRef`): return fake project row or throw `AppError('not_found')`
  - Mock `auth.ts` (`requireAuth`): return fake `{ userId: 'test-user' }`
  - Tests:
    1. GET `/v1/projects/:ref/types/typescript` 200 — `generateTypes` resolves `'type Foo = ...'` → response body is string
    2. GET 404 — `getProjectByRef` throws `AppError('not_found')` → `{ code: 'not_found' }`
    3. GET 401 — `requireAuth` throws `AppError('unauthorized')` → 401
    4. GET 400 — `generateTypes` throws `GenTypesError('schema_not_found')` → 400
    5. GET 409 — `generateTypes` throws `GenTypesError('instance_not_running')` → 409
    6. GET 502 — `generateTypes` throws `GenTypesError('meta_unreachable')` → 502

- [X] T004 [P] [US3] Create `apps/api/tests/unit/migrations.test.ts`:
  - Register `migrationsRoutes` wrapped in `fp()` + `mgmtApiErrorsPlugin`
  - Mock `migrations-service.js` (`listMigrations`, `upsertMigration`, `deleteMigration`)
  - Mock `per-instance-pg.js` error classes via `vi.hoisted` (re-declare `InstanceNotFoundError`, `InstanceNotRunningError`, `PerInstancePgConnectError` so `instanceof` works)
  - Mock `project-store.js` (`getProjectByRef`)
  - Mock `auth.ts` (`requireAuth`)
  - Tests:
    1. GET `/v1/projects/:ref/database/migrations` 200 — `listMigrations` returns `[{ version: '20240101', name: 'foo' }]`
    2. POST `/v1/projects/:ref/database/migrations` 200 — `upsertMigration` succeeds → 200
    3. DELETE `/v1/projects/:ref/database/migrations/:version` 200 — `deleteMigration` succeeds → 200
    4. POST 400 — body missing `version` field → Zod validation 400
    5. DELETE 400 — version param format invalid → 400
    6. GET 404 — `getProjectByRef` returns null → 404
    7. GET 409 — `listMigrations` throws `InstanceNotRunningError` → 409
    8. GET 401 — `requireAuth` throws `AppError('unauthorized')` → 401

- [X] T005 [P] [US3] Create `apps/api/tests/unit/postgrest-config.test.ts`:
  - Register `postgrestConfigRoutes` wrapped in `fp()` + `mgmtApiErrorsPlugin`
  - Mock `project-store.js` (`getProjectByRef`)
  - Mock `runtime-config-store.js` (`getConfig`, `patchConfig`)
  - Mock `@supastack/db`: `db()` returns fluent chain `{ select: () => ({ from: () => ({ where: () => ({ limit: async () => [] }) }) }) }` (empty `encryptedSecrets`)
  - Mock `@supastack/crypto`: `decryptJson: vi.fn(() => ({}))`, `loadMasterKey: vi.fn(() => Buffer.alloc(32))`
  - Tests:
    1. GET `/v1/projects/:ref/config/database/postgrest` 200 with defaults — no stored config, no secrets → defaults shape (has `max_rows`, `db_schema`, `db_extra_search_path`)
    2. GET 200 with stored config — `getConfig` returns `{ max_rows: 500 }` → response has `max_rows: 500`
    3. PATCH `/v1/projects/:ref/config/database/postgrest` 200 valid body — `patchConfig` called, returns updated config
    4. PATCH 409 — `patchConfig` throws `InstanceNotRunningError` → 409
    5. GET 404 — `getProjectByRef` returns null → 404
    6. GET 401 — `requireAuth` throws `AppError('unauthorized')` → 401

**Checkpoint**: `pnpm --filter @supastack/api test -- gen-types migrations postgrest-config` — all 20 tests pass in under 30s.

---

## Phase 6: User Story 4 — Platform-Misc Black-Box Tests (Priority: P4)

**Goal**: All real-implementation platform-misc routes have happy + auth-failure (and 404 where applicable) black-box test coverage via Fastify inject.

**Independent Test**: `pnpm --filter @supastack/api test -- --reporter=verbose platform-projects platform-access-tokens platform-misc-routes` — all pass in under 30s with zero network calls.

- [X] T006 [P] [US4] Create `apps/api/tests/unit/platform-projects.test.ts`:
  - Register `platformMiscRoutes` wrapped in `fp()` + shared error handler
  - Mock `@supastack/db` with configurable fluent chain: `let selectResult: unknown[] = []`; chain returns `selectResult` for reads, no-op for writes; mock `drizzle-orm` operators as identity functions
  - Mock `@supastack/crypto` (`decryptJson: vi.fn(() => ({}))`, `loadMasterKey: vi.fn(() => Buffer.alloc(32))`, `generateRef: vi.fn(() => 'abcdefghijklmnopqrst')`)
  - Mock `auth.ts` (`requireAuth`) returning `{ userId: 'test-user', orgId: 'test-org' }`
  - Tests:
    1. GET `/platform/projects/:ref` 200 — `selectResult = [fakeInstanceRow]` → response has `ref`, `name`, `status`
    2. GET 404 — `selectResult = []` → 404
    3. GET 401 — `requireAuth` throws `AppError('unauthorized')` → 401
    4. PATCH `/platform/projects/:ref` 200 with name update — update chain called, returns updated row
    5. PATCH 200 empty body — no-op update, returns existing row
    6. PATCH 404 — `selectResult = []` → 404
    7. PATCH 401 — `requireAuth` throws → 401
    8. GET `/platform/projects/:ref/databases` 200 — response has connection info fields (`host`, `port`, `user`, `database` or similar)
    9. GET databases 404 — `selectResult = []` → 404
    10. GET databases 401 — `requireAuth` throws → 401

- [X] T007 [P] [US4] Create `apps/api/tests/unit/platform-access-tokens.test.ts`:
  - Register `platformMiscRoutes` (access-token routes)
  - Mock `@supastack/db` fluent chain (same as T006)
  - Mock `api-tokens-store.js` (`mintApiToken`) for POST
  - Mock `auth.ts` (`requireAuth`)
  - Tests:
    1. GET `/platform/profile/access-tokens` 200 — `selectResult = [fakeToken]` → response is array
    2. GET list 401 — `requireAuth` throws → 401
    3. POST `/platform/profile/access-tokens` 201 (or 200) — `mintApiToken` returns `{ id: '1', token: 'sbp_…', name: 'my-token' }` → response has `token` field
    4. POST 400 — body missing `name` → 400
    5. POST 401 — `requireAuth` throws → 401
    6. DELETE `/platform/profile/access-tokens/:id` 200 — own token deleted → 200 (or 204)
    7. DELETE 404 — `selectResult = []` → 404 (not-found-as-404)
    8. DELETE 401 — `requireAuth` throws → 401
    9. GET `/platform/profile/access-tokens/:id` 200 — `selectResult = [fakeToken]` → single token object
    10. GET single 404 — `selectResult = []` → 404
    11. GET single 401 — `requireAuth` throws → 401

- [X] T008 [US4] Create `apps/api/tests/unit/platform-misc-routes.test.ts` (notifications + available-versions + auth hooks config):
  - **Notifications + available-versions section**: Register `platformMiscRoutes`; mock `@supastack/db` chain; mock `auth.ts`
    1. GET `/platform/notifications` 200 — response is array
    2. GET notifications 401 — `requireAuth` throws → 401
    3. PATCH `/platform/notifications` 200 — mark-read succeeds → 200 (or 204)
    4. PATCH notifications 401 — `requireAuth` throws → 401
    5. GET `/platform/projects/available-versions` 200 — response is array of strings
    6. GET available-versions 401 — `requireAuth` throws → 401
  - **Auth hooks section**: Register BOTH `platformMiscRoutes` AND `authConfigRoutes` in one test Fastify app (so `app.inject()` internal delegation in the hooks routes resolves correctly)
    - Mock `project-store.js` (`getProjectByRef`)
    - Mock `runtime-config-store.js` (`getConfig`, `patchConfig`)
    - Mock `auth.ts`
    7. GET `/platform/auth/:ref/config/hooks` 200 — response body has hook-related fields (e.g. `hook_mfa_verification_attempt_enabled`, `hook_custom_access_token_enabled`, or similar hook keys)
    8. GET hooks 404 — `getProjectByRef` returns null → 404
    9. GET hooks 401 — `requireAuth` throws → 401
    10. PATCH `/platform/auth/:ref/config/hooks` 200 — `patchConfig` called with hook fields → 200
    11. PATCH hooks 404 — project not found → 404
    12. PATCH hooks 401 — `requireAuth` throws → 401

**Checkpoint**: `pnpm --filter @supastack/api test -- platform-projects platform-access-tokens platform-misc-routes` — all 33 tests pass in under 30s.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T009 [P] Verify full unit+fake-upstream suite passes: `pnpm --filter @supastack/api test -- --reporter=verbose platform-proxy-fake-upstream gen-types migrations postgrest-config platform-projects platform-access-tokens platform-misc-routes` — all ~63 new tests pass, total suite stays under 30s
- [X] T010 [P] Verify integration smoke tests skip cleanly without env vars: `pnpm test:integration` (no env vars set) — all smoke tests show as skipped, exit 0

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1–2**: Nothing to do — infrastructure exists
- **Phase 3 (US1)**: Independent — no prerequisites beyond Node.js fetch
- **Phase 4 (US2)**: Independent — only needs `TEST_KONG_BASE_URL` seam (already in place)
- **Phase 5 (US3)**: T003/T004/T005 are fully parallel — different files, different route plugins
- **Phase 6 (US4)**: T006/T007 are fully parallel; T008 depends on nothing but is sequential within itself (two sections sharing one file)
- **Phase 7**: Depends on T001–T008 complete

### User Story Dependencies

- All 4 user stories are independently implementable and deliverable
- US1 can be shipped first (highest value — no infrastructure needed for review)
- US3 tasks T003/T004/T005 are the most parallel-friendly (3 files, 3 agents)
- US4 T008 is the most complex (registers two route plugins) — leave last within US4

### Parallel Opportunities

```bash
# US3: run all three management route tests in parallel
Task: "Create gen-types.test.ts"           → T003
Task: "Create migrations.test.ts"          → T004
Task: "Create postgrest-config.test.ts"    → T005

# US4: projects + access-tokens in parallel
Task: "Create platform-projects.test.ts"        → T006
Task: "Create platform-access-tokens.test.ts"   → T007
```

---

## Implementation Strategy

### MVP First (US1 only — highest ROI)

1. Implement T001 (VM smoke test)
2. Set env vars, run against `supaviser.dev` — verify 6 proxy surfaces pass
3. **Ship**: confirms all proxy bugs from feature 112 are guarded

### Incremental Delivery

1. T001 → US1 live VM smoke (P1)
2. T002 → US2 fake-upstream (P2) — catches regressions without VM
3. T003 + T004 + T005 (parallel) → US3 management routes (P3)
4. T006 + T007 + T008 → US4 platform-misc (P4)
5. T009 + T010 → Polish / full suite green

---

## Notes

- **No source files are modified** — this is a pure test addition
- **Zero new production dependencies** — all mocking via Vitest built-ins + Node.js http
- **~80 new test cases total**: T001(6) + T002(5) + T003(6) + T004(8) + T005(6) + T006(10) + T007(11) + T008(12) + polish(2) = ~66 test cases minimum; additional edge-case assertions bring total to ~80
- [P] tasks = different files, no inter-task dependencies
- Smoke tests (T001) skip automatically when `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF` are absent — safe for CI
- Auth hooks tests (T008) must register `platformMiscRoutes` + `authConfigRoutes` together so `app.inject()` internal delegation works — this is the key constraint from research Decision 8
