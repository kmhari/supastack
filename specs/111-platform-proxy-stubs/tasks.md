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

- [X] T001 Run `pnpm --filter @supastack/api test` from repo root and confirm existing tests pass (baseline green)

---

## Phase 2: User Story 1 — Functions Secrets DELETE (Priority: P1)

**Goal**: `DELETE /platform/projects/:ref/functions/secrets` delegates to `DELETE /v1/projects/:ref/secrets` (the route was entirely missing — GET and POST were fixed in feature 109 but DELETE was omitted)

**Independent Test**: `DELETE /platform/projects/myref/functions/secrets` returns a delegated response instead of Fastify's default 404 "route not found"

- [X] T002 [US1] In `apps/api/src/routes/platform-misc.ts` after line 3760 (after the `app.post` for `/platform/projects/:ref/functions/secrets`): add a new `app.delete` handler: `app.delete<RefParams>('/platform/projects/:ref/functions/secrets', async (req, reply) => { app.requireAuth(req); const resp = await app.inject({ method: 'DELETE', url: \`/v1/projects/${req.params.ref}/secrets\`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) }); return reply.status(resp.statusCode).send(resp.json<unknown>()); });`

- [X] T003 [US1] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: create the file with a `vi.hoisted()` inject mock (same pattern as `platform-stub-conversions.test.ts`), a `buildApp()` helper registering `platformMiscRoutes` with `requireAuth`/`authorize` decorators, and add tests: (1) DELETE functions/secrets happy path → inject mock returns 200 → verify delegated status, (2) DELETE functions/secrets 401 unauthenticated

**Checkpoint**: 2 tests for US1 pass.

---

## Phase 3: User Story 2 — PostgREST Config via api/rest (Priority: P1)

**Goal**: `GET /platform/projects/:ref/api/rest` returns real PostgREST config by delegating to `GET /v1/projects/:ref/postgrest` instead of returning a hardcoded `{ schema: 'public', maxRows: 1000, ... }` object

**Independent Test**: `GET /platform/projects/myref/api/rest` returns the delegated v1 response (containing `db_schema`, `max_rows`, `db_pool`) rather than the hardcoded values

- [X] T004 [US2] In `apps/api/src/routes/platform-misc.ts` line 966: replace the `GET /platform/projects/:ref/api/rest` handler (which builds a `kongUrl` then returns a hardcoded object with `endpoint`, `schema`, `extraSearchPath`, `maxRows`) with a delegation handler: `app.requireAuth(req); const resp = await app.inject({ method: 'GET', url: \`/v1/projects/${req.params.ref}/postgrest\`, headers: fwdHeaders(req) }); return reply.status(resp.statusCode).send(resp.json<unknown>())`

- [X] T005 [US2] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add tests using the existing inject mock and `buildApp()` helper: (1) GET api/rest happy path → inject mock returns `{ db_schema: 'public', max_rows: 1000, db_pool: 15 }` → verify 200 and mock response returned verbatim, (2) GET api/rest 401 unauthenticated, (3) GET api/rest 404 propagated from inject mock

**Checkpoint**: 3 additional tests (total 5) for US2 pass.

---

## Phase 4: User Story 3 — Postgres Tuning Config (Priority: P2)

