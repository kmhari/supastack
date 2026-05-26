# Tasks: CLI login-role — passwordless `supabase db push`

**Input**: Design documents from `/specs/012-cli-login-role/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included (security-sensitive credential rotation; SC-004 + SC-005 + spec FR-011 dual-pass E2E require automated test coverage).

## Format

`[ID] [P?] [Story?] Description with file path`

- **[P]** — can run in parallel (different file, no in-flight dependency)
- **[Story]** — US1 / US2 / US3 per spec (US4 was dropped in /speckit-clarify)
- All paths are repo-relative
- **ID convention** — `T###` sequential. One exception: `T014b` is a follow-on to `T014` that was inserted after the initial task numbering was finalised (added by /speckit-analyze remediation for SC-007 scope). Using the `b` suffix avoids cascading every downstream ID by 1. Treat `T014b` as "the task that runs right after T014" anywhere it appears.

---

## Phase 1: Setup

**Purpose**: RBAC action + shared Zod schemas. No service or route code yet — just the contract surface both endpoints will depend on.

- [X] T001 Update `packages/shared/src/rbac.ts`: append `'database.create-login-role'` to the `ACTIONS` array (in a new commented section `// feature 012 — CLI login-role`), and set `admin: true, member: false` in the permission matrix. Mirrors the `instance.pg-password.reset` posture (Decision 10 in research.md).

- [X] T002 [P] Update `packages/shared/src/mgmt-api-schemas.ts`: add three Zod schemas matching the pinned upstream OpenAPI snapshot at `specs/012-cli-login-role/contracts/upstream-openapi-snapshot.json`:
  - `CreateLoginRoleBody = z.object({ read_only: z.boolean() }).strict()` — rejects extra fields with 400 + `invalid_request`.
  - `CreateLoginRoleResponse = z.object({ role: z.string().min(1), password: z.string().min(1), ttl_seconds: z.number().int().min(1) })` — exported for both runtime validation and TypeScript inference. **Note**: the `ttl_seconds` constraint `min(1)` mirrors upstream's OpenAPI `minimum: 1`; selfbase's runtime value is always **300** (research.md Decision 2). Add an inline TS comment `// Wire schema mirrors upstream's openapi minimum; selfbase always returns 300 — see TTL_SECONDS in cli-login-role-service.ts` so the looser-than-runtime constraint isn't mistaken for "TTL is configurable".
  - `DeleteLoginRolesResponse = z.object({ message: z.literal('ok') })` — Zod literal so any drift from `"ok"` fails the contract test.

---

## Phase 2: Foundational

**Purpose**: Pure helpers — password generator and in-memory rate-limit bucket. Both are unit-testable in isolation; shipping them first lets US1, US3, and the DELETE work proceed in parallel against a stable helper layer.

- [X] T003 [P] Create `apps/api/src/services/cli-login-role-password.ts`. Exports:
  - `generateClipassword(): string` — returns `randomBytes(32).toString('hex')`. 64 hex chars, 256 bits of entropy (research.md Decision 5). The constant `PASSWORD_BYTES = 32` is exported alongside so the unit test can assert it.

- [X] T004 [P] Create `apps/api/src/services/cli-login-role-bucket.ts`. Exports:
  - `tryConsume(key: string, limit: number, windowMs: number): { allowed: true } | { allowed: false; retryAfterSeconds: number }` — sliding-window token bucket backed by a module-level `Map`. Lazy eviction: on every call, drop entries whose `windowStart < now - 10 * windowMs`. Constants exported: `RATE_LIMIT = 30`, `WINDOW_MS = 60_000`. Pure module-level state (singleton). Test-only export: `_resetBuckets()` for vitest cleanup between tests.

- [X] T005 [P] Create `apps/api/tests/unit/cli-login-role-password.test.ts` (≥3 cases):
  - `generateClipassword()` returns a 64-char lowercase hex string matching `/^[0-9a-f]{64}$/`.
  - Two consecutive calls return distinct passwords (extremely-high-probability check; if this ever fails, the RNG is broken).
  - The output decodes to exactly 32 bytes (`Buffer.from(pw, 'hex').length === 32`).

