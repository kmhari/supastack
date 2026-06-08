# Feature Specification: Supabase-Style OAuth Authorize Flow

**Feature Branch**: `115-oauth-authorize-flow`

**Created**: 2026-06-08

**Status**: Draft

## User Scenarios & Testing *(mandatory)*

### User Story 1 - MCP Client Completes OAuth Authorization (Priority: P1)

An MCP client (Claude Code, Cursor, Windsurf) initiates the OAuth 2.1 PKCE flow by opening the authorization URL. The operator's browser handles the consent and the client receives the authorization code.

**Why this priority**: This is the core user-facing flow. Without it, MCP clients cannot authenticate against Supastack. The entire OAuth surface depends on this working end-to-end.

**Independent Test**: Can be fully tested by running a local MCP PKCE client that opens the authorization URL, confirming the consent page renders with correct client info, clicking Authorize, and verifying the callback receives `code` and `state`.

**Acceptance Scenarios**:

1. **Given** a registered OAuth client and an unauthenticated browser, **When** the MCP client opens `/v1/oauth/authorize?...`, **Then** the API stores the authorization params server-side (keyed by a UUID `auth_id`), and responds with `303` redirect to `/dashboard/authorize?auth_id=<UUID>`.

2. **Given** an unauthenticated browser that navigated to `/dashboard/authorize?auth_id=...`, **When** the dashboard page loads, **Then** the upstream Studio auth gate handles the redirect to its sign-in page with a return path that preserves only the `auth_id` (not the raw OAuth params). This behavior is owned by the Studio consent page, not by this feature's backend.

3. **Given** an authenticated operator visits `/dashboard/authorize?auth_id=<UUID>`, **When** the page renders, **Then** it displays: the client application name, the list of requested scopes in human-readable form, the redirect URI, and the signed-in user's email — with Authorize and Deny buttons.

4. **Given** the operator clicks Authorize, **When** the consent is submitted (`POST …?skip_browser_redirect=true`), **Then** the API issues an authorization code, records the consent in the audit log, consumes the `auth_id`, and returns `201 { url: "redirect_uri?code=<code>&state=<state>" }`; the Studio page then navigates the browser to that URL (the callback receives `code` and `state`).

5. **Given** the operator clicks Deny, **When** the denial is submitted (`DELETE …`), **Then** the API consumes the `auth_id`, records the denial in the audit log, issues no code, and returns `200 { id: <auth_id> }`; the Studio page navigates the operator away (it does **not** bounce the browser to the client's callback, so the MCP client's local listener simply times out).

---

### User Story 2 - Auth Session Stored Server-Side (Priority: P2)

The authorization parameters are stored server-side using a short-lived UUID reference (`auth_id`), so the consent page URL is clean and the raw OAuth parameters are never exposed in the browser history.

**Why this priority**: Security and UX improvement over inline form rendering. Eliminates raw PKCE challenge and redirect URI from browser URL bars and history. Matches Supabase production behavior.

**Independent Test**: Can be fully tested by calling `GET /v1/oauth/authorize?...` and verifying the response is a 303 with a clean `?auth_id=UUID` URL, then calling `GET /platform/oauth/authorizations/:auth_id` and verifying it returns the stored authorization details.

**Acceptance Scenarios**:

1. **Given** a valid OAuth authorization request, **When** `GET /v1/oauth/authorize` is called, **Then** a UUID `auth_id` is created, the full OAuth params are stored server-side with a 10-minute TTL, and the response is `303` to `/dashboard/authorize?auth_id=<UUID>`.

2. **Given** a stored `auth_id`, **When** `GET /platform/oauth/authorizations/:auth_id` is called by an authenticated user, **Then** the response is the Studio-consumed shape: `{ name, website, icon, domain, scopes: string[], expires_at, approved_at: null, approved_organization_slug: null }`.

3. **Given** an `auth_id` that has expired or does not exist, **When** any endpoint references it, **Then** a `404` response is returned and the user is shown an error.

4. **Given** the same `auth_id` is used twice (replay after code issued), **When** the second consent submission arrives, **Then** a `404` is returned (the session was atomically consumed on first use).

