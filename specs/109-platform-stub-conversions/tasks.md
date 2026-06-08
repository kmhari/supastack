# Tasks: Platform Stub Conversions (Tier 1–4)

**Input**: Design documents from `specs/109-platform-stub-conversions/`

**Branch**: `109-platform-stub-conversions`

**Single-file feature**: All implementation tasks modify `apps/api/src/routes/platform-misc.ts`. New test file: `apps/api/tests/unit/platform-stub-conversions.test.ts`.

**Mock pattern reference**: See `specs/109-platform-stub-conversions/quickstart.md` for mock shapes and coverage matrix.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files or independent sections)
- **[Story]**: Which user story this task belongs to

---

## Phase 1: Setup

**Purpose**: Confirm baseline and understand stub locations before modification

- [X] T001 Run `pnpm --filter @supastack/api test` from repo root and confirm existing tests pass (baseline green)

---

## Phase 2: User Story 1 — Project Status Surfaces (Priority: P1)

**Goal**: `pause/status`, `readonly` (GET+DELETE), and `upgrade/status` return real DB state

**Independent Test**: Run `pnpm --filter @supastack/api exec vitest run tests/unit/platform-stub-conversions.test.ts`; all US1 tests pass

- [X] T002 [US1] In `apps/api/src/routes/platform-misc.ts` lines 1321–1347: extract `'/platform/projects/:ref/pause/status'` from the stub `for` loop and replace with a standalone `app.get` handler that queries `supabaseInstances` joined with `organizationMembers` (same inner-join pattern as line 1083) and returns `{ initiated_at: inst.updatedAt.toISOString() | null, status: 'not_pausing' }` — `initiated_at` is non-null only when `inst.status === 'paused'`; 404 if ref not found or user not in org

- [X] T003 [US1] In `apps/api/src/routes/platform-misc.ts` lines 3473–3481: replace the `GET /platform/projects/:ref/readonly` stub (always `{enabled:false}`) with a real handler that performs the same org-membership DB query and returns `{ enabled: inst.status === 'paused' }`; 404 on unknown ref

- [X] T004 [US1] In `apps/api/src/routes/platform-misc.ts` lines 3478–3481: replace the `DELETE /platform/projects/:ref/readonly` no-op stub (204) with a handler that calls `app.requireAuth(req)` then delegates to `POST /v1/projects/:ref/restore` via `app.inject({ method:'POST', url:\`/v1/projects/${req.params.ref}/restore\`, headers: { authorization: req.headers['authorization'] as string } })` and returns the delegated status + body verbatim

- [X] T005 [US1] In `apps/api/src/routes/platform-misc.ts` line 3672: replace the `GET /platform/projects/:ref/upgrade/status` stub (`{status:'not_upgrading'}`) with a handler that queries `supabaseInstances` with org-membership join and returns `{ status: inst.status === 'restoring' ? 'upgrading' : 'not_upgrading' }`; 404 on unknown ref

- [X] T006 [US1] Create `apps/api/tests/unit/platform-stub-conversions.test.ts` with a `vi.hoisted()` DB mock (inner-join chain returning `h.dbRows`, reject via `h.dbReject`), a `vi.hoisted()` `injectMock` for `app.inject` delegation, `buildApp()` helper registering `platformMiscRoutes` with `requireAuth`/`authorize`/`authorizeOrg` decorators and an error handler; add tests: (1) pause/status paused→initiated_at populated, (2) pause/status running→initiated_at null, (3) pause/status 401, (4) pause/status 404, (5) readonly paused→{enabled:true}, (6) readonly running→{enabled:false}, (7) readonly 401, (8) DELETE readonly delegates→200, (9) upgrade/status restoring→{status:'upgrading'}, (10) upgrade/status running→{status:'not_upgrading'}

**Checkpoint**: 10 tests for US1 pass.

---

## Phase 3: User Story 2 — Audit Log and Activity (Priority: P1)

**Goal**: `GET /platform/projects/:ref/audit` and `GET /platform/projects/:ref/activity` return real audit_log rows filtered by `targetId = ref`