- [X] T006 [P] Create `apps/api/tests/unit/cli-login-role-bucket.test.ts` (≥5 cases):
  - First 30 calls in a window return `allowed: true`; 31st returns `allowed: false` with positive `retryAfterSeconds ≤ 60`.
  - After advancing fake time past the window, a fresh 30 calls succeed (window resets).
  - Two distinct keys are accounted for independently (PAT A spam doesn't throttle PAT B).
  - `retryAfterSeconds` rounds up (e.g., 17.3s remaining → returns 18).
  - Idle-eviction: a key untouched for >10×windowMs is purged from the internal Map (verified by checking heap size after `_resetBuckets()` is NOT called but time advances).

**Checkpoint**: Foundation ready — US1, US3, and the DELETE handler can proceed in parallel.

---

## Phase 3: User Story 1 — Operator runs `supabase db push` with zero database password input (P1) 🎯 MVP

**Goal**: Ship the `POST /v1/projects/:ref/cli/login-role` endpoint end-to-end for the read-write path (`read_only: false`) — the exact contract the upstream `supabase` CLI binary calls when no `SUPABASE_DB_PASSWORD` or `--password` is supplied.

**Independent Test**: From a fresh shell with `unset SUPABASE_DB_PASSWORD`, run `supabase --profile selfbase.toml link --project-ref $REF && supabase db push --include-all` against a live selfbase deployment. Confirm zero password prompts and the migration applies. Then `psql` into the per-project DB and confirm exactly one `cli_login_postgres` role exists with `rolvaliduntil` in the recent past. (Maps to spec User Story 1 Acceptance Scenarios 1–4.)

### Service layer (read-write path)

- [X] T007 [US1] Create `apps/api/src/services/cli-login-role-service.ts`. Skeleton + the read-write rotation path:
  - Export const `CLI_LOGIN_ROLE_RW = 'cli_login_postgres'` and `CLI_LOGIN_TARGET_RW = 'postgres'` (mirrors upstream — research.md Decision 3).
  - Export const `TTL_SECONDS = 300` (matches upstream `interval '5 minutes'` — research.md Decision 2, spec Clarifications Q1).
  - Export `async rotateCliLoginRole(ref: string, opts: { readOnly: boolean; patId: string; requesterIp: string; logger: FastifyBaseLogger }): Promise<{ role: string; password: string; ttlSeconds: number }>`.
  - Body: pick role + target based on `readOnly` (RO path stubbed for T019); generate fresh password via `cli-login-role-password.ts`; open `withPerInstancePg(ref, async (client) => …)`; inside the callback run **one transaction** of three statements:
    1. `SELECT pg_advisory_xact_lock(hashtext($1))` with `$1 = \`${ref}:${readOnly ? 'ro' : 'rw'}\`` — research.md Decision 7. (`hashtext` is a bind-parameter-friendly function; this statement DOES support parameterised query.)
    2. The idempotent CREATE-IF-NOT-EXISTS DO block (matches upstream `role.sql` verbatim) with role name + target substituted via `pg.escapeIdentifier()`. Identifiers cannot be bind parameters in Postgres.
    3. `ALTER ROLE` — important Postgres mechanics: **`ALTER ROLE` is a utility statement and does NOT accept bind parameters for the password value or `VALID UNTIL` timestamp.** Two implementation choices, pick one:
       - **(a) Match upstream `role.sql` (server-side TTL computation, recommended)**: Wrap the ALTER ROLE in a `DO $$ ... EXECUTE format(\$\$ALTER ROLE %I WITH PASSWORD %L VALID UNTIL (now() + interval '5 minutes')\$\$, $1, $2) ... END $$;` block with **two** bind parameters (role name, password) plus the inline `now() + interval '5 minutes'` expression for the TTL. The server-side `format()` + `%I` / `%L` handles `quote_ident` / `quote_literal` safely; the inline interval matches upstream's [`role.sql`](https://github.com/supabase/cli/pull/3885/files) byte-for-byte. (TTL_SECONDS constant in the service file documents the 5-minute value, but the SQL itself uses the literal interval to stay in lockstep with upstream.)
       - **(b) Build the SQL client-side**: `\`ALTER ROLE ${pg.escapeIdentifier(roleName)} WITH PASSWORD ${pg.escapeLiteral(password)} VALID UNTIL ${pg.escapeLiteral(validUntilIso)}\`` — also safe; the 64-char-hex password contains no characters that need escaping but use `escapeLiteral` anyway for defence in depth. `validUntilIso` is `new Date(Date.now() + TTL_SECONDS * 1000).toISOString()`.
       - **Do NOT** write `'ALTER ROLE ... WITH PASSWORD $1 VALID UNTIL $2'` with bind parameters — that fails at runtime with `syntax error at or near "$1"`.
  - On success, emit `logger.info({ event: 'cli_login_role_rotated', pat_id: patId, project_ref: ref, scope: readOnly ? 'read_only' : 'read_write', requester_ip: requesterIp, role: roleName }, 'cli login role rotated')` (spec FR-013).
  - Return `{ role, password, ttlSeconds: TTL_SECONDS }`.
  - Surface errors as the existing classes `InstanceNotFoundError`, `InstanceNotRunningError`, `PerInstancePgConnectError` so the route layer can map them uniformly.

### Route layer (POST handler)

- [X] T008 [US1] Create `apps/api/src/routes/management/cli-login-role.ts` exporting `cliLoginRoleRoutes: FastifyPluginAsync`. Add the POST handler:
  - Path: `POST /projects/:ref/cli/login-role` (the `/v1` prefix comes from the parent scope).
  - Auth via `app.requireAuth(req)`; RBAC via `app.authorize(req, 'database.create-login-role')`.
  - Parse + validate body with `CreateLoginRoleBody.safeParse(req.body)` → on failure throw `ManagementApiError(422, …, 'invalid_request', { issues })`.
  - Project visibility: `getProjectByRef(user.id, req.params.ref)` → null ⇒ `ManagementApiError(404, 'Project not found', 'not_found', { ref })`. Same shape `migrations.ts` uses.
  - Rate-limit gate: `tryConsume(\`\${user.tokenId}:\${req.params.ref}\`, 30, 60_000)` → on `allowed: false` throw `ManagementApiError(429, 'rate limit exceeded', 'rate_limited', { retry_after_seconds })` AND set `reply.header('Retry-After', String(retryAfterSeconds))` — order matters; set the header before throwing.
  - Call `rotateCliLoginRole(ref, { readOnly: parsed.data.read_only, patId: user.tokenId, requesterIp: req.ip, logger: req.log })`.
  - Map per-instance-pg errors via the same `mapPgError` pattern from `migrations.ts:51-62`.
  - Return `reply.status(201).send({ role, password, ttl_seconds: ttlSeconds })`.

### Wire-up

- [X] T009 [US1] Modify `apps/api/src/server.ts`: import `cliLoginRoleRoutes` from `./routes/management/cli-login-role.js` and register inside the `/v1` mgmt scope (after `migrationsRoutes`, before the `notImplementedRoutes` catch-all). Add a comment `// Feature 012 — CLI login-role (passwordless db push)` for grep-ability.

### Integration tests (read-write happy path + error matrix)

- [X] T010 [US1] Create `apps/api/tests/integration/management-api/cli-login-role.test.ts` with fixtures for the POST endpoint. Mirror the established mgmt-api integration-test pattern (closest existing references: `apps/api/tests/integration/management-api/secrets-list.test.ts` for happy-path + error-matrix shape, `runtime-config-not-501.test.ts` for newly-introduced-route registration, `openapi-conformance.test.ts` for response-shape Zod assertions). Use `buildAuthedApp`, `seedTestUser`, `withMockInstance` from `apps/api/tests/helpers/mgmt-api.ts`:
  - **Happy path**: POST with `{ read_only: false }`, valid PAT, valid project → expect 201 + body matching `CreateLoginRoleResponse` Zod schema; assert `role === 'cli_login_postgres'`, `password` matches `/^[0-9a-f]{64}$/`, `ttl_seconds === 300`.
  - **401**: no auth header → 401 with `{ message, code: 'unauthorized' }`.
  - **403**: member-tier PAT (RBAC denies) → 403 with `code: 'forbidden'`.
  - **404**: PAT can't see the project (seed a project under a different org) → 404 with `code: 'not_found'`, response byte-identical to "project doesn't exist".
  - **409**: project not running — mock `withPerInstancePg` to throw `InstanceNotRunningError('provisioning')` (the actual surface that maps to 409 via `mapPgError`; `getProjectByRef` only gates visibility, NOT status, so mocking it does not produce a 409). Expect 409 with `code: 'project_not_running'`.
  - **422**: body missing `read_only` field → 422 with `code: 'invalid_request'`.
  - **502**: mock `withPerInstancePg` to throw `PerInstancePgConnectError` → 502 with `code: 'per_instance_pg_connect_error'`.
  - **Audit log**: capture the pino transport via a vitest-friendly buffer; assert exactly one log line emitted with `event: 'cli_login_role_rotated'`, all required fields present, AND no `password` field anywhere in the line.

- [X] T011 [US1] Add 429 + concurrency cases to `apps/api/tests/integration/management-api/cli-login-role.test.ts`:
  - **429**: 30 successful POSTs with the same PAT + project, the 31st returns 429 with `code: 'rate_limited'`, `details.retry_after_seconds` between 1 and 60, AND a `Retry-After` HTTP header set to the same integer. Call `_resetBuckets()` between unrelated tests to keep them hermetic.
  - **Distinct PATs**: PAT A makes 30 calls, PAT B's first call still succeeds.
  - **Concurrency**: fire two simultaneous POSTs against the same (PAT, project, scope) via `Promise.all`; both return 201 + valid hex passwords; second-to-finish's password is the one that authenticates against a real PG client (assert via mocked `withPerInstancePg`'s call log — both invocations ran in the same TX-with-advisory-lock pattern).

