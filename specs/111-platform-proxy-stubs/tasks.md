# Tasks: Platform Proxy Stub Conversions (Feature 111)

**Input**: Design documents from `specs/111-platform-proxy-stubs/`

**Branch**: `111-platform-proxy-stubs`

**Files changed**: `apps/api/src/routes/platform-misc.ts` (4 handlers), `apps/api/src/routes/management/api-keys.ts` (2 handlers), `apps/api/tests/unit/platform-proxy-stubs.test.ts` (new, 14 tests).

**Mock pattern reference**: See `specs/111-platform-proxy-stubs/quickstart.md` for delegation scenarios and `apps/api/tests/unit/platform-stub-conversions.test.ts` for the established `vi.hoisted()` inject-mock pattern.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files or independent sections)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: Confirm baseline before modification

- [ ] T001 Run `pnpm --filter @supastack/api test` from repo root and confirm existing tests pass (baseline green)

---

## Phase 2: User Story 2 — PostgREST Config via api/rest (Priority: P1)

**Goal**: `GET /platform/projects/:ref/api/rest` returns real PostgREST config by delegating to `GET /v1/projects/:ref/postgrest`

**Independent Test**: `GET /platform/projects/myref/api/rest` returns `db_schema`, `max_rows`, `db_pool` from the runtime-config-store (not hardcoded `schema: 'public'`, `maxRows: 1000`)

- [ ] T002 [US2] In `apps/api/src/routes/platform-misc.ts` line 966: replace the `GET /platform/projects/:ref/api/rest` handler (which returns a hardcoded object with `endpoint`, `schema`, `extraSearchPath`, `maxRows`) with a delegation handler that calls `app.inject({ method: 'GET', url: \`/v1/projects/${req.params.ref}/postgrest\`, headers: fwdHeaders(req) })` and returns `reply.status(resp.statusCode).send(resp.json<unknown>())`

- [ ] T003 [US2] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: create the file with a `vi.hoisted()` inject mock (same pattern as `platform-stub-conversions.test.ts`), a `buildApp()` helper registering `platformMiscRoutes` with `requireAuth`/`authorize` decorators, and add tests: (1) GET api/rest happy path → injectMock returns `{ db_schema: 'public', max_rows: 1000 }` → verify 200 and the mock response, (2) GET api/rest 401 unauthenticated, (3) GET api/rest 404 propagated from inject mock

**Checkpoint**: 3 tests for US2 pass.

---

## Phase 3: User Story 3 — Postgres Tuning Config (Priority: P2)