---

### User Story 3 - Organization-Scoped Consent API (Priority: P3)

The consent submission uses an organization-scoped endpoint (`POST /platform/organizations/:slug/oauth/authorizations/:auth_id`, with `DELETE` for deny) so audit records include the org context, matching Supabase's API shape. (In supastack the `:slug` path param is the organization id.)

**Why this priority**: Needed for proper audit trail and multi-org support. The consent page must let the operator choose which organization scope the token will be issued under.

**Independent Test**: Can be tested by calling the `POST` endpoint (as an org owner/administrator) with a valid `auth_id` and org slug and verifying the returned `201 { url }` contains `code=` and `state=` (or the `302` callback without the flag); and by calling `DELETE` and verifying `200 { id }` with an `oauth.consent.denied` audit entry.

**Acceptance Scenarios**:

1. **Given** an authenticated operator who is an **owner or administrator** of the named organization, **When** they submit consent via `POST /platform/organizations/:slug/oauth/authorizations/:auth_id`, **Then** the API issues an authorization code (via the unchanged `issueCode` — not bound to an org column) and returns the callback `url`.

2. **Given** an operator who is not a member, or is a member but not an owner/administrator, of the specified org, **When** they submit consent, **Then** the API returns `403 Forbidden` (`authorizeOrg(req, 'oauth.consent.approve', slug)`).

3. **Given** a successful consent submission, **When** the code is issued, **Then** an audit log entry (`oauth.code.issued`) records the operator user ID, client ID, scopes granted, and the org slug from the path.

---

### Edge Cases

- What happens when `auth_id` TTL expires while the user is on the consent page? The submit endpoint returns `404` (the Redis key expired); the Studio page shows a session-expired error.
- What happens if the same `code` is exchanged twice? Token endpoint rejects with `invalid_grant` (existing behavior — no change needed here).
- What happens if multiple browser tabs race to submit consent for the same `auth_id`? The first submission succeeds (atomic `GETDEL`); subsequent submissions return `404`.
- What happens if the `redirect_uri` in the stored session differs from what was registered? The consent is blocked with a descriptive error (validated at store time in US1).
- What happens if `code_challenge_method` is not S256? The request is rejected at the `/v1/oauth/authorize` entry point with `400 invalid_request` (existing validation, no change).

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: `GET /v1/oauth/authorize` MUST validate all required OAuth 2.1 params (response_type, client_id, redirect_uri, state, code_challenge, code_challenge_method=S256, scope), store them server-side with a 10-minute TTL keyed by a newly generated UUID (`auth_id`), and respond with `303` redirect to `<apex>/dashboard/authorize?auth_id=<UUID>`. It MUST NOT render inline HTML.

- **FR-002**: `GET /platform/oauth/authorizations/:auth_id` MUST return the stored authorization context in the shape the upstream Studio consent page consumes: `{ name, website, icon, domain, scopes: string[], expires_at, approved_at: null, approved_organization_slug: null }`, for any authenticated operator (`oauth.consent.read`). It MUST return `404` if the `auth_id` is unknown or expired.

- **FR-003**: `POST /platform/organizations/:slug/oauth/authorizations/:auth_id` MUST require the operator to be an **owner or administrator** of the org (`authorizeOrg(req, 'oauth.consent.approve', slug)`), issue an authorization code via the unchanged `issueCode` (bound to `client_id, user_id, redirect_uri, code_challenge, scope` — **no `org_id` column**), emit an `oauth.code.issued` audit entry, atomically consume the `auth_id`, and — when called with `?skip_browser_redirect=true` (the Studio path) — return `201 { url: "redirect_uri?code=<code>&state=<state>" }`; without the flag it MUST `302` to that URL.

- **FR-004**: `DELETE /platform/organizations/:slug/oauth/authorizations/:auth_id` (the deny path) MUST require owner/administrator of the org, atomically consume the `auth_id`, issue no code, emit an `oauth.consent.denied` audit entry, and return `200 { id: <auth_id> }`. It does not redirect to the client callback (the Studio page navigates the operator away).