**Goal**: `GET/PATCH /platform/projects/:ref/postgres-config` delegates to `GET/PATCH /v1/projects/:ref/config/database/postgres` instead of returning hardcoded defaults / echoing body

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/platform-proxy-stubs.test.ts`; all US3 tests pass

- [X] T006 [US3] In `apps/api/src/routes/platform-misc.ts` line 886: replace the `GET /platform/projects/:ref/postgres-config` handler (which returns `{ effective_cache_size: '4096MB', maintenance_work_mem: '64MB', max_connections: 100, shared_buffers: '1024MB', work_mem: '16MB' }`) with a delegation handler: `app.requireAuth(req); const resp = await app.inject({ method: 'GET', url: \`/v1/projects/${req.params.ref}/config/database/postgres\`, headers: fwdHeaders(req) }); return reply.status(resp.statusCode).send(resp.json<unknown>())`

- [X] T007 [US3] In `apps/api/src/routes/platform-misc.ts` line 897: replace the `PATCH /platform/projects/:ref/postgres-config` handler (which returns `req.body ?? {}`) with a delegation handler: `app.requireAuth(req); const resp = await app.inject({ method: 'PATCH', url: \`/v1/projects/${req.params.ref}/config/database/postgres\`, headers: fwdHeaders(req), payload: JSON.stringify(req.body) }); return reply.status(resp.statusCode).send(resp.json<unknown>())`

- [X] T008 [US3] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add tests: (1) GET postgres-config happy path → inject mock returns `{ max_connections: 100, shared_buffers: '1024MB' }` → verify 200 and mock response, (2) GET postgres-config 401, (3) PATCH postgres-config happy path → inject mock returns updated config → verify 200, (4) PATCH postgres-config 401

**Checkpoint**: 4 additional tests (total 9) for US3 pass.

---

## Phase 5: User Story 4 — API Keys Management (Priority: P2)

**Goal**: `DELETE/PATCH /v1/projects/:ref/api-keys/:id` return 404 instead of 501 (self-hosted has no custom API key store; 404 is correct REST semantics — the endpoint works, the specific key is never found)

**Independent Test**: Both endpoints return `{ message: 'API key not found', code: 'not_found' }` with status 404

- [X] T009 [US4] In `apps/api/src/routes/management/api-keys.ts` line 33: replace the `DELETE /projects/:ref/api-keys/:id` handler (currently `throw new ManagementApiError(501, ...)`) with: `const user = app.requireAuth(req); const row = await getProjectByRef(user.id, req.params.ref); if (!row) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref }); throw new ManagementApiError(404, 'API key not found', 'not_found', { id: req.params.id });`

- [X] T010 [US4] In `apps/api/src/routes/management/api-keys.ts` line 44: replace the `PATCH /projects/:ref/api-keys/:id` handler (currently `throw new ManagementApiError(501, ...)`) with the same pattern as T009 — auth check, project lookup (404 if not found), then throw 404 for the key

- [X] T011 [US4] In `apps/api/tests/unit/platform-proxy-stubs.test.ts`: add a separate `describe('api-keys routes', ...)` block with a `buildApiKeysApp()` helper that registers `apiKeysRoutes` with mocked `requireAuth` and a `vi.hoisted()` mock for `../../src/services/project-store.js` (`getProjectByRef`); add tests: (1) DELETE api-keys/:id with valid project → 404 `not_found` API key, (2) DELETE api-keys/:id 401 unauthenticated, (3) DELETE api-keys/:id with unknown project ref → 404 `not_found` project, (4) PATCH api-keys/:id with valid project → 404 `not_found` API key, (5) PATCH api-keys/:id 401

**Checkpoint**: 5 additional tests (total 14) pass.

---

## Phase 6: Polish & Validation

**Purpose**: Full-suite confirmation

- [X] T012 Run `pnpm --filter @supastack/api test` and confirm ALL tests pass with 0 failures; new test count ≥ 14 (2 US1 + 3 US2 + 4 US3 + 5 US4 = 14)

- [X] T013 Run `git diff --name-only HEAD` and confirm only `apps/api/src/routes/platform-misc.ts`, `apps/api/src/routes/management/api-keys.ts`, `apps/api/tests/unit/platform-proxy-stubs.test.ts`, and `specs/111-platform-proxy-stubs/` paths appear — no other production files touched

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)**: Depends on Phase 1; T002 → T003
- **Phase 3 (US2)**: Depends on Phase 1; T004 → T005; T003 (test file creation) must exist before T005 adds to it
- **Phase 4 (US3)**: Depends on Phase 1; T006 → T007 → T008; T003 must exist before T008 adds to it
- **Phase 5 (US4)**: T009–T010 independent of each other (different lines in `api-keys.ts`); T011 after T009–T010
- **Phase 6 (Polish)**: Depends on all prior phases

### Parallel Opportunities

- T002, T004, T006–T007, T009–T010 all touch different line ranges — can run in parallel with care; sequential is safer
- T009 and T010 are the closest to parallel-safe (both in `api-keys.ts` but non-overlapping)
- Test tasks (T003, T005, T008, T011) must follow their implementation tasks

---

## Implementation Strategy

### MVP First (P1 stories: US1 + US2)

1. T001 (baseline green)
2. T002–T003 (DELETE secrets delegation + tests)
3. T004–T005 (api/rest delegation + tests)
4. T006–T008 (postgres-config delegation + tests)
5. T009–T011 (api-keys 501→404 + tests)
6. T012–T013 (full validation)

### Notes

- `fwdHeaders(req)` is defined at line 712 inside `platformMiscRoutes` — accessible to all handlers in the same scope
- The `api-keys.ts` test block needs its own `buildApiKeysApp()` (registers `apiKeysRoutes` with a mocked `getProjectByRef`) — separate from the `platformMiscRoutes`-based `buildApp()`
- The inject mock covers platform-misc delegation calls; api-keys tests use a DB mock (`getProjectByRef`) since api-keys.ts does not use `app.inject`
- US5 from spec (remaining zero-effort delegations) was researched and found to have no remaining candidates after feature 109 — no tasks needed