**Goal**: `GET/PATCH /platform/projects/:ref/postgres-config` delegates to `GET/PATCH /v1/projects/:ref/config/database/postgres` instead of returning hardcoded defaults / echoing body

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/platform-proxy-stubs.test.ts`; all US3 tests pass

- [ ] T004 [US3] In `apps/api/src/routes/platform-misc.ts` line 886: replace the `GET /platform/projects/:ref/postgres-config` handler (returns static `{ effective_cache_size: '4096MB', ... }`) with a delegation handler: `app.inject({ method: 'GET', url: \`/v1/projects/${req.params.ref}/config/database/postgres\`, headers: fwdHeaders(req) })` → `reply.status(resp.statusCode).send(resp.json<unknown>())`

- [ ] T005 [US3] In `apps/api/src/routes/platform-misc.ts` line 897: replace the `PATCH /platform/projects/:ref/postgres-config` handler (echoes `req.body`) with a delegation handler: `app.inject({ method: 'PATCH', url: \`/v1/projects/${req.params.ref}/config/database/postgres\`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) })` → `reply.status(resp.statusCode).send(resp.json<unknown>())`

- [ ] T006 [US3] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add tests: (1) GET postgres-config happy path → inject returns `{ max_connections: 100, shared_buffers: '1024MB' }` → verify 200, (2) GET postgres-config 401, (3) PATCH postgres-config happy path → inject returns updated config → verify 200, (4) PATCH postgres-config 401

**Checkpoint**: 4 additional tests (total 7) for US3 pass.

---

## Phase 4: User Story 1 — Functions Secrets DELETE (Priority: P1)

**Goal**: `DELETE /platform/projects/:ref/functions/secrets` delegates to `DELETE /v1/projects/:ref/secrets` (the route was entirely missing — GET and POST were fixed in feature 109 but DELETE was omitted)

**Independent Test**: DELETE to `/platform/projects/myref/functions/secrets` succeeds (does not return 404 "route not found")

- [ ] T007 [US1] In `apps/api/src/routes/platform-misc.ts` after line 3760 (after the `app.post` for `/platform/projects/:ref/functions/secrets`): add a new `app.delete` handler: `app.delete<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => { app.requireAuth(req); const resp = await app.inject({ method: 'DELETE', url: \`/v1/projects/${req.params.ref}/secrets\`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) }); return reply.status(resp.statusCode).send(resp.json<unknown>()); });`

- [ ] T008 [US1] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add tests: (1) DELETE functions/secrets happy path → inject mock returns 200 → verify delegated status, (2) DELETE functions/secrets 401

**Checkpoint**: 2 additional tests (total 9) pass.

---

## Phase 5: User Story 4 — API Keys Management (Priority: P2)

**Goal**: `DELETE/PATCH /v1/projects/:ref/api-keys/:id` return 404 instead of 501 (self-hosted has no custom API key store; 404 is correct REST semantics when no matching record exists)

**Independent Test**: Both endpoints return `{ message: 'API key not found', code: 'not_found' }` with status 404

- [ ] T009 [US4] In `apps/api/src/routes/management/api-keys.ts` line 33: replace the `DELETE /projects/:ref/api-keys/:id` handler (currently throws 501 `not_implemented`) with a handler that: (1) calls `const user = app.requireAuth(req)`; (2) calls `const row = await getProjectByRef(user.id, req.params.ref)` and throws `new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref })` if not found; (3) throws `new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id })`

- [ ] T010 [US4] In `apps/api/src/routes/management/api-keys.ts` line 44: replace the `PATCH /projects/:ref/api-keys/:id` handler (currently throws 501 `not_implemented`) with the same pattern as T009

- [ ] T011 [US4] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add a separate `describe` block for the v1 api-keys routes, using a `buildApiKeysApp()` helper registering `apiKeysRoutes`; add tests: (1) DELETE api-keys/:id → 404 `not_found`, (2) DELETE api-keys/:id 401 unauthenticated, (3) DELETE api-keys/:id 404 project not found, (4) PATCH api-keys/:id → 404 `not_found`, (5) PATCH api-keys/:id 401

**Checkpoint**: 5 additional tests (total 14) pass.

---

## Phase 6: Polish & Validation

**Purpose**: Full-suite confirmation

- [ ] T012 Run `pnpm --filter @supastack/api test` and confirm ALL tests pass with 0 failures; new test count = 14; total api test suite ≥ existing count + 14

- [ ] T013 Run `git diff --name-only HEAD` and confirm only `apps/api/src/routes/platform-misc.ts`, `apps/api/src/routes/management/api-keys.ts`, `apps/api/tests/unit/platform-proxy-stubs.test.ts`, and `specs/111-platform-proxy-stubs/` paths appear — no other production files touched

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US2)**: Depends on Phase 1; T002 → T003 (test after handler)
- **Phase 3 (US3)**: T004–T005 are sequential (same file section); T006 after T004–T005
- **Phase 4 (US1)**: T007 → T008; independent of US2/US3 (different line range)
- **Phase 5 (US4)**: T009–T010 are independent of each other (different lines in api-keys.ts); T011 after T009–T010
- **Phase 6 (Polish)**: Depends on all prior phases

### Parallel Opportunities

- T002 (api/rest), T004–T005 (postgres-config), T007 (DELETE secrets), T009–T010 (api-keys) all edit different line ranges — can run in parallel if editing the file carefully, but sequential is safer for a single-file diff
- T009 and T010 are the closest to parallel-safe (different lines in `api-keys.ts`)

---

## Implementation Strategy

### MVP (US1 + US2 first — highest user-visible impact)

1. T001 (baseline)
2. T002 (api/rest delegation) → T003 (tests)
3. T007 (DELETE secrets) → T008 (tests)
4. T004–T005 (postgres-config) → T006 (tests)
5. T009–T010 (api-keys 501→404) → T011 (tests)
6. T012–T013 (full validation)

### Notes

- `fwdHeaders(req)` is defined at line 712 inside `platformMiscRoutes` — accessible to all handlers in the same scope
- The `api-keys.ts` test block needs its own `buildApiKeysApp()` (registers `apiKeysRoutes` with a mocked `getProjectByRef`) since it's a separate route file from `platform-misc.ts`
- The inject mock in the test file only needs to cover the platform-misc delegation calls; api-keys tests use DB mocks, not inject mocks
