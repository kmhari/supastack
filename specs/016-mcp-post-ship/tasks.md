# Tasks: MCP Post-Ship Hardening (Feature 016)

**Input**: Design documents from `specs/016-mcp-post-ship/`

**Branch**: `016-mcp-post-ship`

**Format**: `[ID] [P?] [Story] Description with file path`

---

## Phase 1: Setup

**Purpose**: No new deps or infra required — all packages exist. Confirm import paths before coding.

- [X] T001 Verify `pg` is already imported in `apps/worker/src/jobs/provision.ts` (check top imports; add if missing)
- [X] T002 [P] Verify `ListToolsRequestSchema` export path in `@modelcontextprotocol/sdk` — run `grep -r "ListToolsRequestSchema" apps/mcp/node_modules/@modelcontextprotocol/sdk/dist/esm/` to confirm the correct import path

---

## Phase 2: Foundational

No cross-story blockers — all four user stories are fully independent. Proceed directly to story phases.

---

## Phase 3: US1 — Statement Timeout Default at Provision (P1) 🎯 MVP

**Goal**: Every newly provisioned project automatically gets `statement_timeout = 8s` in Postgres, protecting `execute_sql` / `db query` from runaway queries.

**Independent Test**: Provision a new project → `psql -c "SHOW statement_timeout;"` → must return `8s`.

### Implementation

- [X] T003 [US1] Create `apps/worker/src/services/pg-provision-defaults.ts` — export `applyProvisionDefaults(client: pg.Client): Promise<void>` that runs `ALTER DATABASE postgres SET statement_timeout = 8000`
- [X] T004 [US1] Modify `apps/worker/src/jobs/provision.ts` — after `await handleVaultEnable({ ref, source: 'provision' })` (~line 187), open a `pg.Client` connection (same pattern as `vault-enable-job.ts`: `host.docker.internal`, `portDbDirect ?? portPostgres`, `supabase_admin`, decrypted `postgresPassword`), call `applyProvisionDefaults`, close client; import `applyProvisionDefaults` from `../services/pg-provision-defaults.js`
- [X] T005 [US1] Update `apps/worker/tests/unit/jobs/provision.test.ts` — add mock for `../../../src/services/pg-provision-defaults.js` (`applyProvisionDefaults: vi.fn()`); assert it is called once in the happy-path test; assert it is NOT called when instance status is not `provisioning`

**Checkpoint**: `pnpm --filter @supastack/worker test` green; new mock assertion passes.

---

## Phase 4: US2 — Clean MCP Tool Surface (P2)

**Goal**: `tools/list` returns ≤ 20 tools with zero phantom deferred tools (`create_project`, `get_cost`, `confirm_cost`, `get_security_advisors`, `get_performance_advisors`, `get_storage_config`, `update_storage_config`).

**Independent Test**: Run `mcp-roundtrip.sh` — the WARN line for deferred tools must be absent; tool count ≤ 20.

### Implementation

- [X] T006 [US2] Modify `apps/mcp/src/server.ts` — add module-level `DEFERRED_TOOLS` Set constant containing the 7 deferred tool names; add import for `ListToolsRequestSchema` from `@modelcontextprotocol/sdk/types.js`
- [X] T007 [US2] Modify `apps/mcp/src/server.ts` — inside the `else` branch (new session creation, after `const server = createSupabaseMcpServer({ platform })`), capture `const origListTools = (server as any)._requestHandlers?.get('tools/list')` then call `server.setRequestHandler(ListToolsRequestSchema, async (req, extra) => { const r = await origListTools(req, extra); return { ...r, tools: (r.tools ?? []).filter((t: { name: string }) => !DEFERRED_TOOLS.has(t.name)) }; })` — only install if `origListTools` is truthy
- [X] T008 [US2] Update `apps/mcp/tests/platform-build.test.ts` — add a test that calls `buildPlatform` and verifies none of the 7 deferred tool names appear in the tool schemas (import `createToolSchemas` from `@supabase/mcp-server-supabase` and pass the filtered platform; assert `Object.keys(schemas)` excludes all DEFERRED_TOOLS names)

**Checkpoint**: `pnpm --filter @supastack/mcp test` green; run `mcp-roundtrip.sh` and confirm no deferred tool warnings.

---

## Phase 5: US3 — Kong Analytics Route Template Fix (P3)

**Goal**: Newly provisioned projects have the analytics Kong route enabled out of the box. No worker job; existing project patched manually once on deploy.

**Independent Test**: Provision a new project → `curl .../analytics/endpoints/logs.all` → 200 or 503 (not 404).

### Implementation

- [X] T009 [P] [US3] Edit `infra/supabase-template/volumes/api/kong.yml` — uncomment the `analytics-v1-api` service block (lines ~312–319): remove the `  # ` prefix from each line of the block (`  # - name: analytics-v1-api`, `  #   _comment:`, `  #   url:`, `  #   routes:`, `  #     - name:`, `  #       strip_path:`, `  #       paths:`, `  #         - /analytics/v1/api/endpoints/`)
- [X] T010 [P] [US3] Edit `docs/changes/014-mcp-http-oauth.md` — replace the "One-time per-project op required for `get_logs`" section with a short note: template is now uncommented by default for new projects; existing projects need the one-liner `docker restart supastack-<ref>-kong-1` after manually uncommenting their kong.yml (remove the Python heredoc script)