**Independent Test**: US2 tests in `platform-stub-conversions.test.ts` pass

- [X] T007 [US2] In `apps/api/src/routes/platform-misc.ts` lines 3886–3889: replace the `GET /platform/projects/:ref/audit` stub (`{result:[],count:0}`) with a real handler that: (1) calls `app.requireAuth(req)`; (2) queries `supabaseInstances` with org-membership join to verify access (404 if not found); (3) reads `rows` (limit 50, `?rows=` max 200, `?page=` pagination) from `audit_log` WHERE `targetId = ref` LEFT JOIN `users` for `actorEmail`, ordered by `desc(auditLog.id)`; (4) counts total via a second query; (5) returns `{ result: rows.map(r=>({id:String(r.id), action, actor_id, actor_email, target_kind, target_id, metadata: r.payload, created_at})), count }` — pattern mirrors the org audit at line 1583

- [X] T008 [US2] In `apps/api/src/routes/platform-misc.ts` lines 3892–3895: replace the `GET /platform/projects/:ref/activity` stub (`[]`) with a handler that runs the same query as /audit but ordered ascending (`asc(auditLog.id)`) with no pagination, and returns a raw array (no `result`/`count` wrapper)

- [X] T009 [US2] In `apps/api/tests/unit/platform-stub-conversions.test.ts`: extend DB mock to support audit_log queries (second mock set for `from(auditLog)`) and add tests: (1) audit events exist → 200 `{result:[...],count:1}`, (2) audit empty → `{result:[],count:0}`, (3) audit 401, (4) audit 404, (5) activity events → `[...]`, (6) activity empty → `[]`

**Checkpoint**: 6 additional tests for US2 pass.

---

## Phase 4: User Story 3 — Downloadable Backups (Priority: P2)

**Goal**: `GET /platform/database/:ref/backups/downloadable-backups` returns completed backup entries

**Independent Test**: US3 tests in `platform-stub-conversions.test.ts` pass

- [X] T010 [US3] In `apps/api/src/routes/platform-misc.ts` line 1067–1070: replace the `GET /platform/database/:ref/backups/downloadable-backups` stub (`{backups:[]}`) with a handler that: (1) calls `app.requireAuth(req)`; (2) queries `backups` WHERE `instanceRef = ref AND status = 'completed'` ordered by `desc(backups.startedAt)` selecting `seq, startedAt, completedAt, sizeBytes`; (3) returns `{ backups: rows.map(r=>({ id:Number(r.seq??0), inserted_at:r.startedAt.toISOString(), completed_at:r.completedAt?.toISOString()??null, size_bytes:Number(r.sizeBytes??0), isPhysicalBackup:true, status:'COMPLETED' })) }` — same data source as `restore/versions` at line 1350, different shape

- [X] T011 [US3] In `apps/api/tests/unit/platform-stub-conversions.test.ts`: add tests: (1) backups exist → 200 `{backups:[{id:1,status:'COMPLETED',...}]}`, (2) no backups → `{backups:[]}`, (3) 401

**Checkpoint**: 3 additional tests for US3 pass.

---

## Phase 5: User Story 4 — Network Bans/Restrictions + SSL + Secrets Delegation (Priority: P2)

**Goal**: 8 Tier 3b endpoints delegate to `/v1` handlers via `app.inject` and return their response verbatim

**Independent Test**: US4 tests in `platform-stub-conversions.test.ts` pass

- [X] T012 [US4] In `apps/api/src/routes/platform-misc.ts` lines 3650–3658: replace `GET /platform/projects/:ref/network-bans` stub and `DELETE /platform/projects/:ref/network-bans` stub with delegation handlers using `app.inject` → `/v1/projects/:ref/network-bans` (GET) and `DELETE /v1/projects/:ref/network-bans`; forward `fwdHeaders(req)` (available at line 712); return `reply.status(resp.statusCode).send(resp.json<unknown>())`

