# Contract — `POST /v1/oauth/register`

**Purpose**: RFC 7591 Dynamic Client Registration. Required by MCP spec for unknown clients.

## Request

```http
POST /v1/oauth/register
Content-Type: application/json

{
  "client_name": "Claude Code",
  "redirect_uris": ["http://localhost:56831/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "logo_uri": "https://...",
  "tos_uri": "https://...",
  "policy_uri": "https://..."
}
```

`client_name` and `redirect_uris` are required. All other fields are optional RFC 7591 metadata and stored verbatim in `oauth_clients.metadata` for future use (not displayed in v1).

## Response

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "client_id": "<uuid>",
  "client_name": "Claude Code",
  "redirect_uris": ["http://localhost:56831/callback"],
  "token_endpoint_auth_method": "none",
  "grant_types": ["authorization_code", "refresh_token"],
  "response_types": ["code"],
  "client_id_issued_at": 1748000000
}
```

For v1, we issue **public clients only** (no `client_secret`). The `token_endpoint_auth_method` echoes back `"none"`. This matches MCP spec expectations (PKCE-based authentication is the v1 client-auth posture, per Assumptions).

## Validation rules

| Rule | Failure |
|---|---|
| `client_name` non-empty + ≤200 chars | 400 `invalid_client_metadata` |
| `redirect_uris` is array of ≥1 valid URLs (http or https schemes only) | 400 `invalid_redirect_uri` |
| `redirect_uris` each ≤2048 chars | 400 `invalid_redirect_uri` |
| `grant_types` if present is subset of `[authorization_code, refresh_token]` | 400 `invalid_client_metadata` |
| `response_types` if present is subset of `[code]` | 400 `invalid_client_metadata` |
| Rate limit: 10 registrations per IP per hour | 429 `rate_limited` + `Retry-After` header |

## Error responses

Per RFC 7591 §3.2.2:

```json
{ "error": "invalid_client_metadata", "error_description": "client_name must be ≤200 chars" }
```

```json
{ "error": "rate_limited", "error_description": "10 registrations per hour exceeded; retry in 1247 seconds" }
```

## Side effects

On success:
- INSERT `oauth_clients` row
- Emit audit `oauth.client.registered` with `requesting_ip`

## Test obligations

- Valid minimal request (`client_name` + `redirect_uris` only) → 201 + `client_id`
- Missing `redirect_uris` → 400 `invalid_client_metadata`
- Empty `redirect_uris` array → 400 `invalid_redirect_uri`
- `redirect_uri` with `javascript:` scheme → 400 `invalid_redirect_uri`
- `client_name` >200 chars → 400 `invalid_client_metadata`
- 11th request from same IP within 1 hour → 429 `rate_limited`
- `metadata` extras (`logo_uri` etc.) are preserved in DB but not echoed in response (yet)
