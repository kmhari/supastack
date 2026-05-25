# Contract — `POST /api/v1/cli/login` (dashboard internal)

**Purpose**: The `/dashboard/cli/login` React page calls this endpoint on mount to mint a PAT for the signed-in user, encrypt it with the client-supplied ECDH public key, and stash the bundle in Redis under the supplied session_id.

**Auth**: Session cookie required. RBAC: any user who can already create a PAT (existing `token.create` permission — both admin and member).

**Idempotency**: NOT idempotent on `session_id`. Second call with the same `session_id` is REJECTED (see status codes).

---

## Request

```http
POST /api/v1/cli/login
Cookie: sb_sid=<session-cookie>
Content-Type: application/json

{
  "session_id": "21f7bcf6-d8a6-43a0-b9d7-74f568073cf5",
  "token_name": "cli_lord@apples-MacBook-Pro.local_1779716109",
  "public_key": "04eb4c9a5f7bc5a0eb9d72c3250423d1c4c53268090cc0b3a674e50b3c8af7716e142e7d5dc30746f010f9ee9a5f318c374fcdaa2141af85b9065c8deca1cf226b"
}
```

**Body validation:**

| Field | Rule |
|---|---|
| `session_id` | UUID v4 (lowercase 36-char form) |
| `token_name` | non-empty string, length ≤ 200 |
| `public_key` | exactly 130 lowercase hex chars beginning with `04`, decodes to a valid P-256 point |

## Response

### `200 OK` (success)

```json
{
  "device_code": "91cbae4c"
}
```

The dashboard immediately renders the code-display state with this value. The PAT itself is NOT returned to the dashboard (it's already encrypted into Redis for the CLI to fetch).

### `409 Conflict` — session_id already used

```json
{
  "error": {
    "code": "session_in_use",
    "message": "This CLI login session has already been used. Re-run `supabase login` in your terminal to get a fresh one."
  }
}
```

The dashboard renders the "Unable to create CLI sign-in" error state on this code.

### `422 Unprocessable Entity` — validation failure

```json
{
  "error": {
    "code": "invalid_params",
    "message": "<which field failed>",
    "details": { "field": "public_key" }
  }
}
```

Dashboard renders the error state with a generic message.

### `401 Unauthorized` — no session

```json
{ "error": { "code": "unauthenticated", "message": "Session expired. Please log in." } }
```

The dashboard's wrapper handles this by redirecting to `/login?next=…` BEFORE calling this endpoint, so a 401 here is an edge case (cookie expired between page load and POST).

---

## Side effects

On success:

1. **`api_tokens` row inserted** with:
   - `userId` = current session's user
   - `label` = request's `token_name`
   - `tokenSha256` = SHA-256 of the freshly generated `sbp_<40hex>` PAT
   - `prefix` = first 12 chars of the plaintext (for display)
   - `source` = `'cli'`
2. **Server ECDH-P256 keypair generated** (ephemeral, in-memory only)
3. **AES-256-GCM** with `(shared_secret, random_nonce)` encrypts the PAT plaintext; auth tag concatenated to ciphertext
4. **Redis SET** `selfbase:cli-login:<session_id>` to the JSON payload (see data-model.md) with `EX 300`

Audit-log row written? **No** — the existing PAT-create audit-log entry covers it; no need for a separate `cli.session.created` event in v1.

---

## Contract test obligations

`apps/api/tests/contract/cli-login.contract.test.ts` must cover:

1. **Happy path**: valid input → 200, response body shape, `api_tokens` row inserted with `source='cli'`, Redis key set with TTL 300
2. **Reuse**: second POST with same `session_id` → 409 `session_in_use`
3. **Malformed session_id**: 422 `invalid_params` with `details.field = 'session_id'`
4. **Malformed public_key**: 422 `invalid_params` with `details.field = 'public_key'`
5. **No session cookie**: 401 `unauthenticated`
6. **Member-role user**: 200 (any role with PAT-create permission works)