**Checkpoint**: `grep "analytics-v1-api" infra/supabase-template/volumes/api/kong.yml` shows uncommented YAML (no leading `#`).

---

## Phase 6: US4 — OAuth Route-Level Tests (P4)

**Goal**: 14 route-level tests covering `GET/POST /v1/oauth/authorize` (7 cases) and `POST /v1/oauth/token` (7 cases) — catching per-error-path regressions in CI without a live VM.

**Independent Test**: `pnpm --filter @supastack/api test -- oauth-authorize oauth-token` → 14 tests pass.

### Implementation

- [X] T011 [US4] Create `apps/api/tests/unit/oauth-authorize.test.ts` with 7 cases following the `vi.hoisted + vi.mock` pattern from `oauth-register.test.ts`:
  1. GET valid session + valid params → 200 HTML containing `client_name`
  2. GET no session → 302 redirect to `/dashboard/login?next=...`
  3. GET unknown `client_id` → 400 `invalid_client`
  4. GET invalid `redirect_uri` → 400 `invalid_request`
  5. GET `code_challenge_method=plain` → 400 `invalid_request` (OAuth 2.1 hardening)
  6. POST `decision=authorize` → 302 to `redirect_uri?code=...&state=...`; audit `oauth.code.issued` emitted
  7. POST `decision=deny` → 302 to `redirect_uri?error=access_denied`; audit `oauth.consent.denied` emitted

  Mocks needed: `@supastack/db` (user row select), `../../src/services/oauth-clients-store.js` (`getClientById`, `validateRedirectUri`), `../../src/services/oauth-codes-store.js` (`issueCode`), `@supastack/shared` (logger). Session: decorate test app with `app.decorate('session', { userId: 'u1' })` for authed cases and `app.decorate('session', null)` for no-session case.

- [X] T012 [US4] Create `apps/api/tests/unit/oauth-token.test.ts` with 7 cases:
  1. `authorization_code` happy path → 200 + `access_token` (string) + `refresh_token` + `expires_in: 3600`; audit `oauth.token.issued` emitted
  2. Code reuse → 400 `invalid_grant`
  3. Wrong `code_verifier` → 400 `invalid_grant`
  4. Wrong `redirect_uri` at exchange → 400 `invalid_grant`
  5. Wrong `client_id` at exchange → 400 `invalid_grant`
  6. `refresh_token` happy path → 200 + new JWT + new refresh token; `rotateRefresh` called
  7. Refresh token reuse → 400 `invalid_grant` + `rotateRefresh` called with reuse flag

  Mocks needed: `../../src/services/oauth-codes-store.js` (`consumeCode`), `../../src/services/oauth-refresh-store.js` (`issueRefresh`, `rotateRefresh`), `../../src/services/oauth-pkce.js` (`verifyChallenge`), `@supastack/oauth` (`signAccessToken`), `@supastack/crypto` (`loadMasterKey`), `@supastack/shared` (logger). Set `process.env.SUPASTACK_APEX = 'test.local'` in `beforeEach`.

**Checkpoint**: `pnpm --filter @supastack/api test` green with 14 new passing cases.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [X] T013 [P] Mark T025, T030, T032 complete in `specs/014-mcp-http-oauth/tasks.md` (these are the tasks that were deferred and are now done in this feature)
- [X] T014 [P] Update `docs/changes/014-mcp-http-oauth.md` — update "Known limitations" section: remove item 1 (`tools/list` includes 4 deferred tools) and item 2 (`get_logs` requires manual Kong patch) since both are resolved by 016
- [X] T015 Run `pnpm --filter @supastack/api test && pnpm --filter @supastack/worker test && pnpm --filter @supastack/mcp test` — confirm full test suite green

---

## Dependencies & Execution Order

- **T001–T002** (Setup): No deps — run first, can run in parallel
- **T003–T005** (US1): Independent; T004 depends on T003
- **T006–T008** (US2): Independent; T007 depends on T006; T008 can run in parallel with T006–T007
- **T009–T010** (US3): Fully independent of all other phases — can run in parallel with US1/US2/US4
- **T011–T012** (US4): Fully independent — T011 and T012 can run in parallel
- **T013–T015** (Polish): Depend on all story phases complete

### Parallel Opportunities

All four user story phases (US1, US2, US3, US4) are independent — they touch completely different files and can be implemented concurrently.

Within US4: T011 and T012 can be written in parallel (different test files).
Within US3: T009 and T010 can be done in parallel (different files).

---

## Implementation Strategy

### MVP (US1 first — ~1h)

1. T001–T002 (Setup checks)
2. T003–T005 (US1 — statement_timeout)
3. Validate: `pnpm --filter @supastack/worker test` green
4. Can deploy immediately — no risk, 100% additive

### Full delivery order (recommended)

US1 → US2 → US3 → US4 → Polish

Or in parallel: US1 + US3 simultaneously (safe — touch different services), then US2, then US4.
