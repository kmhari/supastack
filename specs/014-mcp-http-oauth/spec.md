# Feature Specification: Hosted multi-project MCP + OAuth 2.1 authorization server

**Feature Branch**: `014-mcp-http-oauth`

**Created**: 2026-05-26

**Status**: Draft

## Clarifications

### Session 2026-05-26

- Q: Should OAuth access tokens match Supabase Cloud's apparent "logged in for 3+ days" lifetime, or be short-lived? → A: Match Cloud. Verified: Cloud's gotrue defaults `JWT.Exp = 3600` (1h access token); the 3+ day stickiness comes from transparent refresh-token rotation, not from a long access token. **Decision**: keep FR-008 = 1h access, FR-009 = 30-day refresh idle — exactly matches Cloud's defaults.
- Q: How should the JWT signing key be derived/stored? → A: HKDF from master key. Derive a 32-byte HS256 signing key from the existing master key via HKDF (label `selfbase-oauth-jwt-v1`). No new operator-managed secret. Master-key rotation cascades to the OAuth key; bounded blast radius (≤1h re-auth) due to short access TTL. **Decision**: Sharpens FR-024 — implementation MUST use HKDF derivation with this label; no DB-stored key, no SESSION_SECRET reuse.
- Q: How should access-token revocation propagate to in-flight requests? → A: Redis revocation list. On revoke, write the token's `jti` claim to Redis with TTL equal to the token's remaining lifetime; every MCP/api request does a ~1ms Redis lookup against the revocation set. Propagation <100ms (satisfies SC-004's <5s requirement with headroom). **Decision**: Adds FR-021a — MCP service depends on the existing api Redis instance; revocation check happens BEFORE the platform call.
- Q: Pre-register popular MCP clients or DCR-only? → A: DCR-only. Every MCP client (including Claude Code/Cursor/Windsurf/Claude Desktop) self-registers via `/v1/oauth/register` on first connect. No client allow-listing or seed data. **Decision**: Drops the "verified vs unknown" client distinction from FR-012; the warning badge concept is removed since all clients are dynamic. Consent UI shows the client's submitted `client_name` with a neutral "MCP client" label (no trust tier).
- Q: MCP service horizontal scalability? → A: Single replica. MCP service runs as one container, holds sessions in process memory. Matches selfbase's overall single-VM topology. **Decision**: FR-019 sessions are in-process only; multi-replica + Redis-backed session state is deferred to a future optimization if capacity (SC-009: 20 concurrent sessions) is exceeded.

**Input**: Operator-facing follow-up to feature 013. Today operators can drive selfbase from MCP clients only by pasting a PAT into a stdio MCP config — a janky setup that doesn't match the polished "click to authorize" UX that Cloud's `mcp.supabase.com/mcp` offers. This feature closes that gap by hosting a multi-project HTTP MCP server at `mcp.<apex>/mcp`, backed by a new OAuth 2.1 authorization server in selfbase. After this ships, an operator pastes one URL into any MCP-aware editor (Claude Code, Cursor, Windsurf, Claude Desktop), clicks "Authorize" in their browser, and gets full multi-project tooling instantly — same UX as Cloud, against their self-hosted deployment.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator connects an MCP client to selfbase with one URL paste + browser click (Priority: P1) 🎯 MVP

An operator wants their LLM-aware editor (Claude Code, Cursor, Windsurf, Claude Desktop, etc.) to be able to inspect and modify their selfbase projects. They open their editor's MCP configuration, paste the single line:

```json
{ "mcpServers": { "selfbase": { "type": "http", "url": "https://mcp.<apex>/mcp" } } }
```

The first time the editor uses the MCP server, a browser tab opens to selfbase's authorize page. The operator is already logged into the selfbase dashboard, so they see only the consent dialog: "Authorize Claude Code to manage your selfbase projects? Grants: read projects, read/write database, deploy edge functions." They click "Authorize." The tab closes automatically. Their editor's MCP client now has an access token. They ask the LLM "list my projects" and get a structured response.

**Why this priority**: This is the entire UX win. Every interaction below depends on the OAuth dance + HTTP MCP working end-to-end.

**Independent Test**: A fresh operator (not previously connected to MCP) configures their MCP client with `https://mcp.<apex>/mcp`, completes the browser authorization flow in under 90 seconds, and asks the LLM to "list my supabase projects". The LLM returns a structured list matching what `supabase projects list` would show.

**Acceptance Scenarios**:

1. **Given** an operator with an active selfbase dashboard session and a fresh MCP client config pointing at `https://mcp.<apex>/mcp`, **When** the MCP client makes its first call, **Then** the client opens a browser tab to selfbase's authorize page; the operator sees a consent dialog (no re-login); they click Authorize; the tab closes; the client receives an access token; the call succeeds.
2. **Given** the same operator with a valid access token, **When** the LLM invokes `list_projects` via the MCP client, **Then** the response lists every project the operator can see (matches `GET /v1/projects`).
3. **Given** the operator with a valid access token, **When** the LLM invokes `execute_sql` against any project ref, **Then** the SQL runs against that project's Postgres and the rows return as a bare array (matches the wire shape we ship in feature 013).
4. **Given** the operator's access token has expired (>1 hour old), **When** the client makes a new call, **Then** the MCP client transparently uses the refresh token to mint a new access token without prompting the operator.
5. **Given** the operator is NOT logged into the selfbase dashboard, **When** they trigger the OAuth dance from their MCP client, **Then** the authorize page redirects them to the dashboard login first, then back to the consent dialog upon successful login.
6. **Given** an operator who has been removed from the deployment (member revoked), **When** their MCP client uses its access token, **Then** the next call returns 401 unauthorized; the refresh token is rejected; the MCP client surfaces the re-auth requirement to the LLM.

---

### User Story 2 — MCP client without prior knowledge of selfbase self-registers via DCR (Priority: P2)

An operator uses an MCP-aware tool that has never seen `mcp.<apex>/mcp` before (i.e., it has no pre-registered OAuth `client_id`). Per the MCP spec, the client performs **Dynamic Client Registration** (RFC 7591): it POSTs its metadata (name, redirect URIs, etc.) to selfbase's `/v1/oauth/register` endpoint and gets back a `client_id` (and optionally `client_secret`). It then proceeds with the normal authorization-code flow.

**Why this priority**: The MCP spec mandates DCR for unknown clients. Without DCR, only pre-registered clients (e.g., one we manually allow-list) could connect — undermining the "paste a URL, it just works" UX. Lower than US1 because most popular MCP clients reuse a known client_id; DCR is the long-tail path.

**Independent Test**: A bespoke MCP client with no pre-registered client_id POSTs `{ client_name: "MyEditor", redirect_uris: ["http://localhost:54321/callback"] }` to `https://api.<apex>/v1/oauth/register`, receives a JSON response with a unique `client_id`, then uses it in a standard `/v1/oauth/authorize?client_id=…` flow that completes successfully.

**Acceptance Scenarios**:

1. **Given** a previously-unknown MCP client, **When** it POSTs valid RFC 7591 client metadata to `/v1/oauth/register`, **Then** it receives 201 with a unique `client_id`, no manual operator intervention required.
2. **Given** a freshly-registered client_id, **When** the client uses it in the authorize endpoint, **Then** the flow completes identically to a pre-registered client (consent dialog shows the client's submitted `client_name`).
3. **Given** an attacker POSTs malformed/abusive metadata (e.g., redirect URIs that match no scheme, or a flood of 10000 registrations), **Then** the endpoint rejects with 400 and rate-limits per-IP.

---

### User Story 3 — Operator revokes MCP client access from the dashboard (Priority: P2)

An operator suspects their laptop with an active MCP session has been lost or compromised. They open the selfbase dashboard, navigate to a new "Connected MCP Clients" section, see the list of currently-authorized clients (name, last-used timestamp, scopes), and click "Revoke" on the suspicious one. Subsequent calls from that client receive 401.

**Why this priority**: Security hygiene. Without this, a compromised operator laptop = full selfbase access until the entire operator account is removed. Lower than US1 because v1 can ship with token-revocation-via-account-removal as a fallback.

**Independent Test**: An operator authorizes two MCP clients (e.g., Claude Code on laptop A, Cursor on laptop B). They open `/settings/mcp-clients` in the dashboard. They click Revoke on client A. Client A's next MCP call returns 401; client B's calls continue to succeed.

**Acceptance Scenarios**:

1. **Given** an operator with N authorized MCP clients, **When** they open the dashboard's MCP clients page, **Then** they see each client listed with name, scopes, last-used timestamp, and authorized-at timestamp.
2. **Given** the operator clicks Revoke on a client, **When** confirmed, **Then** that client's access token + refresh token are immediately invalidated; the row disappears from the list.
3. **Given** a revoked client, **When** it attempts to use its access token or refresh token, **Then** both fail with 401; the client is forced to re-authorize.

---

### User Story 4 — Operator asks the LLM to fetch logs for a project (Priority: P2)

An operator is debugging a failing edge function or a slow API call. They ask the LLM: "Show me the last 50 errors from the api logs for my huntvox project in the past hour." The LLM invokes the `get_logs` MCP tool. The MCP server forwards the SQL-over-logs query to the per-project Logflare/analytics container and returns structured log rows that the LLM then summarizes for the operator.

**Why this priority**: Logs are a daily-driver operator workflow — "why did this fail" is one of the top three questions any operator asks. Without `get_logs` in v1, operators must drop out of their LLM workflow into ssh + `docker logs`, defeating the MCP UX.

**Independent Test**: An operator with an admin OAuth token asks the LLM (through their MCP-enabled editor) "show me the last 10 log entries from my <project-ref> postgres service." The LLM returns a structured list of 10 log lines drawn from the project's analytics container, sorted recent-first.

**Acceptance Scenarios**:

1. **Given** an operator with a valid OAuth token + a running project, **When** they invoke `get_logs(project_ref, service='api', iso_timestamp_start=…, iso_timestamp_end=…)` via MCP, **Then** the response contains log rows from the per-project analytics container scoped to that service + time range.
2. **Given** the operator queries logs for a service that has no entries in the time range, **When** the call completes, **Then** the response is an empty rows array (not an error).
3. **Given** the operator queries logs for a project they don't have access to, **When** the call is dispatched, **Then** the management API returns 403 and the MCP tool surfaces the denial to the LLM.
4. **Given** the per-project analytics container is unreachable (paused / crashed), **When** the call is dispatched, **Then** the management API returns 503 with a clear "analytics unreachable" error; LLM surfaces it.

---

### User Story 5 — Operator asks the LLM to list storage buckets for a project (Priority: P2)

An operator is auditing what storage buckets exist across their projects, or onboarding a teammate to a project that uses Storage. They ask the LLM: "List all the storage buckets in my huntvox project." The LLM invokes `list_storage_buckets`. The MCP server forwards through to the per-project storage container and returns the bucket list (name, id, public flag, file size limit, allowed MIME types).

**Why this priority**: Read-only visibility into Storage is a common ask; without it, operators must drop into Studio just to see "what buckets exist". Write-path (`update_storage_config`, bucket creation) is deferred — v1 is read-only Storage visibility.

**Independent Test**: An operator with a valid OAuth token + a project with ≥1 storage bucket asks the LLM "list my storage buckets for <project-ref>." Response includes every bucket in the project's storage container with name + public/private + created_at.

**Acceptance Scenarios**:

1. **Given** an operator with a valid OAuth token + a project with bucket "avatars" (public) and "private-docs" (private), **When** they invoke `list_storage_buckets(project_ref)` via MCP, **Then** the response includes both buckets with correct visibility flags.
2. **Given** a project with no storage buckets, **When** the call completes, **Then** the response is an empty array.
3. **Given** the per-project storage container is paused/stopped, **When** the call is dispatched, **Then** the management API returns 409 `project_not_runnable`.

---

### User Story 6 — Operator pauses or restores a project from the LLM (Priority: P2)

An operator wants to pause a project they're not actively using (to free up VM resources / reduce log noise) without leaving their editor. They ask: "Pause my staging project." The LLM invokes `pause_project(project_ref)`. The selfbase lifecycle worker stops the per-project containers. Later, the operator asks "Restore my staging project" — the LLM invokes `restore_project(project_ref)`, the worker brings the containers back up, and the project status returns to `running`.

**Why this priority**: Pause/restore are simple operator actions that map cleanly to existing selfbase RBAC actions (`instance.pause` + `instance.resume`) — bringing them into MCP costs ~1 day and unlocks a useful capacity-management workflow without leaving the LLM context.

**Independent Test**: An operator with admin OAuth pauses a running project via the LLM; verifies via `get_project` (or `list_projects`) that status transitions to `INACTIVE`. They then restore it; verifies status returns to `ACTIVE_HEALTHY`.

**Acceptance Scenarios**:

1. **Given** an operator with admin OAuth + a running project, **When** they invoke `pause_project(project_ref)`, **Then** the response is success; the worker pauses the per-project containers; subsequent `get_project` returns `status=INACTIVE`.
2. **Given** a paused project, **When** the operator invokes `restore_project(project_ref)`, **Then** the response is success; the worker resumes containers; `get_project` returns `status=ACTIVE_HEALTHY` within 60 seconds.
3. **Given** a member-role OAuth token, **When** they invoke either tool, **Then** the management API returns 403.
4. **Given** a project that's already paused, **When** `pause_project` is invoked, **Then** the response is idempotent success (no error).

---

### Edge Cases

- **Operator on the authorize page is logged into a DIFFERENT user account** (e.g., they were testing as member-role): the consent dialog clearly shows which account is granting access; operator can switch accounts before clicking Authorize without losing the in-progress authorize request.
- **Operator denies consent (clicks "Deny" or closes the tab)**: the OAuth redirect carries `error=access_denied`; the MCP client surfaces "authorization denied" to the LLM; no token issued.
- **Two MCP clients race to authorize concurrently**: each gets its own client_id (via DCR) and its own consent flow; no cross-talk between sessions.
- **Operator's dashboard session expires mid-authorize**: the authorize endpoint redirects to login, then back to the consent dialog with the original parameters preserved (no need to re-paste URL on the MCP client side).
- **Access token is replayed from a logged location** (e.g., laptop with an old shell history file): tokens are short-lived (1h) and verifiable as JWTs, so a stale capture is naturally bounded; refresh tokens require client authentication to use.
- **MCP client requests scopes the operator's role doesn't grant**: the consent dialog shows ONLY the scopes the operator's role can grant; the issued token is scoped accordingly; tool calls outside that scope return 403 from the management API.
- **`mcp.<apex>` DNS not yet pointed at the Caddy host**: clear setup-time error in the deployment runbook; no silent failures.
- **Operator's deployment has zero projects**: `list_projects` returns `[]`; project-scoped tools surface a "no project selected" hint when the LLM doesn't pass a `project_ref`.
- **Selfbase upgrades the upstream `@supabase/mcp-server-supabase` library and a new tool depends on an unimplemented `/v1/*` endpoint**: the unimplemented operation group is stripped at MCP server construction time, so the new tool simply doesn't appear in `tools/list` (no LLM-visible 501s).
- **`get_logs` SQL injection via LLM-supplied `sql` param**: the Logflare API itself enforces SQL parsing + sandbox; we forward the SQL verbatim. The per-project analytics container has no write capability against the project's primary Postgres — its scope is read-only against log tables. (US4)
- **`list_storage_buckets` against a project whose storage container is healthy but has zero buckets**: returns `[]`, not an error. (US5)
- **`pause_project` called while a backup is in-flight for that project**: the pause endpoint MUST detect any `backup_jobs` row in status `running` for the target ref and refuse with 409 `backup_in_progress` (rather than queueing or interrupting the backup, which risks partial-state). Operator retries after the backup completes. (US6)
- **`restore_project` of a project whose master key was rotated since pause**: containers come up with the current master key; encrypted secrets re-decrypt cleanly because rotation is online. (US6)

## Requirements *(mandatory)*

### Functional Requirements

#### OAuth 2.1 authorization server

- **FR-001**: System MUST expose `GET /v1/oauth/authorize` that accepts standard OAuth 2.1 authorize parameters (`client_id`, `redirect_uri`, `response_type=code`, `state`, `code_challenge`, `code_challenge_method=S256`, `scope`), validates them against the registered client, and either redirects the browser back with `code` + `state` on consent OR with `error=access_denied` on denial.
- **FR-002**: The authorize endpoint MUST check the selfbase dashboard session cookie. If no valid session, redirect the operator to the dashboard login (preserving the original authorize request) and resume on successful login.
- **FR-003**: The authorize endpoint MUST display a consent UI showing: the requesting client's `client_name`, the requested scopes (human-readable), the operator's current identity (so they can verify which account is granting access), Authorize and Deny buttons.
- **FR-004**: System MUST expose `POST /v1/oauth/token` that accepts a PKCE-verified authorization code (grant_type=authorization_code) OR a valid refresh token (grant_type=refresh_token), and returns an access token + refresh token + expires_in + token_type=Bearer. PKCE code_verifier verification MUST be enforced (the only required client authentication for public clients).
- **FR-005**: System MUST expose `POST /v1/oauth/register` (RFC 7591 Dynamic Client Registration) that accepts client metadata (at minimum `client_name`, `redirect_uris`) and returns a unique `client_id`. Per-IP rate-limited to prevent registration floods.
- **FR-006**: System MUST expose `GET /.well-known/oauth-authorization-server` (RFC 8414) returning OAuth metadata including all endpoint URLs, supported grant types (`authorization_code`, `refresh_token`), supported scopes, PKCE methods supported (`S256`), token endpoint auth methods supported.
- **FR-007**: System MUST expose `GET /.well-known/oauth-protected-resource` at `mcp.<apex>` per RFC 9728 so MCP clients can discover the authorization server URL automatically from the resource URL alone.
- **FR-008**: Access tokens MUST be JWTs signed with a server-held key, containing ALL of the following claims: `sub` (operator user id), `azp` (issuing client_id), `aud` (the MCP resource URL `https://mcp.<apex>/mcp`), `scope` (granted scopes, CSV), `jti` (UUIDv4 — used as the Redis revocation key), `iat` (issued-at, seconds since epoch), `exp` (≤ 1 hour from issue), and `iss` (issuer URL `https://api.<apex>`).
- **FR-009**: Refresh tokens MUST be opaque random strings (not JWTs), stored server-side, single-use (rotated on every refresh), and expire after 30 days of inactivity.
- **FR-010**: The existing `/v1/*` management API auth plugin MUST accept BOTH legacy PATs (`sbp_…`) AND OAuth 2.1-issued JWT access tokens as Bearer credentials, transparently resolving each to the same operator identity. No existing PAT flow regresses.
- **FR-010a**: On every OAuth-JWT-authenticated request, the auth plugin MUST re-resolve the user row by `sub` claim and reject if the user has been removed/suspended. This ensures that revoking a member's account from the dashboard invalidates their OAuth bearers within one request (≤60s end-to-end per SC-007), independent of the per-token Redis revocation list.
- **FR-011**: For v1, scope grants MUST be all-or-nothing within the operator's role: a single `platform` scope grants every action the operator's existing RBAC role allows. Finer-grained scopes are deferred to a later feature.
- **FR-012**: (Revised per Clarifications Q4) The authorize UI MUST display the client's submitted `client_name` neutrally — all clients in v1 are DCR-registered (no pre-registered "verified" tier). The UI MUST surface the requesting client's full `client_name` + `redirect_uris` in the consent dialog so the operator can spot social-engineering attempts (e.g., a malicious app calling itself "Claude Code" with a suspicious redirect URI).

#### HTTP MCP server

- **FR-013**: System MUST expose `POST /mcp` at `mcp.<apex>` that implements the MCP Streamable HTTP transport (per MCP spec 2025-06-18 or later as adopted by the upstream client ecosystem). The endpoint MUST accept JSON-RPC over HTTP with optional Server-Sent Events streaming for long-running tool calls.
- **FR-014**: The MCP endpoint MUST validate the Bearer access token on every request (JWT signature + expiry + revocation check) before routing to the MCP server logic. Unauthenticated requests return 401 with a `WWW-Authenticate` header pointing at the OAuth authorize URL per RFC 6750.
- **FR-015**: The MCP server MUST run the upstream `@supabase/mcp-server-supabase` library AS-IS, with the platform implementation configured to point at the internal selfbase management API. No fork of the upstream library.
- **FR-016**: The MCP server MUST expose the following operation groups in v1: `account` (`list_projects`, `get_project`, `list_organizations`, `get_organization`, `pause_project`, `restore_project` — but NOT `create_project` / `get_cost` / `confirm_cost`), `database` (full feature 013 surface), `development` (`get_project_url`, `get_publishable_keys`, `generate_typescript_types`), `functions` (`list_edge_functions`, `get_edge_function`, `deploy_edge_function`), `debugging` (read-only subset: `get_logs` only — NOT `get_advisors`), `storage` (read-only subset: `list_storage_buckets` only — NOT `get_storage_config` / `update_storage_config`), `docs` (`search_docs`). The `branching` operation group and the per-tool exclusions above MUST be omitted from the platform implementation so those tools never appear in `tools/list` (no LLM-visible 501s).
- **FR-017**: The MCP server MUST be reachable through the existing Caddy `*.<apex>` wildcard cert at `mcp.<apex>` — no new cert provisioning.
- **FR-018**: The MCP server's per-request platform instance MUST use the Bearer token's resolved operator identity to authorize downstream `/v1/*` calls. An access token issued to operator X MUST only let the MCP server see X's projects (no cross-operator access).
- **FR-019**: The MCP server MUST handle MCP session lifecycle (`mcp-session-id` header per the streamable HTTP spec): create a session on first request, reuse it for the operator's subsequent requests within a short TTL (e.g., 30 minutes), garbage-collect idle sessions.

#### Dashboard integration

- **FR-020**: The dashboard MUST add a `/settings/mcp-clients` page listing every OAuth client authorized by the current operator. Each row shows: client_name (as registered or operator-assigned), authorized_at, last_used_at, current_scopes, and a Revoke action.
- **FR-021**: Revoking a client MUST immediately invalidate every active access token + refresh token issued to that (operator, client) pair. Subsequent requests with those tokens MUST return 401.
- **FR-021a** (per Clarifications Q3): Revocation MUST use a Redis-backed revocation list keyed by the access token's `jti` claim, with TTL equal to the token's remaining lifetime. Every authenticated request (api `/v1/*` AND MCP `/mcp`) MUST consult this list before processing. Propagation latency MUST be under 100ms. The MCP service depends on the existing api Redis instance (no new Redis deployment).
- **FR-022**: The dashboard MUST extend the existing `/settings/cli` page with a new "MCP" section explaining the one-line `mcp.<apex>/mcp` config with copy buttons for the major MCP clients (Claude Code, Cursor, Windsurf). A dedicated `/settings/mcp` route is NOT required for v1 — the cli page is the unified developer-tools setup page.

#### Cross-cutting

- **FR-023**: All OAuth + MCP operations MUST emit `audit_log` entries: `oauth.code.issued`, `oauth.token.issued`, `oauth.token.refreshed`, `oauth.token.revoked`, `oauth.client.registered`, `mcp.session.opened`, `mcp.tool.invoked` (with tool name + project_ref). Full SQL text for `execute_sql` invocations through MCP is already captured by feature 013's audit entries (`instance.db.query.executed`), so no double-logging.
- **FR-024**: The OAuth signing key MUST be derivable from (or stored alongside) the existing selfbase master key — no new operator-managed secret. Rotation procedure follows existing master-key rotation.
- **FR-024a**: Background cleanup jobs MUST run in the existing worker process to GC expired/stale OAuth state: (a) expired authorization codes (DELETE WHERE `expires_at < now()`, every 1 minute), (b) idle-aged refresh tokens (DELETE WHERE `last_used_at < now() - interval '30 days' AND revoked_at IS NULL`, every 1 hour). Both jobs MUST be idempotent + safe to overlap a previous run.
- **FR-024b**: The `GET /v1/oauth/authorize` round-trip through `/dashboard/login` MUST preserve the full authorize request via a `?next=<urlencoded-authorize-url>` query parameter on the login redirect. The `next` parameter MUST be validated as a same-origin path (starts with `/v1/oauth/authorize`) before redirect to prevent open-redirect attacks. Maximum encoded length 4096 bytes.

#### Project logs (US4)

- **FR-025**: System MUST expose `GET /v1/projects/<ref>/analytics/endpoints/logs.all` matching the upstream Supabase Management API path so the unmodified upstream MCP server's `get_logs` tool works without per-tool wrapping. Accepts query params `service` (one of `api`, `postgres`, `edge-function`, `auth`, `storage`, `realtime`), `iso_timestamp_start`, `iso_timestamp_end`, and `sql` (optional override).
- **FR-026**: The endpoint MUST forward the query to the per-project analytics (Logflare) container at the project's internal address, authenticating with the per-project logflare API key stored in `supabase_instances.encryptedSecrets`. Response shape MUST match upstream so the MCP tool consumes it without translation.
- **FR-027**: Service-name → log-table mapping (e.g., `api` → `edge_logs`, `postgres` → `postgres_logs`, …) MUST follow upstream's mapping table. When `sql` is supplied verbatim, the endpoint passes it through to Logflare unchanged.
- **FR-028**: When the per-project analytics container is paused/unreachable, the endpoint MUST return 503 `analytics_unreachable` with the failure reason in `details`.

#### Storage bucket listing (US5)

- **FR-029**: System MUST expose `GET /v1/projects/<ref>/storage/buckets` matching the upstream Supabase Management API path so the unmodified upstream MCP server's `list_storage_buckets` tool works without per-tool wrapping.
- **FR-030**: The endpoint MUST reverse-proxy to the per-project storage container's `/storage/v1/bucket` endpoint, swapping the client's PAT/OAuth Bearer for a freshly-minted per-project service-role JWT (using existing reveal-credentials infra) so the storage container accepts the request.
- **FR-031**: Response shape MUST be the storage container's native bucket-list shape (array of `{ id, name, public, file_size_limit, allowed_mime_types, created_at, updated_at }`).
- **FR-032**: This release adds the read-only listing endpoint only. `get_storage_config` / `update_storage_config` / bucket-create / bucket-delete remain out of scope for v1 and tracked as separate feature 018.

#### Project pause + restore (US6)

- **FR-033**: System MUST expose `POST /v1/projects/<ref>/pause` matching the upstream Supabase Management API path. RBAC: `instance.pause` (existing action). On success, enqueues the lifecycle worker's pause job and returns 200 immediately with the project's current status; the project transitions to `INACTIVE` asynchronously.
- **FR-034**: System MUST expose `POST /v1/projects/<ref>/restore` matching the upstream Supabase Management API path. RBAC: `instance.resume` (existing action). On success, enqueues the lifecycle worker's resume job and returns 200 immediately; the project transitions back to `ACTIVE_HEALTHY` within 60 seconds.
- **FR-035**: Both endpoints MUST be idempotent: pausing an already-paused project or restoring an already-running project returns success without error.
- **FR-036**: The existing selfbase project-status enum (`running`, `paused`, `provisioning`, `failed`, …) MUST be translated to the upstream Cloud enum (`ACTIVE_HEALTHY`, `INACTIVE`, `COMING_UP`, `UNKNOWN`, …) in all `/v1/projects/*` responses (not just pause/restore) so MCP and CLI consumers see the wire shape they expect. This translation layer fixes the long-standing impedance mismatch noted in feature 003.

### Key Entities

- **OAuth client**: a registered (pre-known or DCR-registered) MCP-aware application. Attributes: client_id (unique), client_name (display), redirect_uris (allow-list), is_dynamic (DCR vs pre-registered), created_at.
- **Authorization code**: a short-lived (≤60s) opaque code issued at the end of the authorize flow. Bound to (client_id, operator_user_id, code_challenge, redirect_uri, scope). Single-use.
- **OAuth access token**: short-lived JWT (≤1 hour). Bound to (operator_user_id, client_id, scope). Verifiable offline by any service holding the signing key.
- **Refresh token**: opaque random string (≥256 bits). Bound to (operator_user_id, client_id, scope). Stored server-side. Single-use (rotated on each refresh). 30-day idle expiry.
- **MCP session**: short-lived in-memory session bound to (operator_user_id, client_id, mcp-session-id). Holds the per-request MCP server instance + transport. Garbage-collected on idle.
- **Audit log entries**: extends the existing `audit_log` action enum (unconstrained text — no schema change) with new values per FR-023.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A first-time operator completes the full MCP setup flow (paste URL → browser authorize → first successful LLM tool call) in **under 90 seconds**, with zero re-login prompts if already logged into the dashboard. (US1)
- **SC-002**: For 100% of supported MCP tools (database, development, functions, account read-only subset), the LLM-driven call returns a structured response within 5 seconds end-to-end for typical operator workloads. (US1, US2)
- **SC-003**: Access token refresh is transparent to the operator — when the LLM makes a tool call after the 1-hour token expiry, no browser tab opens; the MCP client refreshes silently and the tool call succeeds. (US1)
- **SC-004**: Revoking an MCP client from the dashboard takes effect in **under 5 seconds**: a tool call attempted by the revoked client within 5s of the revoke action receives 401. (US3, FR-021)
- **SC-005**: At least 3 distinct MCP clients (e.g., Claude Code, Cursor, Windsurf, or one bespoke client via DCR) can authorize and use the MCP server without any per-client server-side configuration. (US2)
- **SC-006**: Zero of the upstream MCP server's deferred tools (`get_advisors`, `get_storage_config`, `update_storage_config`, `create_project`, `get_cost`, `confirm_cost`, all `branching` tools) appear in the `tools/list` response — LLMs never attempt them and never see 501 errors. (FR-016)
- **SC-007**: A revoked operator (member status removed by the admin) loses MCP access in **under 60 seconds** — their next tool call returns 401 even if their access token has not yet expired. (FR-010, edge case)
- **SC-008**: No plaintext PATs, access tokens, or SQL result data appear in api or mcp service logs across a full setup → revoke workflow. Verified by grepping container logs for `sbp_[0-9a-f]{40}` and the access-token JWT prefix. (security)
- **SC-009**: The hosted MCP service stays under **150 MiB resident memory** at p95 across a sustained 20-concurrent-session workload. (capacity)
- **SC-010**: Setup-doc and runbook explicitly explain: how to point `mcp.<apex>` DNS at the Caddy host, how the `*.<apex>` wildcard cert covers it, what the operator should expect to see in the browser, how to revoke a stale client. Operator can self-onboard from the runbook alone with no support.
- **SC-011**: `get_logs` returns up to 100 log entries for a typical 1-hour window in **under 3 seconds end-to-end**. (US4)
- **SC-012**: `list_storage_buckets` returns the full bucket list for a project with ≤100 buckets in **under 2 seconds end-to-end**. (US5)
- **SC-013**: `pause_project` returns the API acknowledgement in **under 2 seconds** (worker job enqueued; container shutdown happens asynchronously). `restore_project` API acknowledgement is also under 2 seconds; full container readiness (status → `ACTIVE_HEALTHY`) within **60 seconds**. (US6)

## Assumptions

- The selfbase `*.<apex>` wildcard cert (feature 004) covers `mcp.<apex>` — no separate cert work.
- The existing selfbase dashboard session cookie scheme (`/api/v1/auth/*`) is sufficient to anchor the authorize-time identity check; no new session infrastructure.
- The existing master-key envelope encryption scheme can be reused or extended to hold the OAuth signing key (no new operator-managed secret).
- The existing RBAC matrix (`packages/shared/src/rbac.ts`) is the canonical source of truth for what scopes a given operator's role can grant — no parallel permission model.
- Upstream `@supabase/mcp-server-supabase` package versioning is stable enough that a pinned version + occasional manual bumps will work; no need for automated dependency tracking.
- The MCP service runs as a separate compose service (parallel to api, worker, web) to isolate its memory profile from the main api; deploying via the same rsync + `docker compose build && up` flow used for all other services.
- Operators wanting per-project Studio MCP passthrough (a different use case, covered by the existing upstream self-hosted MCP docs) is **out of scope** — that's tracked as a separate optional follow-up.
- Operators wanting tool surfaces that v1 still defers (storage config + bucket-mutation tools, advisor reports, `create_project` + cost stubs, all branching tools) is **out of scope for v1** — tracked as separate features (016 advisors, 017 create+cost, 018 storage write path) and the branching exception is tracked as issue #41. Project logs, storage-bucket listing, and pause/restore ARE in v1 per US4/US5/US6.
- Finer-grained OAuth scopes (e.g., `database:read` vs `database:write` instead of one `platform` scope) is **out of scope for v1**; v1 grants all-or-nothing based on the operator's RBAC role.
- An OAuth admin UI in the dashboard for MANAGING (vs revoking) OAuth clients is **out of scope for v1**; revoke is sufficient.
- MCP clients capable of mTLS or other advanced client authentication is **out of scope for v1**; PKCE + DCR is the v1 client-auth posture.
- RFC 7009 token revocation endpoint (`POST /v1/oauth/revoke`) is **out of scope for v1**. Cloud doesn't expose it either; revocation is operator-initiated via the dashboard. Add only if a real MCP client errors due to its absence.
