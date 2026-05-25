# Contract — `GET /platform/cli/login/:session_id` (CLI-facing)

**Purpose**: The upstream supabase CLI polls this endpoint with its session_id + the verification code the operator pasted. On match, the endpoint returns the encrypted PAT bundle and deletes the Redis entry (single-use).

**Auth**: NONE. The endpoint is anonymous. Security comes from:
1. `session_id` is a UUID v4 (122 bits of entropy) — unguessable
2. `device_code` is a per-session 32-bit secret — `2^32 ≈ 4 billion` combinations, 5-minute TTL
3. Wrong device_code returns 404 indistinguishable from "no such session" (no enumeration)

**Path**: `/platform/cli/login/:session_id` — mounted at root (NO prefix), reachable on `api.<apex>` via the existing reverse-proxy. This path is upstream-CLI-dictated; cannot be moved.

---

## Request

```http
GET /platform/cli/login/21f7bcf6-d8a6-43a0-b9d7-74f568073cf5?device_code=91cbae4c HTTP/1.1
Host: api.supaviser.dev
User-Agent: SupabaseCLI/2.101.0
```

**Param validation:**

| Param | Rule | On failure |
|---|---|---|
| `:session_id` (path) | UUID v4 | 404 (uniform error shape) |
| `device_code` (query) | 8 lowercase hex chars | 404 (uniform error shape) |

---

## Response

### `200 OK` — match

```json
{
  "id": "21f7bcf6-d8a6-43a0-b9d7-74f568073cf5",
  "created_at": "2026-05-25T13:30:00.000Z",
  "access_token": "<hex of AES-GCM ciphertext concatenated with 16-byte auth tag — matches Go's `cipher.Seal` output format; see cli-wire-protocol.md for the encryption byte-layout requirement>",
  "public_key": "04<hex 128 chars — server's ECDH-P256 uncompressed public key>",
  "nonce": "<hex 24 chars — 12-byte GCM nonce>"
}
```

**Field shape MUST match** the upstream CLI's `AccessTokenResponse` Go struct (verified against `apps/cli-go/internal/login/login.go` lines 38–44).

**Side effect**: Redis DEL `selfbase:cli-login:<session_id>` immediately after the response is serialized. Single-use; second poll returns 404.

### `404 Not Found` — uniform error for all failure modes

```json
{ "message": "session not found" }
```

Returned for ALL of:
- session_id is not a valid UUID
- device_code is not 8 hex chars
- Redis has no key for this session_id (never created OR already consumed OR TTL expired)
- Redis has the key but `device_code` doesn't match

**Critical**: The response body MUST be byte-identical across all 4 cases (SC-007). No timing-side-channel either — Redis lookup happens unconditionally even when validation fails.

### `500 Internal Server Error`

```json
{ "message": "internal server error" }
```

For unexpected errors (Redis unreachable, deserialization failure). NOT for any "session not found" condition.

---

## CORS

The CLI is not a browser; no preflight / no Origin header expected. The endpoint does NOT need CORS headers. If the global error handler currently sets `Access-Control-Allow-Origin` for every response, that's fine — the CLI ignores it.

## Rate limiting

Not implemented in v1. Justification:
- Brute-forcing a single session_id requires both knowing the UUID v4 (~5 × 10^36 combos) AND brute-forcing the 32-bit device_code within the 5-min TTL
- Even at 10,000 requests/sec sustained, average attempts to hit one specific session in its TTL window: ~3M attempts vs ~4B keyspace = 0.07% success probability
- The endpoint is single-use (DEL on success), so a successful hit consumes the session and prevents further attempts

If abused in practice, add a per-`session_id` attempt counter in Redis with cap (e.g., 100 attempts) before adding global rate limiting.

---

## Contract test obligations

`apps/api/tests/contract/cli-login.contract.test.ts` must cover:

1. **Happy path**: pre-populate Redis with valid session bundle → GET with matching device_code → 200, response shape matches the spec, Redis key is DELETED after response
2. **Indistinguishable 404s (SC-007)**: capture response body bytes for (a) unknown session_id, (b) malformed session_id, (c) malformed device_code, (d) correct session_id but wrong device_code, (e) correct session_id, expired (TTL passed). All five MUST produce byte-identical response bodies.
3. **Single-use**: GET twice in succession — first returns 200, second returns 404.
4. **TTL expiry**: pre-populate Redis with TTL=1, sleep 2, GET → 404.
5. **No auth headers**: GET with no Authorization, no cookies → still 200 on valid session+code (anonymous endpoint).
