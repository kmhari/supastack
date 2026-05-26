# Tasks: Hosted multi-project MCP + OAuth 2.1

**Input**: Design documents from `/specs/014-mcp-http-oauth/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included. OAuth + JWT crypto + RFC-compliant wire shapes are security-sensitive enough to warrant strict TDD.

## Format

`[ID] [P?] [Story?] Description with file path`

- **[P]** — can run in parallel (different file, no in-flight dependency)
- **[Story]** — US1..US6 per spec
- All paths are repo-relative

---

## Phase 1: Setup

**Purpose**: Add new dependencies, create new compose service skeleton, scaffold the OAuth+MCP file layout.

- [X] T001 [P] Add `@supabase/mcp-server-supabase@^0.8.1` and `@modelcontextprotocol/sdk` to `apps/mcp/package.json` (new file). Also add `fastify`, `ioredis`, `@selfbase/shared`, `@selfbase/db` as workspace deps.
- [X] T002 [P] Create `apps/mcp/Dockerfile` based on `node:20-slim` with the same monorepo build pattern as `apps/api/Dockerfile` (corepack + pnpm install + tsc build).
- [X] T003 [P] Add new compose service `selfbase-mcp` to `infra/docker-compose.yml` — depends on api + redis; exposes port 3002 internally only (not host-mapped); env vars `DATABASE_URL`, `REDIS_URL`, `MASTER_KEY`, `SELFBASE_API_URL=http://api:3001`, `SELFBASE_APEX=<from-org>`.
- [-] T004 [P] **DEFERRED to US1 runtime registration** (boot-time Caddyfile is minimal; per-host routes including mcp.<apex> are pushed at runtime by `caddy-reload.ts` — landed in Phase 3 US1) — Add Caddy route `mcp.<apex>` → `selfbase-mcp:3002` in `infra/caddy/Caddyfile`. Wildcard cert (`*.<apex>` from feature 004) already covers it — no new cert provisioning.
- [X] T005 Create the idempotent DB migration `packages/db/migrations/0NNN-oauth-tables.sql` with the 4 OAuth tables per `data-model.md` (CREATE TABLE IF NOT EXISTS oauth_clients, oauth_codes, oauth_refresh_tokens, oauth_revocations + their indices). Each statement uses IF NOT EXISTS / IF NOT EXISTS conditions per CLAUDE.md convention. **Per remediation A1**: resolve the `0NNN` prefix at impl time by `ls packages/db/migrations/ | sort | tail -1` and incrementing.
- [X] T006 [P] Add Drizzle schema for the 4 OAuth tables in `packages/db/src/schema/oauth.ts`. Export from `packages/db/src/schema.ts` index.

---

## Phase 2: Foundational

**Purpose**: Crypto primitives + Zod schemas + DB accessors + Redis revocation helper. Every user story depends on these. All unit-testable in isolation.

### Shared @selfbase/oauth package (per remediation I1)

- [X] T006a [P] Scaffold new workspace package `packages/oauth/` with `package.json` (name: `@selfbase/oauth`, depends on `@selfbase/crypto`, `ioredis`, `node:crypto`). Add to root `pnpm-workspace.yaml`. Wire TypeScript project references.

### Crypto + PKCE primitives

- [X] T007 [P] Create `packages/oauth/src/jwt.ts` (was `apps/api/src/services/oauth-jwt.ts` in earlier draft — moved per remediation I1). Exports: `signAccessToken(payload: { sub, azp, aud, scope }, ttlSec): { token, jti }` (HKDF derives HS256 key from `loadMasterKey()` with label `selfbase-oauth-jwt-v1`; emits FULL claim set sub/azp/aud/scope/jti/iat/exp/iss per FR-008), `verifyAccessToken(token): { sub, azp, aud, scope, jti, exp }` (validates signature + exp + iss + aud). Re-export from `packages/oauth/src/index.ts`.
- [X] T008 [P] [TDD] Unit test `packages/oauth/tests/jwt.test.ts`:
  - HKDF derivation is deterministic (same master key → same signing key)
  - sign + verify roundtrip yields original claims + fresh jti
  - Expired token (`exp` in past) → throws `ExpiredTokenError`
  - Wrong-signature token → throws `InvalidSignatureError`
  - Wrong `iss` → throws `InvalidIssuerError`
  - Wrong `aud` → throws `InvalidAudienceError`
  - Token includes required claims (sub, azp, scope, jti, iat, exp, iss, aud)
- [X] T009 [P] Create `apps/api/src/services/oauth-pkce.ts` per RFC 7636. Exports: `verifyChallenge(verifier: string, challenge: string): boolean` — computes `base64url(sha256(verifier))` and compares to challenge in constant time.
- [X] T010 [P] [TDD] Unit test `apps/api/tests/unit/oauth-pkce.test.ts` against the RFC 7636 §1.1 test vectors:
  - verifier `dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk` + challenge `E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM` → true
  - Mismatched pair → false
  - Empty verifier → false
  - Very short verifier (<43 chars per RFC) → false (we enforce length too)

