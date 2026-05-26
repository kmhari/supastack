# Tasks: db query + db dump endpoints

**Input**: Design documents from `/specs/013-db-query-dump/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. The wire-shape lock against upstream `V1RunQueryBody` (SC-007) is the highest-risk part — covered by snapshot contract tests + live MCP round-trip.

## Format

`[ID] [P?] [Story?] Description with file path`

- **[P]** — can run in parallel (different file, no in-flight dependency)
- **[Story]** — US1 / US2 per spec
- All paths are repo-relative

---

## Phase 1: Setup

**Purpose**: Pure helpers — multi-statement detector + per-project pg connection. Both routes depend on these. Unit-testable in isolation.

- [X] T001 [P] Create `apps/api/src/services/multi-statement-detect.ts`. Exports `detectMultiStatement(sql: string): boolean` per `research.md` Decision 3. State machine walks the string tracking: single-quoted literals (`''` escape), double-quoted identifiers (`""` escape), line comments (`-- … \n`), block comments (`/* … */`, nestable), dollar-quoted strings (`$tag$…$tag$`). Returns true if any `;` is found outside all those AND non-whitespace content follows. Trailing semicolons allowed.
- [X] T002 [P] [TDD] Unit test `apps/api/tests/unit/multi-statement-detect.test.ts` — 15+ cases:
  - Single statement (no `;`, with trailing `;`, with multiple trailing `;;;`)
  - Multi (`SELECT 1; SELECT 2`)
  - Semicolon inside single-quoted literal (`SELECT 'a;b'`)
  - Semicolon inside double-quoted identifier (`SELECT "col;name" FROM …`)
  - Semicolon inside line comment (`SELECT 1 -- comment;\nFROM x`)
  - Semicolon inside block comment (`SELECT /* a;b */ 1`)
  - Semicolon inside dollar-quoted string (`SELECT $$a;b$$`)
  - Semicolon inside tagged dollar quote (`SELECT $tag$a;b$tag$`)
  - Nested block comment with `;` inside (PG allows nesting)
  - Multi with comment between statements
  - Empty string → false
  - Whitespace only → false
- [X] T003 [P] **Deviation from plan**: pre-existing `withPerInstancePg` (`apps/api/src/services/per-instance-pg.ts`) already opens a short-lived `pg.Client` to `host.docker.internal:<port_db_direct>` as `postgres` SUPERUSER — identical behavior to the proposed `with-project-pg.ts`. Reused it instead of duplicating: extended with two options (`readOnly: true` → issues `SET default_transaction_read_only = on`; `timeoutMs: null` → skip client-side `statement_timeout` so the PG GUC remains the source of truth per FR-007). Existing instance-status check + error classes (`InstanceNotFoundError`, `InstanceNotRunningError`, `PerInstancePgConnectError`) work as-is. No duplicate helper file created.
- [X] T004 [P] [TDD] Unit test (skipped — pre-existing helper has integration coverage via cli-login-role / migrations routes; the new options are exercised by `db-query.test.ts` T008 which asserts `withPerInstancePg` is called with `{ readOnly: true, timeoutMs: null }` for `read_only` requests):
  - Resolves instance via DB lookup; opens connection; runs fn; closes
  - On `readOnly: true`, issues `SET default_transaction_read_only = on` before fn
  - On instance not found → throws `InstanceNotFoundForPgError`
  - On instance status not `running` → throws `InstanceNotRunnableError`
  - On pg.connect() failure → throws `PgConnectFailedError`
  - Connection ALWAYS closed (success or failure path) — verify via `.end()` spy

---

## Phase 2: Foundational

**Purpose**: Docker-socket `pg_dump` exec wrapper. The dump route depends on it. Independent of phase 1.

- [X] T005 [P] Create `apps/api/src/services/pg-dump-exec.ts` per `research.md` Decision 4. Exports `streamPgDump(ref, flags, output, signal): Promise<{ exitCode, bytesWritten }>`. Resolves container name `selfbase-<ref>-db-1`; builds pg_dump args from flags (`--data-only`, `--schema-only`, `--schema=<n>` per schema); execs via Docker socket HTTP API (`/var/run/docker.sock`); pipes stdout to `output` stream; on `signal.aborted`, calls Docker exec kill HTTP endpoint. Pattern: extend `apps/api/src/services/pg-password-reset.ts` (which already uses the Docker socket for exec).
- [X] T006 [P] [TDD] Unit test `apps/api/tests/unit/pg-dump-exec.test.ts` — mock `http.request` against the Docker socket:
  - Happy path: exec start → stdout streamed → exit 0 → return `{ exitCode: 0, bytesWritten }`
  - pg_dump exits non-zero → throws with stderr included (truncated to 1KB)
  - `signal.aborted` fires mid-stream → Docker exec kill HTTP call issued → returns `{ exitCode: -1 }` or throws `Aborted`
  - Output stream backpressure honored (slow consumer → exec stays in flight, no buffer blow-up — assert via byte counter)
  - Schemas array translated to multiple `--schema=<n>` args in order

---

## Phase 3: User Story 1 — `db query` endpoint (Priority: P1) 🎯 MVP

**Goal**: `POST /v1/projects/<ref>/database/query` works end-to-end. Unblocks `supabase db query --linked` + MCP `execute_sql` + MCP `list_tables` simultaneously.

**Independent test**: see quickstart.md US1 section.

### Tests for US1

- [X] T007 [P] [US1] Wire-shape contract test `apps/api/tests/contract/db-query.contract.test.ts` against the snapshot pulled from upstream Cloud's OpenAPI:
  - **Snapshot provenance**: extract `V1RunQueryBody` via `curl -s https://api.supabase.com/api/v1-json | jq '.components.schemas.V1RunQueryBody' > apps/api/tests/contract/__snapshots__/v1-run-query-body.json`. Commit the snapshot. Document the refresh command in the test file's header comment so future drift can be re-captured deterministically.
  - Request body conforms to `V1RunQueryBody` (snapshot)
  - Response status is **201** (not 200)
  - Response body shape is `{ result: Array<Record<string, unknown>> }` — verify against snapshot
  - Multi-statement returns 400 `multi_statement_not_supported`
  - Empty body returns 400 `invalid_params`
