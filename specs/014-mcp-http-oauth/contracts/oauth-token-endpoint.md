# Contract — `POST /v1/oauth/token`

**Purpose**: Exchange authorization code or refresh token for an access token. Per RFC 6749 + RFC 7636 (PKCE).

## Request — grant_type=authorization_code

```http
POST /v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code=<from authorize redirect>
&redirect_uri=<must match code's redirect_uri>
&client_id=<uuid>
&code_verifier=<PKCE verifier; base64url[43..128]>
```

## Request — grant_type=refresh_token

```http
POST /v1/oauth/token
Content-Type: application/x-www-form-urlencoded

grant_type=refresh_token
&refresh_token=<previously-issued opaque token>
&client_id=<uuid>
```

(Optional `scope` param to narrow scopes — for v1, only the original scope is allowed; passing a different scope → 400.)

## Response (success — both grant types)

```http
HTTP/1.1 200 OK
Content-Type: application/json
Cache-Control: no-store

{
  "access_token": "<JWT, HS256, ~600 chars>",
  "token_type": "Bearer",
  "expires_in": 3600,
  "refresh_token": "<opaque new token; old one rotated>",
  "scope": "platform"
}
```

JWT claims:
```json
{
  "iss": "https://api.<apex>",
  "sub": "<user_id>",
  "aud": "https://mcp.<apex>",
  "azp": "<client_id>",
  "scope": "platform",
  "jti": "<uuid v4 — used as Redis revocation key>",
  "iat": 1748000000,
  "exp": 1748003600
}
```

## Validation rules

For `authorization_code`:
- `code` row MUST exist in `oauth_codes`, MUST NOT be expired, MUST NOT have `used_at` set
- `redirect_uri` MUST match the stored value
- `client_id` MUST match the stored value
- `code_verifier`: compute `base64url(sha256(code_verifier))`; MUST equal stored `code_challenge`
- On success: mark `used_at = now()` (any subsequent use returns `invalid_grant` AND triggers revocation of any tokens already issued for this code, per RFC 6749 §10.5)

For `refresh_token`:
- `refresh_token` row MUST exist, NOT be `revoked_at`-set
- `client_id` MUST match the stored value
- Rotation: delete current row, insert new row with new opaque token, return the new token as `refresh_token` in response
- Reuse-detection: if a token whose `previous_token` was already replaced is presented, REVOKE the entire grant (delete all refresh tokens for this user+client, add their access tokens to Redis revocation set), return 400 `invalid_grant`. RFC 6749 §10.4.

## Error responses

Per RFC 6749 §5.2 envelope:

```json
{ "error": "invalid_grant", "error_description": "authorization code expired" }
```

| `error` | When |
|---|---|
| `invalid_request` | Missing required param; malformed body |
| `invalid_client` | Unknown `client_id` |
| `invalid_grant` | Code expired/used; PKCE verification failed; refresh token revoked/unknown; reuse detected |
| `unsupported_grant_type` | grant_type not in {authorization_code, refresh_token} |
| `invalid_scope` | Scope mismatch on refresh |

Status code: 400 for all `invalid_*`. 500 for internal errors (audit + log; don't leak details).

## Side effects

On `authorization_code` success:
- INSERT `oauth_refresh_tokens` row
- Audit `oauth.token.issued`
- Mark code used

On `refresh_token` success:
- DELETE old `oauth_refresh_tokens` row, INSERT new with `previous_token` = old token
- Audit `oauth.token.refreshed` with `{ jti_old, jti_new }`
- The OLD access token's `jti` is NOT auto-added to revocation set — it will expire naturally within the hour. (Aggressive revoke-on-refresh would force re-validation overhead for in-flight requests for no security gain when access TTL is 1h.)

On reuse detection:
- DELETE all `oauth_refresh_tokens` for (user, client)
- Add all known active jtis for that grant to Redis revocation (best-effort — we don't track every jti issued, but the most-recent access token is recoverable from the grant's most recent issue)
- Audit `oauth.token.revoked` with `reason = "refresh_reuse_detected"`
- Return 400 `invalid_grant`

## Test obligations

- Valid code exchange returns 200 + JWT + refresh token; row inserted; code marked used
- Reused code → 400 `invalid_grant`; existing tokens for this code revoked
- Wrong `code_verifier` → 400 `invalid_grant`
- Wrong `redirect_uri` → 400 `invalid_grant`
- Wrong `client_id` → 400 `invalid_grant`
- Valid refresh exchange returns 200 + new JWT + new refresh; old refresh row deleted
- Refresh reuse → 400 `invalid_grant` + grant revoked
- Refresh of revoked token → 400 `invalid_grant`
- Issued JWT verifies against HKDF-derived key; `exp` is now + 3600
- Issued JWT `jti` is a fresh UUID