### Zod schemas

- [X] T011 [P] Add OAuth wire-shape Zod schemas to `packages/shared/src/oauth-schemas.ts` (new file): `OAuthAuthorizeQuerySchema`, `OAuthTokenRequestSchema` (discriminated union: authorization_code | refresh_token), `OAuthRegisterRequestSchema` (RFC 7591), `OAuthDiscoveryMetadataSchema`. Export types. Re-export from `packages/shared/src/index.ts`.
- [X] T012 [P] [TDD] Unit test `apps/api/tests/unit/oauth-schemas.test.ts` covering happy paths + each documented validation failure case from contracts/oauth-*.md (response_type=code-only, S256-only PKCE, redirect_uri allow-list, scope=platform-only).

### DB accessors

- [X] T013 [P] Create `apps/api/src/services/oauth-clients-store.ts` with: `registerClient(metadata, ip): Promise<OAuthClient>`, `getClientById(client_id): Promise<OAuthClient | null>`, `validateRedirectUri(client, uri): boolean` (exact match).
- [X] T014 [P] [TDD] Unit test `apps/api/tests/unit/oauth-clients-store.test.ts` — mock `db()` from `@selfbase/db`:
  - registerClient inserts row, returns full client
  - getClientById returns null on miss
  - validateRedirectUri: exact match → true; substring match → false; trailing-slash mismatch → false
- [X] T015 [P] Create `apps/api/src/services/oauth-codes-store.ts` with: `issueCode(input: { client_id, user_id, redirect_uri, code_challenge, scope }): Promise<{ code, expires_at }>`, `consumeCode(code, redirect_uri, client_id): Promise<{ user_id, scope, code_challenge } | { error: 'expired' | 'reused' | 'mismatch' | 'unknown' }>` (atomic UPDATE … RETURNING for single-use enforcement).
- [X] T016 [P] [TDD] Unit test `apps/api/tests/unit/oauth-codes-store.test.ts`:
  - issueCode returns 256-bit opaque code + expiry now+60s
  - consumeCode happy path returns user_id + scope + challenge AND marks used
  - Second consume of same code → `reused`
  - Expired code → `expired`
  - Wrong redirect_uri at consume → `mismatch`
  - Unknown code → `unknown`
- [X] T017 [P] Create `apps/api/src/services/oauth-refresh-store.ts` with: `issueRefresh(client_id, user_id, scope, previous_token?): Promise<string>`, `rotateRefresh(old_token, client_id): Promise<{ new_token, user_id, scope } | { error: 'unknown' | 'revoked' | 'reuse_detected' }>`, `revokeRefreshByClient(client_id, user_id): Promise<number>` (returns count deleted).
- [X] T018 [P] [TDD] Unit test `apps/api/tests/unit/oauth-refresh-store.test.ts`:
  - issueRefresh returns 256-bit opaque token
  - rotateRefresh: happy path deletes old + inserts new with `previous_token=old`
  - rotateRefresh: presenting a `previous_token` that has already been replaced → `reuse_detected` + revokes the entire grant
  - rotateRefresh: revoked token → `revoked`
  - rotateRefresh: unknown token → `unknown`
  - revokeRefreshByClient deletes all rows for the (user, client) pair

### Redis revocation helper

- [X] T019 [P] Create `packages/oauth/src/revocation.ts` (moved into shared `@selfbase/oauth` per remediation I1) with: `revoke(redis, jti, remainingSec): Promise<void>` (Redis `SET selfbase:oauth:revoked:<jti> "1" EX <ttl>`), `isRevoked(redis, jti): Promise<boolean>` (Redis `EXISTS`). Takes the redis client as a param (caller-injected) so the package stays redis-driver-agnostic.
- [X] T020 [P] [TDD] Unit test `packages/oauth/tests/revocation.test.ts` with the same in-memory FakeRedis pattern used in `apps/api/tests/unit/cli-login-routes.test.ts`:
  - revoke then isRevoked → true within 100ms
  - After TTL elapses → isRevoked → false
  - Different jti → independent
  - Concurrent revoke + check → still correct

### Auth plugin (dual-credential) + status mapper

- [X] T021 Modify `apps/api/src/plugins/auth.ts` to accept BOTH `sbp_…` PAT bearers AND OAuth JWT bearers (per FR-010). Detection: PAT prefix `sbp_` (existing path); else attempt JWT verify via `@selfbase/oauth` `verifyAccessToken` → fall through to PAT path on failure for backward compat. On JWT path, perform Redis revocation check via `@selfbase/oauth` `isRevoked` BEFORE returning the user. **Per remediation C1 (SC-007)**: after JWT verify + Redis check, re-fetch the `users` row by `sub` claim and reject (401 `user_inactive`) if the row is missing, `removed_at IS NOT NULL`, or any equivalent inactive marker. Resolved user_id is identical between credential types for downstream code.
- [X] T022 [P] [TDD] Unit test `apps/api/tests/unit/auth-plugin-dual.test.ts`:
  - Valid PAT → resolves to user (existing behavior)
  - Valid OAuth JWT → resolves to same user_id structure
  - Revoked JWT (jti in Redis) → 401
  - Expired JWT → 401
  - Malformed bearer → 401
  - Missing bearer → 401
  - **Per remediation C1**: Valid OAuth JWT whose `sub` references a removed/inactive user → 401 `user_inactive`. (Covers SC-007 propagation < 60s — happens on the NEXT request after member removal.)
  - Existing PAT-only tests still pass (regression)