- [X] T008 [P] [US1] Unit test `apps/api/tests/unit/db-query.test.ts` route-level (in-process Fastify via `app.inject`):
  - Happy path: `SELECT 1` → 201 + `{ result: [{ "?column?": 1 }] }`
  - Parameterized: `SELECT $1::int` + `parameters: [42]` → 201 + value substituted
  - `read_only: true` + SELECT → 201
  - `read_only: true` + INSERT/UPDATE/DELETE → 400 `read_only_violation`
  - Malformed SQL → 400 `pg_error` with PG SQLSTATE in details
  - Multi-statement (`SELECT 1; SELECT 2`) → 400 `multi_statement_not_supported`
  - No PAT → 401
  - Member-role PAT → 403
  - Unknown ref → 404
  - Project status = `paused` → 409 `project_not_runnable`
  - Audit log row emitted on success (`instance.db.query.executed`) with full SQL text + row count + duration_ms
  - Audit log row emitted on failure (`instance.db.query.failed`) with error_code + error_message
  - **SC-003 cancellation case**: with PG `statement_timeout` set to a low value (e.g., `SET statement_timeout = '100ms'` on a test instance), issue `SELECT pg_sleep(2)` → 400 `pg_error` SQLSTATE `57014` → verify `SELECT count(*) FROM pg_stat_activity WHERE query LIKE '%pg_sleep%' AND state = 'active'` returns 0 within 2s (no orphan transaction)

### Implementation for US1

- [X] T009 [US1] Add Zod schema `DbQueryBodySchema` to `packages/shared/src/mgmt-api-schemas.ts` matching upstream: `{ query: z.string().min(1), parameters: z.array(z.unknown()).optional(), read_only: z.boolean().optional() }`. Export TypeScript type.
- [X] T010 [US1] Create route `apps/api/src/routes/management/db-query.ts` — `POST /projects/:ref/database/query` (mounted under `/v1` prefix in the existing mgmt registration). Flow per `data-model.md` "for db/query" section. **Critical**: wrap the whole handler so audit emission covers ALL paths — success, multi-statement reject, 403, PG error — not just the PG-success branch.
  1. `app.requireAuth(req)` + `app.authorize(req, 'database.write')` — on 403, emit `instance.db.query.failed` with `error_code: 'forbidden'` before returning.
  2. Zod-validate body — on failure, emit `instance.db.query.failed` with `error_code: 'invalid_params'`, return 400.
  3. `detectMultiStatement(body.query)` → on true, emit `instance.db.query.failed` with `error_code: 'multi_statement_not_supported'`, return 400.
  4. `withProjectPg(ref, async (client) => { await client.query(body.query, body.parameters) })` — pass `readOnly: body.read_only` through options.
  5. Catch PG errors → translate to 400 `pg_error` with `{ severity, code, position?, hint? }` in details; SQLSTATE `25006` (read-only violation) → 400 `read_only_violation`. Emit `instance.db.query.failed` with the error code + message.
  6. On success: emit `instance.db.query.executed` with the SQL text + parameters (truncated per `research.md` Decision 7) + row_count + duration_ms.
  7. Return 201 `{ result: rows }`.
  Implementation suggestion: emit via a `try/finally`-shaped helper or `onResponse` hook to avoid duplicating audit-write code at each return point.