- **FR-005**: The dashboard consent page at `/dashboard/authorize` is the existing upstream Studio page (`apps/studio/pages/authorize.tsx`) — **satisfied by Studio, no work in this feature**. It already calls `GET /platform/oauth/authorizations/:auth_id` and renders client name, human-readable scopes, redirect domain, the signed-in user, and Authorize/Deny controls.

- **FR-006**: Unauthenticated access to `/dashboard/authorize?auth_id=...` is gated by the Studio page's own auth wrapper (`withAuth`) — **satisfied by Studio, no work in this feature**. This feature's `GET /v1/oauth/authorize` performs no auth check (it only validates params, stores the session, and redirects).

- **FR-007**: The `auth_id` storage MUST have a 10-minute TTL. Expired entries MUST return `404`.

- **FR-008**: The existing `POST /v1/oauth/authorize` form-submission handler MUST be removed. The `/v1/oauth/authorize` endpoint becomes GET-only (this moves the surface toward upstream Supabase parity, which has no `POST /v1/oauth/authorize`).

- **FR-009**: Human-readable scope descriptions are rendered by the upstream Studio consent page — **satisfied by Studio, no work in this feature**.

- **FR-010**: The organization selector (which org the token is issued for) is provided by the upstream Studio consent page — **satisfied by Studio, no work in this feature**.

### Key Entities

- **OAuth Authorization Session**: Short-lived server-side record keyed by `auth_id` (UUID). Stores full OAuth params: `client_id`, `redirect_uri`, `state`, `code_challenge`, `code_challenge_method`, `scope`, `created_at`. TTL: 10 minutes. Consumed on first code issuance or denial.

- **OAuth Authorization Code**: Existing entity (issued by `oauth-codes-store`). **Unchanged** — no new column, no migration. The org context lives only in the request path and the audit log, not on the code row.

- **OAuth Client**: Existing entity (registered clients in DB). No change to schema.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An MCP client completes the full OAuth PKCE flow (authorize → consent → callback → token) in under 60 seconds on a standard browser.

- **SC-002**: The authorization URL shown to the user contains only `?auth_id=UUID` — no raw PKCE challenge, redirect URI, or state visible in the browser URL bar on the consent page.

- **SC-003**: Expired or replayed `auth_id` references are rejected with an appropriate error in 100% of cases (no stale sessions can be reused).

- **SC-004**: The scopes returned by `GET /platform/oauth/authorizations/:auth_id` (as a `string[]`) cover all scopes Supabase MCP clients request (`organizations:read`, `projects:read/write`, `database:read/write`, `storage:read`, `secrets:read`, `edge_functions:read/write`, `environment:read/write`, `analytics:read`); the human-readable rendering of that list is owned by the upstream Studio page (not verified by this feature's tests).

- **SC-005**: The existing token exchange endpoint (`POST /v1/oauth/token`) continues to work without change after codes are issued via the new flow.

## Assumptions

- The existing `oauth-codes-store` and `POST /v1/oauth/token` token-exchange endpoint are not modified; only the authorization entry point and consent UI change.
- Authorization sessions (`auth_id` → params) are stored in Redis (already used for OAuth code TTL and revocation lists) rather than a new DB table, to keep the flow stateless from the database perspective.
- The dashboard consent page is the **existing upstream Studio page** (`apps/studio/pages/authorize.tsx`), served at `https://<apex>/dashboard/authorize`. No `apps/web` page is built; there are no frontend changes in this feature.
- Multi-org support: for supastack v1, operators typically have one organization; the Studio consent page shows an org selector only if multiple orgs exist, defaulting to the named/first one.
- The `GET /platform/oauth/authorizations/:id` response shape matches what the Studio consent page reads (`name`/`website`/`icon`/`domain`/`scopes`/`expires_at`/`approved_at`/`approved_organization_slug`), confirmed from the Studio source and the captured HAR.
- Human-readable scope labels are owned by the Studio consent page; the backend only returns the raw `scopes` array.