- [X] T023 [P] Create `apps/api/src/services/project-status-mapper.ts` per research.md Decision 8. Exports `mapSelfbaseStatusToCloud(s: string): string` with the documented mapping. Unit-test inline if simple enough.
- [X] T024 [P] [TDD] Unit test `apps/api/tests/unit/project-status-mapper.test.ts` — every selfbase status maps to the documented Cloud enum; unknown input → `UNKNOWN`.

### Cleanup worker jobs (per remediation C2 + FR-024a)

- [X] T024a [P] Create `apps/worker/src/jobs/cleanup-oauth-codes.ts` — BullMQ repeatable job, 1-minute interval. Body: `DELETE FROM oauth_codes WHERE expires_at < now()`. Idempotent + safe to overlap. Logs count deleted.
- [X] T024b [P] Create `apps/worker/src/jobs/cleanup-oauth-refresh.ts` — BullMQ repeatable job, 1-hour interval. Body: `DELETE FROM oauth_refresh_tokens WHERE last_used_at < now() - interval '30 days' AND revoked_at IS NULL`. Logs count deleted.
- [X] T024c Register both repeatable jobs in `apps/worker/src/main.ts` boot: `queue.upsertJobScheduler('cleanup-oauth-codes', { every: 60_000 }, …)` and `queue.upsertJobScheduler('cleanup-oauth-refresh', { pattern: '0 * * * *', tz: 'UTC' }, …)`. Pattern matches the existing daily-cert-check pattern.
- [X] T024d [P] [TDD] Unit test `apps/worker/tests/unit/cleanup-oauth-codes.test.ts` + `apps/worker/tests/unit/cleanup-oauth-refresh.test.ts` — mock db(); seed 5 expired + 3 fresh rows; assert only expired deleted; assert idempotent (second invocation deletes 0).

**Checkpoint**: All foundational primitives unit-tested. User-story phases can now run in parallel.

---

## Phase 3: User Story 1 — Operator OAuth dance + MCP first call (Priority: P1) 🎯 MVP

**Goal**: Operator pastes `https://mcp.<apex>/mcp` into their MCP client, clicks Authorize in the browser, makes the first successful `list_projects` LLM tool call.

**Independent test**: see quickstart.md US1 section.

### OAuth server endpoints

- [X] T025 [US1] Create `apps/api/src/routes/oauth/discovery.ts` exposing `GET /.well-known/oauth-authorization-server` per RFC 8414. Read apex from org row at startup; emit the documented JSON shape per `contracts/oauth-discovery-endpoints.md`.
- [X] T026 [P] [US1] [TDD] Contract test `apps/api/tests/contract/oauth-discovery.contract.test.ts`:
  - Response shape matches RFC 8414 required fields
  - All endpoint URLs use `https://api.<configured-apex>`
  - `code_challenge_methods_supported` = `["S256"]` only (no `plain`)
  - `scopes_supported` = `["platform"]`
- [X] T027 [US1] Create `apps/api/src/routes/oauth/register.ts` exposing `POST /v1/oauth/register` per `contracts/oauth-register-endpoint.md`. Uses `oauth-clients-store.ts`. Rate-limit via `cli-login-role-bucket.ts` pattern (or generalize that bucket helper to a shared rate-limiter), keyed by IP, 10/hour.
- [X] T028 [P] [US1] [TDD] Unit test `apps/api/tests/unit/oauth-register.test.ts`:
  - Valid minimal request → 201 + uuid client_id; row inserted; audit emitted
  - Missing `redirect_uris` → 400 `invalid_client_metadata`
  - `redirect_uri` with `javascript:` scheme → 400 `invalid_redirect_uri`
  - `client_name` >200 chars → 400 `invalid_client_metadata`
  - 11th request from same IP within 1h → 429 `rate_limited` + Retry-After header
- [X] T029 [US1] Create `apps/api/src/routes/oauth/authorize.ts` exposing `GET /v1/oauth/authorize` per `contracts/oauth-authorize-endpoint.md`. Renders consent UI (server-side HTML for v1 — simpler than React route, can be promoted later). On Authorize POST: insert oauth_codes row + 302 to redirect_uri with code. On Deny: 302 with `error=access_denied`. Session anchor: reuse existing dashboard session cookie validation (no new authn). **Per remediation A2 + FR-024b**: on missing session, 302 to `https://<apex>/dashboard/login?next=<urlencoded-path>` where the path is validated to start with `/v1/oauth/authorize` (same-origin guard against open-redirect); the encoded next param MUST be ≤4096 bytes. On successful login, the dashboard login flow uses the existing safe-next helper from feature 011 (`apps/web/src/lib/safe-next.ts`) to bounce back.
- [X] T030 [P] [US1] [TDD] Unit test `apps/api/tests/unit/oauth-authorize.test.ts`:
  - Valid request + valid session cookie → 200 + HTML containing the client_name + scope label
  - Valid request, no session → 302 to `/dashboard/login?next=…`
  - Invalid client_id → 400 `invalid_client`
  - Invalid redirect_uri (not in allow-list) → 400 `invalid_request` (do NOT redirect — security per RFC 6749 §4.1.2.1)
  - `code_challenge_method=plain` → 400 `invalid_request`
  - Authorize POST: row inserted in oauth_codes, 302 with code, audit emitted
  - Deny POST: no row, 302 with error=access_denied, audit emitted