### Contract test (upstream drift detection)

- [X] T012 [P] [US1] Create `apps/api/tests/integration/management-api/cli-login-role-contract.test.ts`. Reads `specs/012-cli-login-role/contracts/upstream-openapi-snapshot.json`, builds a Zod schema from the `CreateRoleBody` + `CreateRoleResponse` definitions, and asserts that:
  - Our `CreateLoginRoleBody` Zod schema accepts every shape the upstream `CreateRoleBody` schema accepts (and rejects extras).
  - A live POST response (against the test server) passes the Zod schema built from upstream's `CreateRoleResponse`.
  - The same for `DeleteLoginRolesResponse` (will exercise after T024 ships).
  - If the snapshot JSON disagrees structurally with our handler's runtime output, this test fails and the developer must consciously update both.

### E2E (live VM)

- [X] T013 [US1] Create `tests/cli-e2e/login-role.sh` covering the POST + connect + SET ROLE + TTL-expiry chain (Acceptance Scenarios A3, A5 from the create contract):
  - Mint creds via `curl -s -X POST .../cli/login-role -d '{"read_only":false}'` → assert 201 + valid response shape via `jq`.
  - Open `psql` connection using the returned creds → run `SET SESSION ROLE postgres; SELECT 1;` → assert exit 0.
  - Sleep 320s (TTL + 20s grace) → reconnect with the same password → assert exit non-zero with stderr matching `28P01|password authentication failed`.
  - Inspect `pg_roles` for `cli_login_postgres` → assert exactly one row, `rolvaliduntil < now()`.
  - Standard `tests/cli-e2e/` env-var prelude per existing patterns (`SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, `SELFBASE_DB_SUPERUSER_PASSWORD`).

- [X] T014 [US1] Restructure `tests/cli-e2e/db-push.sh` into the dual-pass harness from spec FR-011:
  - Wrap the existing 8 steps in a `run_full_workflow()` shell function parameterised by `WITH_PASSWORD` (1 or 0).
  - When `WITH_PASSWORD=1`: keep `--password "$SELFBASE_DB_PASSWORD"` and `SUPABASE_DB_PASSWORD=…` exactly as today.
  - When `WITH_PASSWORD=0`: drop `--password` from every CLI invocation, `unset SUPABASE_DB_PASSWORD` for the function's scope.
  - At the end of the script: `WITH_PASSWORD=1 run_full_workflow && WITH_PASSWORD=0 run_full_workflow`. Either failure fails the script.
  - In Pass B, after step 4 (`db push`) succeeds, add an inline `psql` assertion that `pg_roles` shows `cli_login_postgres` exists with `rolvaliduntil < now()` (the 5-min window elapsed since the last endpoint call).

- [X] T014b [US1] Inside the `run_full_workflow()` function (added by T014), add **three new steps** between the existing `migration list` step and the cleanup step, exercising the remaining control-plane-touching `migration *` subcommands (per the SC-007 revised scope):
  1. `supabase migration fetch` → assert exit 0; assert the local `supabase/migrations/` directory now contains the file written by the earlier `db push` step.
  2. `supabase migration repair <version> --status reverted` against the throwaway migration version → assert exit 0; assert via `psql` that the row is gone from `supabase_migrations.schema_migrations`.
  3. `supabase migration repair <version> --status applied` to restore it → assert exit 0; assert the row is back. Net effect: round-trip is a no-op, but each step exercised the upsert + delete endpoints.
  - Run in both passes (Pass A's call sites get `--password`, Pass B's don't).
  - Caveat for Pass B: `migration fetch` + `migration repair` call the control-plane `GET/POST/DELETE /v1/projects/.../database/migrations[/upsert|/<version>]` endpoints which already work with PAT-only (feature 006 US2 doesn't require a DB password). So Pass B verifies the new endpoint is NOT inadvertently called for these commands either.

---

## Phase 4: User Story 2 — Existing operators who pass `--password` continue to work unchanged (P1)

**Goal**: Prove (via the dual-pass E2E from T014) that the legacy `--password` flow is byte-identical to pre-feature behaviour AND that the new endpoint is **not** called as a side effect of legacy invocations.

**Independent Test**: Pass A of `db-push.sh` (the `WITH_PASSWORD=1` run) succeeds AND the inline `pg_roles` check at its end shows zero `cli_login_*` rows on a freshly-provisioned project. (Maps to spec User Story 2 Acceptance Scenarios 1–2.)

- [X] T015 [US2] In the same `tests/cli-e2e/db-push.sh` (already touched by T014), add to Pass A only: a `psql` assertion immediately before the cleanup step that counts `cli_login_*` roles via `SELECT COUNT(*) FROM pg_roles WHERE rolname LIKE 'cli_login_%'` and asserts the count is `0`. This is the network-visible proof that the CLI's resolution logic short-circuits the endpoint call when `--password` is supplied.

- [X] T016 [P] [US2] Add a vitest integration case to `apps/api/tests/integration/management-api/cli-login-role.test.ts` that drives the route handler with a properly-formed POST and confirms (via the mocked `req.log` spy) that a single successful call produces **exactly one** log line carrying `event: 'cli_login_role_rotated'`, AND that no log line emitted by the handler (success or error path) contains the substring of the rotated password value. (FR-013 ratifies the one-line-per-success shape and the no-leak invariant; this test pins them.)

---

## Phase 5: User Story 3 — Operator restricts a CLI invocation to read-only data access (P2)

**Goal**: Add the `read_only: true` path that mints/rotates `cli_login_supabase_read_only_user` so a read-only CLI command's connection is denied writes at the Postgres level (not just by convention).

**Independent Test**: POST with `{"read_only": true}` returns 201 + `role: "cli_login_supabase_read_only_user"`. Manually opening a `psql` session with the returned creds → `SET SESSION ROLE supabase_read_only_user` succeeds → `CREATE TABLE _x()` fails with SQLSTATE 42501. (Maps to spec User Story 3 Acceptance Scenarios 1–2.)

- [X] T017 [US3] Extend `apps/api/src/services/cli-login-role-service.ts` (T007) read-only path:
  - Export `CLI_LOGIN_ROLE_RO = 'cli_login_supabase_read_only_user'` and `CLI_LOGIN_TARGET_RO = 'supabase_read_only_user'`.
  - Branch on `opts.readOnly` to pick the (role, target) pair before running the SQL. Everything else (advisory lock key, idempotent create, ALTER ROLE password, audit log emit) is unchanged — only the substituted identifiers differ.
  - Assert at compile time that `target` is one of two literal strings (TS union); use it via parameterised SQL identifier escaping (`pg.escapeIdentifier`-equivalent) since identifiers cannot be bind parameters in Postgres.

- [X] T018 [US3] Add three integration cases to `apps/api/tests/integration/management-api/cli-login-role.test.ts`:
  - POST `{"read_only": true}` → 201 + `role === 'cli_login_supabase_read_only_user'`, password format + ttl identical to RW path.
  - Audit log line for the RO call has `scope: 'read_only'`.
  - Concurrent RW + RO POSTs against the same project both succeed (different advisory-lock keys → no serialisation).

- [X] T019 [US3] Extend `tests/cli-e2e/login-role.sh` (from T013) with a read-only block:
  - POST `{"read_only": true}` → capture role + password.
  - `psql` connect → `SET SESSION ROLE supabase_read_only_user;` (assert exit 0) → `SELECT 1;` (assert exit 0).
  - In the same psql session, attempt `CREATE TABLE _ro_test (id int);` → assert exit non-zero with stderr matching `42501|permission denied`.
  - Inspect `pg_roles` → assert both `cli_login_postgres` (from the earlier RW block) AND `cli_login_supabase_read_only_user` are present.

---

## Phase 6: DELETE endpoint (cross-cutting — required by spec FR-002; ships in the same PR)

**Goal**: Add the `DELETE /v1/projects/:ref/cli/login-role` endpoint so well-behaved CLI exit paths and operator lockdown actions can invalidate active passwords without waiting for the 5-minute timer.

**Independent Test**: After a successful POST, calling DELETE returns 200 + `{message: "ok"}`. A subsequent reconnect with the previously-issued password fails immediately with 28P01. A second DELETE call is a no-op and still returns 200. (Maps to contract `cli-login-role-delete.md` D1–D5.)

- [X] T020 Extend `apps/api/src/services/cli-login-role-service.ts` with:
  - `async invalidateCliLoginRoles(ref: string, opts: { patId: string; requesterIp: string; logger: FastifyBaseLogger }): Promise<void>`.
  - Body: `withPerInstancePg(ref, …)`; inside, run one `DO $$ BEGIN IF EXISTS (…) THEN ALTER ROLE … VALID UNTIL '1970-01-01'; END IF; END $$` block per role (the body for both roles in a single round-trip to minimise latency).
  - Emit `logger.info({ event: 'cli_login_role_invalidated', pat_id, project_ref, requester_ip }, 'cli login roles invalidated')` on success.
  - Idempotent: if neither role exists, both `IF EXISTS` guards short-circuit and the function still returns successfully.

- [X] T021 Add the DELETE handler to `apps/api/src/routes/management/cli-login-role.ts` (same file as T008):
  - Path: `DELETE /projects/:ref/cli/login-role` (same path as POST, distinct method).
  - Same auth + RBAC + project visibility checks as POST (RBAC action: `database.create-login-role` — same one, per research.md Decision 10).
  - No body parsing (DELETE takes no body).
  - **No** rate-limit consumption (DELETE doesn't burn against the POST bucket — spec Phase D3 says the bucket is POST-only).
  - Call `invalidateCliLoginRoles(ref, { patId, requesterIp, logger })`.
  - Return `reply.status(200).send({ message: 'ok' })`.

- [X] T022 [P] Add DELETE integration cases to `apps/api/tests/integration/management-api/cli-login-role.test.ts`:
  - **Happy path**: DELETE after a successful POST → 200 + `{message: "ok"}`. Mock `withPerInstancePg`'s captured SQL to confirm the `ALTER ROLE … VALID UNTIL '1970-01-01'` was run twice (once per role).
  - **Idempotent on empty**: DELETE on a project that has never seen a POST → 200 + `{message: "ok"}`; no SQL `ALTER ROLE` executed (the `IF EXISTS` short-circuits).
  - **POST after DELETE recovers**: DELETE → POST → 201 with valid password; `pg_roles`'s `rolvaliduntil` is back in the future.
  - **Audit log**: one line per DELETE with `event: 'cli_login_role_invalidated'`, no password material.
  - **DELETE 401/403/404/409**: same matrix as POST (the auth/RBAC/visibility shape doesn't depend on method).

- [X] T023 Extend `tests/cli-e2e/login-role.sh` (T013) with the DELETE chain matching contract D2 + D3:
  - POST → connect (success) → `curl -X DELETE` → reconnect (assert 28P01).
  - POST → open a long-lived `psql` connection → DELETE → run `SELECT 1` through the open connection (assert exit 0 — already-authenticated connections survive `VALID UNTIL` mutation) → close → reconnect (assert 28P01).

---

## Phase 7: Polish & Cross-Cutting

- [X] T024 [P] Create `docs/changes/012-cli-login-role.md` per spec FR-012: operator-facing change doc covering the new auto flow as default, precedence rules between `--password`/`SUPABASE_DB_PASSWORD`/the new endpoint, the manual lockdown lever (DELETE endpoint + manual `ALTER ROLE VALID UNTIL`), and the security posture trade-off. Pattern from `docs/changes/010-secrets-management.md`. Reference `specs/012-cli-login-role/quickstart.md` for the verification commands rather than duplicating them.

- [X] T025 [P] Update CLAUDE.md "What's shipped" table: add a row for feature 012 with the format used by features 008/010/011. (Do this in the same commit that closes issue #31 — not before merge, so the table reflects current reality.)

- [X] T026 Make the dual-pass `db-push.sh` (T014 + T014b) write the SC-002/SC-003 evidence to two files instead of (or in addition to) printing inline: extend the script so Pass A's "zero `cli_login_*`" `psql` output goes to `tests/cli-e2e/.evidence/012-sc-002.txt` and Pass B's "exactly one `cli_login_postgres` with expired `rolvaliduntil`" output goes to `tests/cli-e2e/.evidence/012-sc-003.txt`. Both files MUST be created in every successful run; CI uploads them as PR artifacts via the existing pattern used by other E2E scripts (or, if no such pattern exists, the file paths are still useful for local-run review). This turns the "evidence capture" from a manual post-merge ritual into an automatic side effect of the test passing.

---

## Dependencies

```
Phase 1 (Setup) ── T001 ─┬─► Phase 2 (T003, T004) ─► Phase 3 (US1)
                          │                          │
                          └─► T002 (schemas) ────────┤
                                                     │
                                                     ├─► Phase 5 (US3) — depends on T007 RW skeleton
                                                     │
                                                     ├─► Phase 4 (US2) — depends on T014 from US1
                                                     │
                                                     └─► Phase 6 (DELETE) — depends on T007 service file existing
                                                                                            │
                                                                                            └─► Phase 7 (Polish)
```

**Critical path**: T001 → T002 → (T003 || T004) → T007 → T008 → T009 → T010 → T013 → T014. Everything else hangs off this.

**MVP scope** (smallest shippable increment that delivers spec User Story 1 acceptance scenarios 1–4):
- All of Phase 1 + Phase 2.
- T007, T008, T009 (service + route + wireup).
- T010 (integration tests).
- T014 (dual-pass E2E).

**Full PR scope** (closes issue #31): all 26 tasks.

---

## Parallel execution opportunities

### Within Phase 2 (Foundational)

`T003`, `T004`, `T005`, `T006` are mutually independent and operate on four different files. Run all four in parallel:

```
- T003 [P]: cli-login-role-password.ts
- T004 [P]: cli-login-role-bucket.ts
- T005 [P]: tests/unit/cli-login-role-password.test.ts
- T006 [P]: tests/unit/cli-login-role-bucket.test.ts
```

### Within Phase 3 (US1)

`T007–T009` are sequential (service → route → wireup). `T010` and `T011` add cases to the SAME test file so they're sequential. But `T012` (contract test, different file) can run in parallel with `T010–T011`:

```
T007 → T008 → T009 → T010 → T011
                          │
                          └─► T012 [P]
                          │
                          └─► T013 → T014 → T014b
```

### Across phases after T014b

`T015` (US2), all of US3 (`T017–T019`), the entirety of Phase 6 DELETE (`T020–T023`), and the Polish tasks `T024`/`T025` can run in parallel once T014b is done. `T026` is sequential after T014b on `tests/cli-e2e/db-push.sh` (same file).

```
T014 ─► T014b ──┬─► T015 [US2]
                │
                ├─► T016 [P] [US2]
                │
                ├─► T017 → T018 → T019 (US3 chain)
                │
                ├─► T020 → T021 → T022 [P] → T023 (DELETE chain)
                │
                ├─► T024 [P], T025 [P] (Polish; independent of one another)
                │
                └─► T026 (Polish; must be sequential — touches db-push.sh which T014/T014b also touched)
```

---

## Implementation strategy

1. **Iteration 1 — MVP** (US1 only):
   - Land Phase 1 + Phase 2 + T007–T014 + T014b in one PR. Hides behind no flag — the endpoint is a new path so it's inert until the CLI calls it.
   - Confirm `tests/cli-e2e/db-push.sh` (Pass B) goes green against the live VM, including the new `migration fetch` + `migration repair` round-trip steps from T014b. This is the moment selfbase achieves Cloud parity for password-less `db push`.

2. **Iteration 2 — Regression guard + read-only + lockdown** (US2 + US3 + DELETE):
   - Land T015, T016, T017–T019, T020–T023 in one PR (or two if the changes get too wide to review). All build on the Iteration 1 service file.
   - This is what makes the issue #31 acceptance complete.

3. **Iteration 3 — Polish**:
   - T024 (docs), T025 (CLAUDE.md), T026 (PR evidence). Same PR as Iteration 2 if scope is small; separate doc-only commit otherwise.

**Note on tests**: per the project pattern (specs/011-cli-device-login/tasks.md), security-sensitive features ship with both unit + integration + live-VM E2E coverage. This feature touches credential rotation → tests are non-optional and listed as first-class tasks.