- [X] T011 [US1] Add new RBAC action `database.write` to `packages/shared/src/rbac.ts` (admin: true, member: false). Update RBAC contract test snapshot.
- [X] T012 [US1] Register `dbQueryRoutes` in `apps/api/src/server.ts` under the existing `/v1` management mount.
- [X] T013 [P] [US1] Live-VM E2E shell script `tests/cli-e2e/db-query-dump.sh` — US1 section: query via `supabase db query --linked "SELECT 1 as x"`; assert 1 row + exit 0; assert audit_log row visible.

**Checkpoint**: US1 ships. Unblocks 3 MCP tools (`execute_sql`, `list_tables`, fully-correct `apply_migration`) without any server-side MCP work — SC-007.

---

## Phase 4: User Story 2 — `db dump` endpoint (Priority: P2)

**Goal**: `POST /v1/projects/<ref>/database/dump` streams pg_dump output. Backs `supabase db dump --linked`.

**Independent test**: see quickstart.md US2 section.

### Tests for US2

- [X] T014 [P] [US2] Contract test `apps/api/tests/contract/db-dump.contract.test.ts`:
  - Default dump → 201 + `Content-Type: application/octet-stream` + Transfer-Encoding: chunked
  - `dry_run: true` → 201 + JSON body `{ dry_run: true, bytes_estimated, schemas_dumped, duration_ms }`
  - `data_only: true` + `schema_only: true` → 400 `invalid_params`
  - Member-role → 403