- [X] T031 [US1] Create `apps/api/src/routes/oauth/token.ts` exposing `POST /v1/oauth/token` per `contracts/oauth-token-endpoint.md`. Handles both grant types. Issues JWT via `oauth-jwt.signAccessToken` + refresh token via `oauth-refresh-store.issueRefresh`. On reuse-detection: revoke grant + revoke active jti via `oauth-revocation.revoke`.
- [X] T032 [P] [US1] [TDD] Unit test `apps/api/tests/unit/oauth-token.test.ts`:
  - authorization_code happy path: returns access_token (JWT) + refresh_token + expires_in=3600 + scope; code marked used; audit emitted
  - Code reuse → 400 `invalid_grant`
  - Wrong code_verifier → 400 `invalid_grant`
  - Wrong redirect_uri → 400 `invalid_grant`
  - Wrong client_id → 400 `invalid_grant`
  - refresh_token happy path: new JWT + new refresh; old refresh row gone; audit `oauth.token.refreshed`
  - Refresh reuse → 400 `invalid_grant` + grant revoked + Redis revocation populated
- [X] T033 [US1] Register OAuth routes in `apps/api/src/server.ts` — discovery at `/.well-known/oauth-authorization-server`, the three `/v1/oauth/*` endpoints inside the existing `/v1` management mount (BEFORE the not-implemented catch-all).

### MCP service skeleton + auth + multi-project surface

- [X] T034 [US1] Create `apps/mcp/src/server.ts` — Fastify app, mounts `POST /mcp` + `GET /.well-known/oauth-protected-resource` per `contracts/oauth-discovery-endpoints.md`. Listen on port 3002.
- [X] T035 [US1] Create `apps/mcp/src/bearer-auth.ts` — extracts `Authorization: Bearer <jwt>`, verifies via `@selfbase/api`'s `oauth-jwt.ts` helper (or duplicate the verify logic in mcp service if cross-package import is awkward — see plan.md for package boundary call). On invalid/expired/revoked: 401 + `WWW-Authenticate: Bearer ...` header per RFC 6750. Performs Redis `oauth-revocation.isRevoked` check.
- [X] T036 [P] [US1] [TDD] Unit test `apps/mcp/tests/unit/bearer-auth.test.ts`:
  - Valid JWT → returns resolved user_id
  - Expired → 401 + WWW-Authenticate header includes `authorization_uri`
  - Revoked (jti in fake Redis) → 401 + invalid_token error in body
  - Missing bearer → 401
- [X] T037 [US1] Create `apps/mcp/src/platform-build.ts` — exports `buildPlatform(accessToken: string): SupabasePlatform`. Calls upstream `createSupabaseApiPlatform({ accessToken, apiUrl: process.env.SELFBASE_API_URL })`. Strips deferred operation groups: `delete platform.debugging?.getAdvisors; delete platform.storage?.getStorageConfig; delete platform.storage?.updateStorageConfig; delete platform.account?.createProject; delete platform.account?.getCost; delete platform.account?.confirmCost; delete platform.branching;` **Per remediation I3**: at the top of this file, add a TypeScript const block that imports the upstream operation-group types (`AccountOperations`, `DebuggingOperations`, `StorageOperations` from `@supabase/mcp-server-supabase/platform`) and references each property name being stripped (e.g. `const _typecheck: keyof AccountOperations = 'createProject'`). This compile-time-fails if upstream renames a property.
- [X] T038 [P] [US1] [TDD] Unit test `apps/mcp/tests/unit/platform-build.test.ts`:
  - Returns a platform object
  - `platform.branching` is undefined
  - `platform.debugging?.getAdvisors` is undefined (but `getLogs` is preserved — US4)
  - `platform.storage?.getStorageConfig` is undefined (but `listBuckets` is preserved — US5)
  - `platform.account?.createProject` is undefined (but `listProjects`, `pauseProject`, `restoreProject` are preserved — US6)
