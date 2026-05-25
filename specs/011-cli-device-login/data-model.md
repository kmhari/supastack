# Data Model — 011 CLI device-code login

**Date**: 2026-05-25

## Persistent (control-plane Postgres)

### `api_tokens` (existing — one column added)

| Column | Type | Notes |
|---|---|---|
| `id` | `uuid` PK | (existing) |
| `userId` | `uuid` FK → `users.id` | (existing) |
| `tokenSha256` | `bytea` UNIQUE | (existing) — hash of the `sbp_…` plaintext |
| `label` | `text` | (existing) — for CLI tokens this is the URL's `token_name` verbatim |
| `prefix` | `text` NULL | (existing) — first 12 chars of plaintext for display in tokens list |
| `lastUsedAt` | `timestamptz` NULL | (existing) — bumped on each Bearer auth |
| `revokedAt` | `timestamptz` NULL | (existing) — set on revoke |
| `createdAt` | `timestamptz` | (existing) |
| **`source`** | **`text` NOT NULL DEFAULT 'manual'** | **NEW** — `'manual'` for tokens created via the settings page; `'cli'` for tokens minted via the CLI device-code flow. CHECK constraint enforces the two allowed values. |

Migration `packages/db/migrations/0012_api_tokens_source.sql` is idempotent (uses `ADD COLUMN IF NOT EXISTS` + a `DO $$` block to guard the CHECK constraint).

Existing rows backfill to `'manual'` via the default — no data migration needed.

## Transient (Redis)

### CLI login session

Stored in the existing Redis instance (the same one `connect-redis` uses for dashboard session cookies) under a NEW key namespace.

| Aspect | Value |
|---|---|
| Key pattern | `selfbase:cli-login:<session_id>` where `session_id` is a UUID v4 |
| Value | JSON-encoded object (UTF-8 string) — see payload below |
| TTL | 300 seconds (5 minutes); set via `SET … EX 300` |
| Lifecycle | Created at dashboard mint time; deleted either on first successful CLI poll OR on TTL expiry, whichever first |

**Payload shape:**

```json
{
  "device_code": "91cbae4c",
  "access_token": "<hex string — AES-256-GCM ciphertext || 16-byte auth tag>",
  "public_key":   "<hex string — server's ECDH P-256 uncompressed public key, 65 bytes / 130 chars>",
  "nonce":        "<hex string — 12 bytes / 24 chars>",
  "created_at":   "2026-05-25T13:30:00.000Z",
  "user_id":      "<uuid — the operator who initiated the mint>"
}
```

| Field | Type | Notes |
|---|---|---|
| `device_code` | string, 8 lowercase hex | The "verification code" the operator pastes into the CLI |
| `access_token` | string, hex | The ENCRYPTED PAT. Decryption is done client-side by the CLI |
| `public_key` | string, hex (130 chars) | Server's ECDH-P256 public key the CLI uses to derive the shared secret |
| `nonce` | string, hex (24 chars) | GCM nonce |
| `created_at` | string, ISO8601 | Returned to CLI verbatim in the response |
| `user_id` | string, UUID | Not returned to the CLI; used for audit + diagnostic logging |

## In-memory entities (no persistence)

### ECDH server keypair (per-mint, ephemeral)

Generated fresh on each `POST /api/v1/cli/login` call:

```ts
{
  privateKey: Buffer,    // 32 bytes raw — Node's ECDH internal
  publicKey: Buffer      // 65 bytes — uncompressed P-256 point
}
```

Lives ONLY in the Node process for the duration of the mint handler. Used to compute the shared secret with the client's public key, then immediately discarded. NOT stored in Redis or anywhere else.

### Wire response (CliLoginResponse Zod schema in `@selfbase/shared`)

```ts
export const CliLoginResponseSchema = z.object({
  id:           z.string().uuid(),              // session_id
  created_at:   z.string().datetime(),
  access_token: z.string().regex(/^[0-9a-f]+$/), // hex
  public_key:   z.string().length(130).regex(/^04[0-9a-f]{128}$/),
  nonce:        z.string().length(24).regex(/^[0-9a-f]{24}$/),
});
export type CliLoginResponse = z.infer<typeof CliLoginResponseSchema>;
```

## Entity relationships

```
operator (browser, signed in)
  │
  │ POST /api/v1/cli/login { session_id, token_name, public_key }
  ▼
api process
  ├─ generates server ECDH-P256 keypair (ephemeral, in-memory only)
  ├─ derives shared secret with client's public_key
  ├─ mints PAT row in api_tokens (source='cli', label=token_name, userId=session user)
  │     │
  │     ▼
  │   api_tokens table  ────────────────►  /settings/tokens (existing UI, +badge)
  │
  ├─ encrypts PAT plaintext with AES-256-GCM (shared secret, random nonce)
  └─ stores encrypted bundle in Redis at selfbase:cli-login:<session_id>, TTL 300s
        │
        │ (later)
        ▼
CLI process polls
  GET /platform/cli/login/<session_id>?device_code=<8hex>
        │
        ▼
api process
  ├─ Redis GET; if match, DEL + return { id, created_at, access_token, public_key, nonce }
  └─ if no match, 404
        │
        ▼
CLI decrypts via own private key + ECDH, saves PAT plaintext to ~/.supabase/access-token
```

## Validation rules (cross-cutting)

| Rule | Enforced at |
|---|---|
| `session_id` is a valid UUID v4 (lowercase string form, 36 chars) | api (`POST /api/v1/cli/login`), dashboard query parsing |
| `token_name` length 1..200 | api |
| `public_key` is exactly 130 lowercase hex chars, begins with `04`, decodes to a valid P-256 point (curve check via Node's `ecdh.setPublicKey` throwing on invalid) | api |
| `device_code` is exactly 8 lowercase hex chars | api (`GET /platform/cli/login/:session_id`) — query param validation |
| `next=` on `/login?next=…` is a same-origin relative path (starts with `/`, not `//`, contains no `://`) | web (`Login.tsx`) |
| Session can only be minted once per `session_id` | api — `EXISTS` check in Redis before mint; if exists, return error code `session_in_use` for the dashboard to render error state |
| PAT label CHECK constraint | already on `api_tokens.label` from prior features (no length limit set; acceptable — token_name is bounded at the api layer) |
