# Contract: OAuth Authorize Entry Point

## GET /v1/oauth/authorize

**Purpose**: OAuth 2.1 PKCE authorization endpoint. Validates params, stores session server-side, and redirects to the Studio consent page.

**Auth**: None required (unauthenticated browser request)

### Request

| Param | Type | Required | Validation |
|-------|------|----------|------------|
| `response_type` | string | yes | Must be `"code"` |
| `client_id` | UUID | yes | Must match a registered `oauth_clients` row |
| `redirect_uri` | URL | yes | Must be in client's `redirect_uris` allow-list |
| `state` | string | yes | min length 1 |
| `code_challenge` | string | yes | 43–128 chars (S256 base64url-encoded SHA-256) |
| `code_challenge_method` | string | yes | Must be `"S256"` |
| `scope` | string | no | Space-separated; unknown scopes are silently accepted (pass-through) |

### Responses

**303 (unauthenticated or valid request)**:
```
Location: https://<apex>/dashboard/authorize?auth_id=<UUID>
```
A new auth session is stored in Redis (TTL 600s). The session is NOT created if the request fails validation.

**400 (validation error)**:
```json
{ "error": "invalid_request", "error_description": "..." }
```
Possible error codes: `unsupported_response_type`, `invalid_client`, `invalid_request`, `invalid_scope`.

### Behavior change from pre-115

Before: Rendered inline HTML consent form, accepted `POST /v1/oauth/authorize` for form submission.
After: Pure redirect; `POST /v1/oauth/authorize` is removed. The `GET` handler creates a Redis session and immediately redirects.

---

## GET /platform/oauth/authorizations/:id

**Purpose**: Load pending authorization details for the Studio consent page.

**Auth**: Required (GoTrue access-token cookie or Bearer JWT). Any authenticated user can read a pending session (the `auth_id` is a capability token).

**RBAC action**: `oauth.consent.read`

### Path params
| Param | Description |
|-------|-------------|
| `id` | The `auth_id` UUID from the consent page URL |

### Response 200
```json
{
  "name": "Claude Code MCP",
  "website": "https://claude.ai",
  "icon": null,
  "domain": "localhost",
  "scopes": ["organizations:read", "projects:read", "projects:write"],
  "expires_at": "2026-06-08T16:10:00.000Z",
  "approved_at": null,
  "approved_organization_slug": null
}
```

### Response 404
```json
{ "error": "not_found", "message": "Authorization session not found or expired" }
```
Returned when `auth_id` does not exist in Redis (expired or never created).

---

## POST /platform/organizations/:slug/oauth/authorizations/:id

**Purpose**: Approve an OAuth authorization request. Issues an authorization code.

**Auth**: Required. User must be a member of org `:slug`.

**RBAC action**: `oauth.consent.approve` (checked against the org)

**Query params**:
| Param | Type | Description |
|-------|------|-------------|
| `skip_browser_redirect` | `"true"` | When set, returns `{ url }` instead of redirecting (used by Studio) |

### Request body
None required (the decision is implied by calling POST vs DELETE).

### Response 201 (with `skip_browser_redirect=true`)
```json
{ "url": "http://localhost:65349/callback?code=<code>&state=<state>" }
```

### Response 302 (without `skip_browser_redirect`)
```
Location: http://localhost:65349/callback?code=<code>&state=<state>
```

### Response 404
Session not found or expired.

### Response 403
User is not a member of org `:slug`.

### Side effects
- Auth session is consumed (atomically deleted from Redis — replay returns 404)
- Authorization code issued via existing `issueCode()` (bound to client_id, user_id, redirect_uri, code_challenge, scope)
- Audit log entry: `oauth.code.issued`

---

## DELETE /platform/organizations/:slug/oauth/authorizations/:id

**Purpose**: Decline an OAuth authorization request.

**Auth**: Required. User must be a member of org `:slug`.

**RBAC action**: `oauth.consent.approve` (same gate — membership check is what matters)

### Response 200
```json
{ "id": "<auth_id>" }
```

### Side effects
- Auth session is consumed (deleted from Redis)
- No authorization code issued
- Browser redirect handled by Studio (navigates to `/organizations`)
- Audit log entry: `oauth.consent.denied`