- [X] T039 [US1] Wire the MCP handler in `apps/mcp/src/server.ts`: `POST /mcp` → bearer-auth → session lookup (in-memory Map, 30min idle TTL with background sweeper) → on cache-miss: `buildPlatform()` + `createSupabaseMcpServer({platform})` + `new StreamableHTTPServerTransport({sessionIdGenerator: () => randomUUID(), enableJsonResponse: true})` → `server.connect(transport)` → `transport.handleRequest(req.raw, reply.raw, req.body)`. Emit `mcp.session.opened` audit on new session, `mcp.tool.invoked` on tools/call.
- [X] T040 [P] [US1] [TDD] Integration test `apps/mcp/tests/unit/mcp-server.integration.test.ts`:
  - In-process Fastify + stub platform (`listProjects` returns 2 projects)
  - JSON-RPC `tools/list` → returns tools including `list_projects`, `execute_sql`, …
  - JSON-RPC `tools/call` for `list_projects` → returns 2 projects in response.content
  - Same `mcp-session-id` → reuses the SAME platform instance (verify via instrumented constructor call count)
  - No `mcp-session-id` → new session minted; response header includes new id

### Dashboard consent UI (server-rendered HTML for v1)

- [X] T041 [US1] In `apps/api/src/routes/oauth/authorize.ts`, embed a minimal inline HTML template for the consent page. Includes: client_name, requested scope label, operator identity (from session), Authorize + Deny form buttons (POST to same endpoint). CSP-safe (no inline JS); pure form submission. Use existing selfbase brand colors via inline style sheet.

### Live-VM end-to-end smoke

- [X] T042 [P] [US1] Create `tests/cli-e2e/oauth-dance.sh` — performs the wire-level OAuth flow without a browser: register a fresh client → fabricate a dashboard session cookie via the existing test-helper or use a headless browser → call authorize → simulate consent → exchange code → assert JWT shape → use JWT to call `GET /v1/oauth/authorize/test` (or any authed endpoint that exercises the dual-auth plugin).
- [X] T043 [P] [US1] Create `tests/cli-e2e/mcp-roundtrip.sh` — extends `/tmp/mcp-smoke.mjs` from the earlier deploy-verify work: use an OAuth-issued JWT (not a PAT) as Bearer; assert `tools/list` returns the in-scope tools and ONLY them; assert `tools/call list_projects` works; assert `tools/call execute_sql` works.

**Checkpoint**: US1 ships. The full OAuth dance + MCP `list_projects` + MCP `execute_sql` work end-to-end against the deployed VM through an unmodified MCP client.

---

## Phase 4: User Story 2 — Dynamic Client Registration (Priority: P2)

**Goal**: Unknown MCP clients self-register via `POST /v1/oauth/register` per RFC 7591.

**Independent test**: see quickstart.md US2 section. Most of US2's surface is already covered by T027 + T028 in US1's foundation (the `register.ts` route is reusable). The US2-specific work is the end-to-end demonstration + rate-limit hardening.

- [ ] T044 [P] [US2] [TDD] Extend `apps/api/tests/unit/oauth-register.test.ts` with additional cases:
  - Multiple registrations from same IP within rate limit → all succeed with distinct client_ids
  - Concurrent registration attempts (race) → no duplicate inserts; both get unique ids
  - `metadata` extras (logo_uri, tos_uri) preserved in DB but NOT echoed in response (yet)
- [ ] T045 [US2] Live-VM smoke section in `tests/cli-e2e/oauth-dance.sh`: register a bespoke client + complete full OAuth flow + use the issued token → all green. Add the bespoke client to a follow-up dashboard list check (US3).

---

## Phase 5: User Story 3 — Dashboard MCP-clients page + revoke (Priority: P2)

**Goal**: Operator sees + revokes authorized MCP clients from the dashboard. Revoke takes effect <5s.

**Independent test**: see quickstart.md US3 section.

### Dashboard API

- [ ] T046 [US3] Create `apps/api/src/routes/oauth/clients-list.ts` — `GET /api/v1/oauth/clients` (dashboard route, NOT `/v1/oauth`). Returns the operator's authorized clients: `[{ client_id, client_name, authorized_at, last_used_at, scope }]` joined from `oauth_clients` + `oauth_refresh_tokens` (one row per active grant).
- [ ] T047 [US3] Create `apps/api/src/routes/oauth/client-revoke.ts` — `DELETE /api/v1/oauth/clients/:client_id` (dashboard route). RBAC: only the operator who authorized this grant (no admin override needed for v1). Flow:
  1. Delete all `oauth_refresh_tokens` for (user, client) — capture jtis of most-recent grants
  2. INSERT `oauth_revocations` audit rows for each captured jti
  3. Redis: `SET selfbase:oauth:revoked:<jti> "1" EX <remaining_seconds>` for each captured jti
  4. Audit `oauth.token.revoked` with reason `operator_action`
  5. Return 200 `{ revoked: <count> }`
- [ ] T048 [P] [US3] [TDD] Unit test `apps/api/tests/unit/oauth-revocation.test.ts` (extends T020) — full revoke flow:
  - DELETE removes refresh rows
  - DELETE adds jti to Redis revocation
  - Subsequent token-endpoint refresh attempt → 400 `invalid_grant`
  - Subsequent `/v1/*` call with access JWT → 401 (within 100ms — measure)

### Dashboard UI