- [X] T013 [US4] In `apps/api/src/routes/platform-misc.ts` lines 3334–3342: replace `GET /platform/projects/:ref/network-restrictions` stub and `POST /platform/projects/:ref/network-restrictions/apply` stub with delegation handlers → `/v1/projects/:ref/network-restrictions` and `/v1/projects/:ref/network-restrictions/apply`; POST forwards `payload: JSON.stringify(req.body)`

- [X] T014 [US4] In `apps/api/src/routes/platform-misc.ts` lines 3359–3367: replace `GET /platform/projects/:ref/ssl-enforcement` stub and `PUT /platform/projects/:ref/ssl-enforcement` stub with delegation handlers → `/v1/projects/:ref/ssl-enforcement` (GET) and PUT; PUT forwards body via `payload: JSON.stringify(req.body)` and `headers: fwdHeaders(req)`

- [X] T015 [US4] In `apps/api/src/routes/platform-misc.ts` lines 3609–3617: replace `GET /platform/projects/:ref/functions/secrets` stub and `POST /platform/projects/:ref/functions/secrets` stub with delegation handlers → `/v1/projects/:ref/secrets` (GET returns array) and POST (forwards body, returns 201 status from upstream)

- [X] T016 [US4] In `apps/api/tests/unit/platform-stub-conversions.test.ts`: add tests for delegation (mock `app.inject` return values): (1) GET network-bans delegates → returns upstream body, (2) DELETE network-bans delegates → 204, (3) GET network-restrictions delegates, (4) POST network-restrictions/apply delegates, (5) GET ssl-enforcement delegates → `{currentConfig:{database:false}}`, (6) PUT ssl-enforcement delegates → updated config, (7) GET functions/secrets delegates → `[]`, (8) POST functions/secrets delegates → 201

**Checkpoint**: 8 additional tests for US4 pass.

---

## Phase 6: User Story 5 — SSL Enforcement Readable and Writable (Priority: P2)

> **Note**: US5 (ssl-enforcement) is covered by T014 and T016 above as part of the Tier 3b delegation batch. No separate phase needed — US5 implementation and tests are complete after Phase 5.

---

## Phase 7: User Story 6 — Edge Function Secrets (Priority: P2)

> **Note**: US6 (functions/secrets) is covered by T015 and T016 above as part of the Tier 3b delegation batch. No separate phase needed.

---

## Phase 8: User Story 7 — Database Lint Results (Priority: P3)

**Goal**: `GET /platform/projects/:ref/run-lints` and `GET /platform/projects/:ref/run-lints/:name` execute real advisory lint queries via `withPerInstancePg`

**Independent Test**: US7 tests in `platform-stub-conversions.test.ts` pass

- [X] T017 [US7] In `apps/api/src/routes/platform-misc.ts`: define a `LINT_CHECKS` constant (above the route handlers or at top of file) containing 5 named checks with SQL and metadata — `no_rls` (tables without RLS in public schema), `duplicate_index` (same indexdef, count > 1), `unused_index` (idx_scan = 0, table not empty), `bloat` (n_dead_tup > n_live_tup * 0.1), `sequence_wraparound` (last_value/max_value > 0.8); each entry: `{ title: string, level: 'INFO'|'WARN'|'ERROR', description: string, sql: string, mapRow: (row: Record<string,unknown>) => Record<string,unknown> }`

- [X] T018 [US7] In `apps/api/src/routes/platform-misc.ts` lines 1321–1347: extract `'/platform/projects/:ref/run-lints'` from the stub `for` loop and replace with a standalone `app.get` handler that: (1) calls `app.requireAuth(req)`; (2) calls `withPerInstancePg(ref, async (pg) => { const results=[]; for (const [name,check] of Object.entries(LINT_CHECKS)) { const res = await pg.query(check.sql); results.push(...res.rows.map(row=>({name, title:check.title, level:check.level, description:check.description, metadata:check.mapRow(row)}))); } return results; })`; (3) catches `InstanceNotRunningError` → 503 `{error:'Project is not running',code:'project_not_running'}`; returns the results array

