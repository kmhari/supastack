# Data Model: T077 — Silent OAuth Token Refresh Validation

## No new entities

This feature adds no new database tables, columns, or schema migrations. All entities involved are read/written by existing infrastructure.

## Entities exercised (existing)

### `oauth_refresh_tokens` (existing, `packages/db/src/schema/`)

Fields relevant to this smoke:
- `token` — opaque base64url string, primary lookup key
- `client_id` — foreign key to DCR-registered client
- `user_id` — the operator's user ID
- `scope` — `platform`
- `previous_token` — set on rotation; used by reuse-detection
- `revoked_at` — null until revoked; set on reuse-detection or explicit revoke

State transitions observed by the smoke:
1. `issueRefresh` → row inserted, `revoked_at = null`
2. `rotateRefresh` after TTL expiry → old row deleted, new row inserted with `previousToken` = old token
3. New token is live; old token is gone (not revokable, not reusable)

## Outcome record format (in-memory / stdout)

Not a DB entity. Structured log lines emitted by the smoke script:

```
[T077] STEP: <step name> | STATUS: <http_code or "ok"> | ELAPSED: <seconds>s
[T077] PASS: SC-003 validated | total_elapsed: <seconds>s | issued_at: <ISO8601> | refreshed_at: <ISO8601>
[T077] FAIL: <reason> | step: <step_name> | status: <http_code> | body: <truncated_response>
```