- [ ] T049 [US3] Create `apps/web/src/pages/SettingsMcpClients.tsx` — list view + Revoke button per client. Uses existing dashboard layout (look at `apps/web/src/pages/SettingsCli.tsx` for pattern). Shows: client_name, authorized_at (relative time), last_used_at, scope, Revoke button (with confirm dialog).
- [ ] T050 [US3] Add route `/settings/mcp-clients` to the dashboard router (extend `apps/web/src/App.tsx` or equivalent). Add nav link in the settings sidebar matching the existing `/settings/cli` entry.
- [ ] T051 [US3] Add a brief setup walkthrough at `/settings/mcp` (or extend `/settings/cli` with a Section 7) — copy-button-ready MCP client config for the major clients (Claude Code, Cursor, Windsurf), each pointing at `https://mcp.<apex>/mcp`. Update `docs/changes/014-mcp-http-oauth.md` (T065) to reference this page.

### Live-VM smoke

- [ ] T052 [P] [US3] Extend `tests/cli-e2e/mcp-roundtrip.sh` with the revoke scenario: authorize → use token → click Revoke (via API) → assert next token use → 401 within 5s. Use `time` to measure propagation latency for SC-004.

---

## Phase 6: User Story 4 — get_logs (Priority: P2)

**Goal**: `get_logs` MCP tool works against the per-project analytics container.

**Independent test**: see quickstart.md US4 section + `contracts/logs-endpoint.md` test obligations.

- [ ] T053 [US4] Create `apps/api/src/services/logflare-client.ts` — `queryLogs(ref, { service, iso_timestamp_start, iso_timestamp_end, sql? }): Promise<Array<Record<string, unknown>>>`. Resolves analytics container address (`selfbase-<ref>-analytics-1:4000`); decrypts `logflareApiKey` via existing master-key helpers; constructs SQL from service+time-range OR forwards `sql` verbatim; HTTP POST to Logflare API; returns rows.
- [ ] T054 [P] [US4] [TDD] Unit test `apps/api/tests/unit/logflare-client.test.ts` — mock fetch:
  - service=api → constructs SELECT from edge_logs with time-range
  - service=postgres → constructs SELECT from postgres_logs
  - verbatim sql passes through unmodified
  - Logflare 5xx → throws AnalyticsUnreachableError
  - Logflare malformed JSON → throws AnalyticsBadGatewayError
  - HTTP X-API-KEY header carries the decrypted key
- [ ] T055 [US4] Create `apps/api/src/routes/management/logs.ts` — `GET /v1/projects/:ref/analytics/endpoints/logs.all` per `contracts/logs-endpoint.md`. Auth + RBAC (`audit.read`). Project status check (running). Calls `logflare-client.queryLogs()`. Returns `{ result: rows }`.
- [ ] T056 [P] [US4] [TDD] Unit test `apps/api/tests/unit/logs.test.ts` route-level (in-process Fastify + mocked logflare-client):
  - Happy path → 200 + { result: [...] }
  - Invalid service → 400 invalid_params
  - Paused project → 409 project_not_runnable
  - logflare unreachable → 503 analytics_unreachable
  - No auth → 401
  - Member-role lacking `audit.read` → 403
- [ ] T057 [US4] Register `logs` route in `apps/api/src/server.ts`. Also add to plan-time tests via the dual-auth plugin (verify with both PAT and OAuth bearer that the endpoint accepts both — likely already covered by T022 regression suite).
- [ ] T058 [P] [US4] Extend `tests/cli-e2e/mcp-roundtrip.sh` with a `get_logs` round-trip via MCP: call tools/call get_logs → expect rows from a recent edge function invocation; assert SC-011 (<3s latency).

---

## Phase 7: User Story 5 — list_storage_buckets (Priority: P2)

**Goal**: `list_storage_buckets` MCP tool returns bucket metadata from the per-project storage container.

**Independent test**: see quickstart.md US5 section + `contracts/storage-buckets-endpoint.md` test obligations.