- [X] T019 [US7] In `apps/api/src/routes/platform-misc.ts` line 3119–3122: replace the `GET /platform/projects/:ref/run-lints/:name` stub (`[]`) with a handler that runs only the named check from `LINT_CHECKS` (same `withPerInstancePg` pattern), returns `[]` for unknown names and 503 if not running

- [X] T020 [US7] In `apps/api/tests/unit/platform-stub-conversions.test.ts`: add `vi.hoisted()` mock for `../../src/services/per-instance-pg.js` (`withPerInstancePg` mock + `InstanceNotRunningError` class); add tests: (1) run-lints running project → returns lint array with mapped rows, (2) run-lints all checks pass → `[]`, (3) run-lints project not running → 503 `{code:'project_not_running'}`, (4) run-lints 401, (5) run-lints/:name happy path → filtered single check, (6) run-lints/:name unknown check → `[]`

**Checkpoint**: 6 additional tests for US7 pass.

---

## Phase 9: Polish & Validation

**Purpose**: Full-suite confirmation and cleanup

- [X] T021 Run `pnpm --filter @supastack/api test` and confirm ALL new tests pass with 0 failures; total new test count ≥ 33 (10 US1 + 6 US2 + 3 US3 + 8 US4 + 6 US7 = 33)

- [X] T022 Run `git diff --name-only HEAD` and confirm only `apps/api/src/routes/platform-misc.ts`, `apps/api/tests/unit/platform-stub-conversions.test.ts`, and `specs/109-platform-stub-conversions/` paths appear — no other production files touched

- [X] T023 Verify no `/v1/*` routes were modified: `git diff HEAD -- apps/api/src/routes/management/ apps/api/src/server.ts` must show 0 changes to those files

---

## Dependencies & Execution Order

### Phase Dependencies

- **Phase 1 (Setup)**: No dependencies — start immediately
- **Phase 2 (US1)**: Depends on Phase 1; T002–T005 are sequential (same file section); T006 can begin after T002 is done (tests reference the new handlers)
- **Phase 3 (US2)**: Independent of US1 (different line ranges); T007–T008 sequential; T009 after T007
- **Phase 4 (US3)**: Independent; T010, T011 sequential
- **Phase 5 (US4)**: T012–T015 are independent of each other (different line ranges, different route paths); T016 after T012–T015
- **Phase 8 (US7)**: T017 (constant def) → T018 → T019; T020 after T018
- **Phase 9 (Polish)**: Depends on all prior phases

### Parallel Opportunities

- T002–T005 (US1) vs T007–T008 (US2) vs T010 (US3): different line ranges in `platform-misc.ts` — can theoretically run in parallel but since they edit the same file, sequential is safer
- T012, T013, T014, T015 (US4 delegation): different route registrations in non-overlapping line ranges — parallel if careful about file write conflicts
- T017 (LINT_CHECKS constant) must precede T018 and T019

---

## Implementation Strategy

### MVP First (US1 + US2 in parallel with US3)

1. Complete T001 (baseline green)
2. Implement US1 (T002–T005) — highest user-visible correctness fix (status indicators)
3. Implement US2 (T007–T008) — audit data from existing table
4. Implement US3 (T010) — backups shape fix
5. Write tests T006, T009, T011 after each implementation batch
6. Implement US4 Tier 3b delegation (T012–T015) — straightforward pattern
7. Implement US7 lint queries (T017–T019) — most complex, run last
8. Full validation T021–T023

### Notes

- `fwdHeaders` is defined at line 712 inside `platformMiscRoutes` — accessible to all handlers in the same scope
- `pause/status` and `run-lints` are currently inside a `for` loop (lines 1321–1347) — they MUST be extracted as standalone `app.get` registrations
- `run-lints/:name` is a separate stub at line 3119 — also replace in place
- `withPerInstancePg` throws `InstanceNotRunningError` if the project is not running — always catch for lint endpoints
- For delegation endpoints, `fwdHeaders(req)` strips `content-length` to avoid Content-Length mismatch when forwarding
- Tests that mock `app.inject` for delegation: decorate the Fastify app with a custom `inject` that reads from `injectMock` state rather than calling the real method
