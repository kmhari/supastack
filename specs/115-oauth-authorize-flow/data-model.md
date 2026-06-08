# Data Model: OAuth Authorize Flow (Feature 115)

## New Entity: OAuthAuthSession (Redis)

**Storage**: Redis key `oauth:auth_session:<auth_id>` (UUID v4)
**TTL**: 600 seconds (10 minutes)
**Creation**: `SET oauth:auth_session:<UUID> <json> EX 600 NX`
**Consumption**: `GETDEL oauth:auth_session:<UUID>` (atomic read+delete; returns null if expired or already consumed)

**JSON shape stored** (superset of what the GET endpoint returns):
```json
{
  "auth_id": "UUID",
  "client_id": "UUID",
  "client_name": "string",
  "client_website": "string",
  "client_icon": "string | null",
  "client_domain": "string",
  "redirect_uri": "string",
  "state": "string",
  "code_challenge": "string",
  "code_challenge_method": "S256",
  "scopes": ["organizations:read", "projects:read", "..."],
  "created_at": "ISO-8601",
  "expires_at": "ISO-8601"
}
```

**Fields derived at store-time**:
- `client_name` / `client_website` / `client_icon` — read from `oauth_clients` row at `/v1/oauth/authorize` time
- `client_domain` — `new URL(redirect_uri).hostname`
- `scopes` — `scope_string.split(' ').filter(Boolean)`
- `expires_at` — `new Date(Date.now() + 600_000).toISOString()`

## Existing Entities (unchanged)

### oauth_clients
No changes. `metadata` JSONB field may optionally carry `website` and `icon` keys (used by consent UI).

### oauth_codes
**No changes** — no new column, no migration. Code issuance continues via the existing `issueCode()` function (`clientId, userId, redirectUri, codeChallenge, scope`). The org context is recorded in the request path and the audit log, **not** on the code row.

### oauth_refresh_tokens / oauth_revocations
No changes.

## GET /platform/oauth/authorizations/:id → ApiAuthorizationResponse

Maps stored session fields to the Studio's expected shape:
```ts
{
  name:    session.client_name,
  website: session.client_website,
  icon:    session.client_icon,
  domain:  session.client_domain,
  scopes:  session.scopes,
  expires_at: session.expires_at,
  approved_at: null,               // always null at this stage
  approved_organization_slug: undefined,
}
```

## POST (approve) → { url: string }

`url` = `<redirect_uri>?code=<issued_code>&state=<state>` (or with `&` if redirect_uri already has query params).