- [ ] T059 [US5] Create `apps/api/src/services/service-role-jwt.ts` — `mintServiceRoleJwt(ref): Promise<string>` (HS256 with project's per-instance `jwtSecret`, 24h TTL, in-process LRU cache keyed by ref). If a similar helper already exists in credentials-reveal infra, factor it out instead of duplicating.
- [ ] T060 [P] [US5] [TDD] Unit test `apps/api/tests/unit/service-role-jwt.test.ts`:
  - Returns valid HS256 JWT with `role: "service_role"`, exp = now+24h
  - Second call within 24h returns cached token (verify via secret-decrypt call count)
  - After 24h, fresh mint
  - Different ref → different JWT (no cache cross-contamination)
- [ ] T061 [US5] Create `apps/api/src/services/storage-buckets-proxy.ts` — `listBuckets(ref): Promise<BucketRow[]>`. Mints service-role JWT, fetches `http://selfbase-<ref>-storage-1:5000/bucket` with that JWT as Bearer, returns the bare-array response.
- [ ] T062 [US5] Create `apps/api/src/routes/management/storage-buckets.ts` — `GET /v1/projects/:ref/storage/buckets`. Auth + RBAC (`instance.read`). Project status check. Calls `storage-buckets-proxy.listBuckets()`. Returns bare-array per `contracts/storage-buckets-endpoint.md`.
- [ ] T063 [P] [US5] [TDD] Unit test `apps/api/tests/unit/storage-buckets.test.ts`:
  - Happy path → 200 + bare-array of buckets
  - Empty buckets → 200 + `[]`
  - Paused project → 409
  - storage container unreachable → 503 storage_unreachable
  - storage 500 with malformed JSON → 502 storage_bad_gateway
  - No auth → 401
  - Member-role → 200 (read-only — `instance.read` allowed)
- [ ] T064 [P] [US5] Extend `tests/cli-e2e/mcp-roundtrip.sh` with a `list_storage_buckets` round-trip via MCP — expects ≥1 bucket on the test project; assert SC-012 (<2s).

---

## Phase 8: User Story 6 — pause_project + restore_project (Priority: P2)

**Goal**: Operator can pause + restore projects via MCP.

**Independent test**: see quickstart.md US6 section + `contracts/pause-restore-endpoints.md` test obligations.

- [ ] T065 [US6] Create `apps/api/src/routes/management/pause-restore.ts` — `POST /v1/projects/:ref/pause` + `POST /v1/projects/:ref/restore`. Auth + RBAC (`instance.pause` / `instance.resume`). Idempotent state checks per contract. Enqueue lifecycle-pause / lifecycle-resume worker jobs via existing `enqueueLifecycleJob` helper (or whatever the existing pattern is — inspect `apps/worker/src/jobs/lifecycle.ts`). UPDATE `supabase_instances.status`. Return project JSON with status mapped via `mapSelfbaseStatusToCloud`.
- [ ] T066 [P] [US6] [TDD] Unit test `apps/api/tests/unit/pause-restore.test.ts`:
  - Pause running project → 200 + status `INACTIVE`; worker enqueue called
  - Pause paused project → 200 + status `INACTIVE`; worker NOT called (idempotent)
  - Restore paused project → 200 + status `COMING_UP`; worker enqueue called
  - Restore running project → 200 + status `ACTIVE_HEALTHY`; idempotent
  - Member-role token → 403 on both
  - Unknown ref → 404
  - Audit `instance.pause` / `instance.resume` emitted
  - **Per remediation C3**: pause-during-backup → mock a `backup_jobs` row with status `running` for the target ref → assert 409 `backup_in_progress` returned + worker NOT enqueued + status row unchanged
- [ ] T067 [US6] Apply `mapSelfbaseStatusToCloud` to the existing `GET /v1/projects` + `GET /v1/projects/:ref` handlers in `apps/api/src/routes/management/projects.ts` (per FR-036 + Decision 8). Update existing tests for `projects.ts` to expect the Cloud-shape enum values.
- [ ] T068 [P] [US6] [TDD] Extend `apps/api/tests/contract/instances-list-get.test.ts` or `apps/api/tests/unit/mgmt-api-mapping.test.ts` to assert every project response (list + single get) uses Cloud-enum status values.
- [ ] T069 [US6] Register `pause-restore` routes in `apps/api/src/server.ts`.
- [ ] T070 [P] [US6] Extend `tests/cli-e2e/mcp-roundtrip.sh` with pause + restore round-trip via MCP: pause → wait → status=INACTIVE; restore → poll until status=ACTIVE_HEALTHY; assert SC-013 timings.

---

## Phase 9: Polish

- [ ] T071 [P] Create operator runbook `docs/changes/014-mcp-http-oauth.md`: what changed (OAuth login + hosted MCP), how operators configure their MCP client, the OAuth dance walkthrough with screenshots, the revoke workflow, the new in-scope tools (get_logs, list_storage_buckets, pause/restore), deferred tools and where to track them (features 016/017/018 + issue #41), troubleshooting (DCR rate-limit, JWT verification failures, Redis revocation propagation).
- [ ] T072 [P] Update `CLAUDE.md` "What's shipped" table with a row for feature 014 once merged. Update the "Active feature plan" pointer.
- [ ] T073 [P] **POST-DEPLOY** — Multi-MCP-client smoke (SC-005): authorize Claude Code + Cursor + Windsurf simultaneously against the deployed VM; verify each gets a unique client_id via DCR; verify each can run `execute_sql` concurrently without cross-talk. Capture screenshots for the PR.
- [ ] T074 [P] **POST-DEPLOY** — Memory ceiling check (SC-009): drive 20 concurrent OAuth sessions via the smoke script in a loop; `docker stats selfbase-mcp-1` peak RSS MUST stay <150 MiB.
- [ ] T075 [P] **POST-DEPLOY** — Log-leak grep (SC-008): after the full quickstart, `docker logs --since 10m selfbase-api-1 selfbase-mcp-1 | grep -cE 'sbp_[0-9a-f]{40}|eyJ[A-Za-z0-9_-]{60,}'` → 0.
- [ ] T076 [P] **POST-DEPLOY** — Setup-doc clarity check (SC-010): hand the runbook to an operator who hasn't seen the feature; have them self-onboard end-to-end from scratch (DNS check → MCP client config → OAuth dance → first tool call). Capture friction points; iterate the runbook if anything is unclear.
- [ ] T077 [P] **POST-DEPLOY** — Token-refresh transparency check (SC-003): authorize an MCP client; wait 65 minutes; trigger a tools/call from the LLM; verify the call succeeds without browser intervention (silent refresh worked).
- [ ] T078 [P] **POST-DEPLOY (Per remediation C4)** — Master-key-rotation regression: schedule a master-key rotation on a non-production project + pause/restore that project + assert containers come up cleanly (encrypted_secrets re-decrypt with the new key). Document the procedure in `docs/changes/014-mcp-http-oauth.md` troubleshooting section.

---

## Dependencies

```
Setup (T001..T006)
  │
  ├─→ Foundational (T007..T024) — crypto + Zod + DB accessors + Redis + dual auth + status mapper
  │     │
  │     ├─→ US1 (T025..T043) ← P1, MVP — full OAuth dance + HTTP MCP up to first list_projects
  │     │     │
  │     │     ├─→ US2 (T044..T045) ← P2 — DCR hardening + end-to-end smoke (most of US2 surface lives in T027/T028 in foundational)
  │     │     │
  │     │     ├─→ US3 (T046..T052) ← P2 — dashboard revoke + UI
  │     │     │
  │     │     ├─→ US4 (T053..T058) ← P2 — get_logs Logflare forwarder (uses dual-auth from T021)
  │     │     │
  │     │     ├─→ US5 (T059..T064) ← P2 — list_storage_buckets reverse-proxy (uses dual-auth)
  │     │     │
  │     │     └─→ US6 (T065..T070) ← P2 — pause/restore + status-enum translation (uses dual-auth)
  │     │
  │     └─→ Polish (T071..T077) ← parallel with stories / after US1
```

Notes:
- T021 (dual-auth) is THE critical foundational task — every user story depends on it
- US2 is the smallest follow-on (its registration endpoint already exists from T027); it's mostly extra smoke
- US4/US5/US6 are fully independent of each other once foundational is done — can be built in parallel by 3 engineers
- Polish T073-T077 are post-deploy smoke checks; they can run only after merge + live deploy

## Parallel execution opportunities

Within each phase, `[P]` tasks touch different files and can run concurrently:

- **Setup**: T001+T002+T003+T004 in parallel; T006 in parallel with T005 (different files)
- **Foundational**: T007/T008, T009/T010, T011/T012, T013/T014, T015/T016, T017/T018, T019/T020 all parallel pairs; T021 sequential (depends on T007 + T019); T022 parallel with T023/T024
- **US1**: T026/T028/T030/T032 (all tests) parallel; T034..T040 (mcp service files) mostly parallel; T042/T043 (E2E shells) parallel
- **US3**: T046/T047 sequential by file; T048 parallel with UI work T049/T050/T051; T052 parallel
- **US4/US5/US6 phases**: each fully independent of the others — three engineers, three branches, three PRs
- **Polish**: T071/T072 parallel with each other; T073-T077 sequential against live deploy but parallel against the developer's preparation

## MVP scope

**US1 alone = MVP** because:
- It's the full OAuth dance + HTTP MCP serving the multi-project surface
- 5 of the 6 stories are P2 (security hygiene + nice-to-have tool surface expansion)
- An operator can ship US1, use it via Claude Code with PAT-stub-as-bearer until US3 dashboard revoke lands, and progressively get US4/US5/US6 tool surfaces

Estimated effort:
- Phase 1 + 2 (setup + foundational): ~3-4 days
- US1 (P1 MVP): ~4-5 days
- US2 (P2 hardening + smoke): ~0.5 day
- US3 (P2 dashboard): ~1.5 days
- US4 (P2 logs): ~2 days
- US5 (P2 storage): ~1 day
- US6 (P2 pause/restore + status-enum retrofit): ~1.5 days
- Polish: ~1 day (mostly post-deploy validation)
- **Total**: ~14-16 days (~3 weeks) for the full feature; ~7-9 days (~1.5 weeks) for MVP-only (US1) + foundations

## Task count summary

| Phase | Count |
|---|---|
| Setup | 6 (+ T006a shared package scaffold) |
| Foundational | 22 (was 18; +T006a shared package + T024a/b/c/d cleanup crons) |
| US1 (OAuth + HTTP MCP MVP) | 19 |
| US2 (DCR hardening) | 2 |
| US3 (Dashboard revoke) | 7 |
| US4 (get_logs) | 6 |
| US5 (list_storage_buckets) | 6 |
| US6 (pause/restore + status mapper retrofit) | 6 |
| Polish | 8 (+1 deployment regression) |
| **Total** | **83** (was 77; +6 from analysis remediation: T006a shared package, T024a/b/c/d cleanup crons, T078 master-key rotation post-deploy) |
