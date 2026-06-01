# Contract — `GET /v1/oauth/authorize`

**Purpose**: Authorization Code + PKCE flow entrypoint per OAuth 2.1 / RFC 6749. Browser-facing.

## Request

```http
GET /v1/oauth/authorize?
  response_type=code&
  client_id=<uuid>&
  redirect_uri=http%3A%2F%2Flocalhost%3A56831%2Fcallback&
  state=<opaque>&
  code_challenge=<base64url(sha256(verifier))>&
  code_challenge_method=S256&
  scope=platform
Cookie: supastack_session=<existing dashboard session cookie>
```

| Param | Required | Notes |
|---|---|---|
| `response_type` | Yes | MUST be `code`. Other values → 400 `unsupported_response_type`. |
| `client_id` | Yes | Must exist in `oauth_clients`. Else → 400 `invalid_client`. |
| `redirect_uri` | Yes | Must EXACTLY match one of the client's registered `redirect_uris`. Else → 400 `invalid_request`. |
| `state` | Yes | Opaque value echoed back to client. We don't enforce length but recommend ≥32 chars in docs. |
| `code_challenge` | Yes | Base64url-encoded SHA-256 of the verifier per RFC 7636. |
| `code_challenge_method` | Yes | MUST be `S256`. `plain` rejected (OAuth 2.1 hardening) → 400 `invalid_request`. |
| `scope` | No (default `platform`) | v1 supports only `platform`. Unknown scopes → 400 `invalid_scope`. |

## Auth check (session cookie)

1. If valid dashboard session cookie → render consent UI.
2. If no/invalid session → 302 to `https://<apex>/dashboard/login?next=<urlencoded(authorize_url)>`. After successful login, dashboard redirects back to the authorize URL. Authorize resumes from step 1.

## Consent UI

Server-rendered HTML page. Shows:

- The requesting client's `client_name` + `redirect_uris`
- The operator's current identity (email)
- A neutral "MCP client" label (no "verified" badge per Clarifications Q4)
- The requested scope, human-readable: "Full platform access (read and manage all your projects)"
- Two buttons: **Authorize** + **Deny**

## On Authorize click

```http
HTTP/1.1 302 Found
Location: <redirect_uri>?code=<opaque>&state=<echoed state>
```

- Insert `oauth_codes` row: `(code, client_id, user_id, redirect_uri, code_challenge, scope, expires_at = now() + 60s)`
- Emit audit `oauth.code.issued`

## On Deny click

```http
HTTP/1.1 302 Found
Location: <redirect_uri>?error=access_denied&state=<echoed state>
```

- Emit audit `oauth.consent.denied`

## Error responses

Errors that occur BEFORE the consent UI (validation failures) return JSON with status 400:

```json
{ "message": "redirect_uri does not match any registered URI", "code": "invalid_request" }
```

Errors that occur AFTER consent is presented but during code issuance redirect back to client per RFC 6749 §4.1.2.1:

```http
Location: <redirect_uri>?error=server_error&state=<echoed>
```

## Test obligations

- Valid request with valid session → 200 + consent HTML
- Valid request, no session → 302 to login
- Invalid `redirect_uri` (not in allow-list) → 400 `invalid_request` (do NOT redirect)
- `code_challenge_method=plain` → 400 `invalid_request`
- Unknown `client_id` → 400 `invalid_client`
- POST to Authorize → 302 to redirect_uri with `code` + `state`; row inserted; audit emitted
- POST to Deny → 302 to redirect_uri with `error=access_denied`; audit emitted