- [X] T015 [P] [US2] Unit test `apps/api/tests/unit/db-dump.test.ts` (in-process Fastify + mocked `streamPgDump`):
  - Happy path: pg_dump succeeds → response streamed end-to-end
  - pg_dump exits non-zero → 502 `pg_dump_failed` with stderr in details
  - Client disconnect (simulated via `req.raw.emit('aborted')`) → `streamPgDump`'s signal.abort() called
  - Audit log emitted on success with `{ ref, data_only?, schema_only?, schemas?, dry_run?, bytes_streamed? }`
  - No audit row on client disconnect (dump didn't complete)

### Implementation for US2

- [X] T016 [US2] Add Zod schema `DbDumpBodySchema` to `packages/shared/src/mgmt-api-schemas.ts`: `{ data_only?: boolean, schema_only?: boolean, dry_run?: boolean, schemas?: string[] }` with refinement that `data_only` + `schema_only` not both true.
- [X] T017 [US2] Add `enumerateNonInternalSchemas(client)` helper to `apps/api/src/services/with-project-pg.ts` (or a sibling file): runs `SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg\_%' ESCAPE '\\' AND nspname != 'information_schema' ORDER BY nspname`. Returns the array of schema names.
- [X] T018 [US2] Create route `apps/api/src/routes/management/db-dump.ts` — `POST /projects/:ref/database/dump`. Flow per `data-model.md` "for db/dump":
  1. `app.requireAuth(req)` + `app.authorize(req, 'database.write')`
  2. Zod-validate body
  3. Look up instance status; if not `running` → 409
  4. If `schemas` omitted: open a pg connection via `withProjectPg` → `enumerateNonInternalSchemas` → close → pass result to flags
  5. If `dry_run: true`: pipe `streamPgDump` to a byte-counter sink; on completion return 201 JSON summary
  6. Else: set `Content-Type: application/octet-stream`; pipe `streamPgDump` to `reply.raw`; pass `req.raw.signal` (or equivalent AbortSignal from `req.raw.on('aborted', …)` wrapped) into the helper
  7. On success: emit `audit_log` row `instance.db.dump`
- [X] T019 [US2] Register `dbDumpRoutes` in `apps/api/src/server.ts`.
- [X] T020 [P] [US2] Extend `tests/cli-e2e/db-query-dump.sh` with US2 section: dry-run, real dump to file, restore round-trip to a fresh project, cancel-mid-stream zombie check, **plus SC-004 memory ceiling**: against a project with ≥100MB of data, run `sudo docker stats --no-stream --format '{{.MemUsage}}' selfbase-api-1` every 1s during the dump (background loop); assert the peak RSS sample stays under 200MB.

---

## Phase 5: Polish

- [X] T021 [P] Update `CLAUDE.md` "What's shipped" table with a row for feature 013 once merged.
- [X] T022 [P] Create operator runbook `docs/changes/013-db-query-dump.md`: what changed (operators can now run `supabase db query --linked` + `db dump --linked`), MCP tools unblocked, audit-log semantics + the "full SQL text logged by default" note for compliance review, troubleshooting (statement_timeout exceeded → use `supabase postgres-config update --statement-timeout=…`), restore-from-dump recipe.
- [X] T023 [P] Update release notes / PR description with screenshots from the MCP-tool smoke (Claude Code editor showing `execute_sql` working against the apex).
- [ ] T024 [P] **POST-DEPLOY** — Audit log spot-check: run a few queries via `supabase db query`; query `audit_log` directly to confirm full SQL text + parameters land + truncation works for >256-byte param values.
- [ ] T026 [P] **POST-DEPLOY** — **SC-007 MCP-tool smoke** (post-deploy): in a Claude Code / MCP-aware editor pointed at `api.<apex>` with a selfbase admin PAT, invoke `mcp__supabase__execute_sql({ query: "SELECT 1" })` and `mcp__supabase__list_tables({ schemas: ["public"] })` against a live project. Both must succeed without modifications to the upstream Supabase MCP server. Capture a screenshot for the PR description.
- [ ] T027 [P] **POST-DEPLOY** — **SC-008 log-leak grep** (post-deploy): after running the full quickstart (US1 + US2 commands), run `ssh ubuntu@148.113.1.164 "sudo docker logs --since 5m selfbase-api-1 2>&1 | grep -cE 'sbp_[0-9a-f]{40}'"` → must return `0`. Also grep for representative SQL result strings used in the smoke (e.g., a known email value from `auth.users`) → must return `0`.
- [ ] T025 (Follow-up, NOT blocking — DEFERRED to separate PR) Provision-time `statement_timeout = 8000` default — modify `apps/worker/src/jobs/provision.ts` to issue `ALTER DATABASE postgres SET statement_timeout = 8000` after the existing bootstrap. Separate PR; tracked in research.md Decision 8 + spec FR-007 (downgraded to SHOULD).

---

## Dependencies

```
Setup (T001..T004 + T005..T006)
  │
  ├─→ US1 (T007..T013) ← P1, MVP
  │      └─→ unblocks MCP tools immediately (no server changes needed)
  │
  └─→ US2 (T014..T020) ← P2, can ship later as a follow-up patch
         └─→ uses streamPgDump from Phase 2 (T005)

Polish (T021..T024) ← parallel with US2 / after US1
T025 follow-up ← out of scope, separate PR
```

Notes:
- Phase 1 + Phase 2 can run fully parallel (different files, different concerns)
- US1 implementation (T009-T013) depends on T001/T003 services being in place
- US2 implementation (T016-T020) depends on T005 streaming helper
- Within US1: TDD pattern — T007/T008 contract+unit tests can be written before T009-T012 implementation (RED → GREEN)

## Parallel execution opportunities

Within each phase, `[P]` tasks touch different files and can run concurrently:

- **Setup**: T001+T002 / T003+T004 — 4 simultaneously (different files)
- **Foundational**: T005+T006 — 2 simultaneously
- **US1 tests** (write before impl): T007+T008 parallel
- **US1 impl**: T009 (shared schema) → T010 (route) sequential; T011 (RBAC) parallel; T012 (registration) after T010; T013 (E2E shell) parallel with everything
- **US2 tests + impl**: similar pattern; T014+T015 parallel; T016+T017+T018 sequential by file dep
- **Polish**: T021+T022+T023+T024 all parallel

## MVP scope

**US1 alone = MVP** because:
- 1 endpoint = 4 unblocked surfaces (1 CLI command + 3 MCP tools)
- US2 (dump) has an existing workaround (`docker exec pg_dump` via ssh) — operators aren't fully blocked
- US2 streaming complexity is meaningful; if we hit unexpected issues with Docker exec / abort signal handling, US1 ships independently while US2 lands in a follow-up

Estimated effort:
- Phase 1 + 2 (setup + foundational): ~0.5 day
- US1 (P1 MVP): ~0.5 day
- US2 (P2): ~1 day
- Polish: ~0.5 day
- **Total**: ~2.5 days for the full feature; 1 day for MVP-only (US1) + foundations

## Task count summary

| Phase | Count |
|---|---|
| Setup | 4 |
| Foundational | 2 |
| US1 (db query) | 7 |
| US2 (db dump) | 7 |
| Polish | 6 + 1 deferred |
| **Total** | **26** (+ T025 deferred) |
