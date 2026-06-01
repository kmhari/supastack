# Research — 011 CLI device-code login

**Date**: 2026-05-25

All scope clarifications resolved in spec.md → Clarifications (Session 2026-05-25). The decisions below cover the technical specifics needed to implement against those clarified requirements + lock down the wire-contract details against the upstream CLI implementation.

---

## Decision 1 — Wire protocol byte-for-byte from `supabase/cli`

**Decision**: Conform exactly to the upstream CLI's protocol as implemented in `apps/cli-go/internal/login/login.go` (HEAD of `develop`). Specifically:

| Aspect | Value |
|---|---|
| ECDH curve | NIST P-256 (`prime256v1`) — Go's `crypto/ecdh.P256()` |
| Public key encoding | Hex-encoded uncompressed point: `04` + 64 bytes (X) + 64 bytes (Y) = 130 hex chars (65 bytes raw) |
| Shared secret | 32 bytes from ECDH; used directly as AES key (no KDF) |
| Symmetric cipher | AES-256-GCM (Go's `aes.NewCipher` with 32-byte key → 256-bit) |
| Nonce | 12 bytes, random (`crypto/rand.Read`) |
| Ciphertext encoding | Hex |
| Polling URL | `GET <api_url>/platform/cli/login/<session_id>?device_code=<code>` |
| Polling auth | None (anonymous; security via UUID + 32-bit code in 5-min window) |
| Polling response | JSON `{ id: string, created_at: ISO8601, access_token: hex, public_key: hex, nonce: hex }` |
| Polling retries | CLI does max 2 retries with `ZeroBackOff` (verified in `pollForAccessToken`) |
| Dashboard URL | `<dashboard_url>/cli/login?session_id=<uuid>&token_name=<…>&public_key=<hex>` |

**Rationale**: The wire contract IS the requirement. Any byte-level deviation breaks the upstream CLI.

**Alternatives considered**:
- Implement a richer "device-code grant" (OAuth 2.0 RFC 8628) — rejected; CLI doesn't speak it.
- Use AES-128-GCM (some legacy docs claim it) — rejected; verified upstream uses the full 32-byte ECDH secret which forces AES-256.

**Verified via**: Direct read of `https://raw.githubusercontent.com/supabase/cli/develop/apps/cli-go/internal/login/login.go` lines 64–124 (`decryptAccessToken` function) + lines 191–198 (URL construction).

---

## Decision 2 — Node 20 stdlib for all crypto

**Decision**: Use only `node:crypto` primitives — no `noble-curves`, no `tweetnacl`, no new dep.

```ts
import { createECDH, createCipheriv, randomBytes, randomUUID } from 'node:crypto';

const serverKey = createECDH('prime256v1');
serverKey.generateKeys();                                  // returns publicKey:Buffer (uncompressed, 65 bytes)
const clientPub = Buffer.from(clientPubHex, 'hex');         // 65 bytes
const sharedSecret = serverKey.computeSecret(clientPub);    // 32 bytes
const nonce = randomBytes(12);
const cipher = createCipheriv('aes-256-gcm', sharedSecret, nonce);
const ct = Buffer.concat([cipher.update(patPlaintext, 'utf8'), cipher.final()]);
const tag = cipher.getAuthTag();
const accessTokenHex = Buffer.concat([ct, tag]).toString('hex');   // Go's GCM appends tag → match
```

**Critical detail**: Node's `createCipheriv('aes-256-gcm', …)` does NOT append the auth tag to the ciphertext by default — you must `getAuthTag()` and concat. Go's `cipher.NewGCM(...).Seal(nil, nonce, plaintext, nil)` DOES append the 16-byte tag to the ciphertext. **Match by concatenating `[ct, tag]` in Node.** This is the one footgun in the implementation.

**Rationale**: Zero added deps, well-audited primitives, the API is small enough that the footgun above is the only thing to worry about. Test vectors from the upstream CLI's `login_test.go` will prove correctness.

**Alternatives considered**:
- `noble-curves` (pure-JS, audited): pulls in 200KB+ for behavior already in stdlib.
- `tweetnacl` (Curve25519, not P-256): wrong curve, rejected.

---

## Decision 3 — Redis storage shape + key namespace

**Decision**: Reuse the existing `Redis` connection (currently used by `connect-redis` for session cookies at `supastack:sess:*`). New key namespace: `supastack:cli-login:<session_id>`. Payload: JSON-encoded object (UTF-8), TTL set via `SET ... EX 300`.

```
KEY:   supastack:cli-login:<uuid>
VALUE: {
  "device_code": "91cbae4c",
  "access_token": "<hex ciphertext+tag>",
  "public_key":   "<hex server uncompressed P-256 pub>",
  "nonce":        "<hex 12 bytes>",
  "created_at":   "2026-05-25T13:30:00.000Z",
  "user_id":      "<uuid of operator>"
}
TTL:   300s (5 min)
```

Service wrapper (`apps/api/src/services/cli-login-store.ts`):

```ts
export async function putSession(sessionId: string, payload: SessionPayload): Promise<void>
export async function getSessionAndConsume(sessionId: string, deviceCode: string): Promise<SessionPayload | null>
export async function sessionExists(sessionId: string): Promise<boolean>   // for replay check
```

- `getSessionAndConsume` does Redis `GET` → if found and `device_code` matches → Redis `DEL` → return payload. Otherwise return `null`.
- The DEL-on-read pattern is single-use; second poll attempt returns `null`.
- For replay detection on the dashboard side (FR-005), `sessionExists` does a simple `EXISTS` BEFORE the dashboard tries to mint a fresh session — if it's already there, render the error state.

**Rationale**: Reuses the connection we already have. TTL handles abandoned sessions. DEL-on-read is the cleanest single-use semantic.

**Alternatives considered**:
- Postgres table — overkill for a 5-min ephemeral payload; row vacuum noise.
- In-memory Map — fails across api container restarts.

---

## Decision 4 — `source` column on `api_tokens`

**Decision**: Add a nullable text column `source` with default `'manual'` and CHECK constraint `source IN ('manual', 'cli')`. The dashboard's `SettingsTokens` page renders a small badge for `source = 'cli'` rows.

Migration `packages/db/migrations/0012_api_tokens_source.sql`:

```sql
ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_source_check'
  ) THEN
    ALTER TABLE api_tokens
      ADD CONSTRAINT api_tokens_source_check CHECK (source IN ('manual', 'cli'));
  END IF;
END $$;
```

Idempotent. Existing rows backfill to `'manual'` via the default.

Drizzle schema add:

```ts
source: text('source').notNull().default('manual'),  // 'manual' | 'cli'
```

**Rationale**: Tiny additive change, no schema disruption, makes the dashboard distinction trivial (just `row.source === 'cli'`). The label prefix alternative (`cli_…`) is fragile because labels are user-set on manual tokens too.

**Alternatives considered**:
- Label prefix convention — fragile; users could legitimately label a manual token starting with `cli_`.
- Separate `cli_tokens` table — duplicates the auth-lookup logic; harder to revoke uniformly.

---

## Decision 5 — Dashboard page state machine

**Decision**: The `/dashboard/cli/login` React component has 4 visible states determined by URL params + a one-shot effect:

```
URL params present + session unused        → "minting" (briefly) → "code-display"
URL params present + session already used  → "error" (replay)
URL params malformed                       → "error" (validation)
No session cookie                          → <Navigate to="/login?next=..."> (handled by SetupGate-style wrapper)
```

Mint is a single `POST /api/v1/cli/login` from the page on mount, body `{ session_id, token_name, public_key }`. The api returns either `{ device_code }` (success → code-display) or `{ error: { code: 'session_in_use' | 'invalid_params' } }` (→ error state).

After mint, the page calls `history.replaceState` to drop `session_id`/`token_name`/`public_key` from the URL bar (replace with `?device_code=…` for a clean shareable URL state) — matches the Cloud UX from the screenshot.

**Rationale**: Mirrors Cloud's observable behavior. The 4 states cover all observed user paths. `history.replaceState` is purely cosmetic — the actual security relies on the Redis single-use guard.

**Alternatives considered**:
- Two separate routes (`/dashboard/cli/login` for mint + `/dashboard/cli/login/confirm` for display) — splits state across routes; the Cloud single-URL approach is cleaner.

---

## Decision 6 — `next=` parameter validation

**Decision**: When `Login.tsx` reads `?next=…` from the URL on submit success, validate:
1. Decoded URL starts with `/`
2. Decoded URL does NOT start with `//` (protocol-relative open redirect)
3. Decoded URL does NOT contain `://`

Anything else → redirect to `/dashboard` (current default). Implementation:

```ts
function safeNext(raw: string | null): string {
  if (!raw) return '/dashboard';
  const decoded = decodeURIComponent(raw);
  if (!decoded.startsWith('/')) return '/dashboard';
  if (decoded.startsWith('//')) return '/dashboard';
  if (decoded.includes('://')) return '/dashboard';
  return decoded;
}
```

**Rationale**: Standard open-redirect defense. Three simple checks cover all known bypass patterns. Cleaner than a strict prefix-match against `/dashboard/cli/login` because operators landing on `/login?next=…` from other parts of the dashboard should still work.

**Alternatives considered**:
- Strict prefix `next` must start with `/dashboard/cli/login` — too narrow; reusable redirect-after-login is broadly useful.
- Server-side validation via signed `next` token — overengineered for v1.

---

## Decision 7 — Polling endpoint URL mounting

**Decision**: Mount as a Fastify route at the root path `/platform/cli/login/:session_id` (no prefix), reachable on `api.<apex>` via the existing reverse-proxy to `api:3001`. No Caddy or auth-plugin changes — the existing `app.preHandler` auth plugin already short-circuits unauthenticated requests only for routes that explicitly require auth (this one doesn't). The route handler itself does no `app.authorize` or `app.requireAuth` call.

**Rationale**: `api.<apex>` is already wired to proxy the whole hostname to `api:3001`. The CLI hits `https://api.supaviser.dev/platform/cli/login/<id>?device_code=<code>` — Caddy forwards verbatim. Fastify routes the path. No infrastructure changes.

**Alternatives considered**:
- Mount under `/api/v1/platform/...` — breaks the CLI's hardcoded path expectation.
- Separate process for the `/platform/*` surface — pointless complexity.

---

## Decision 8 — Test vectors

**Decision**: For unit-testing the crypto, use known-good vectors derived by running a 1-shot Go test against the upstream CLI's `LoginEncryption` type. Capture: client private key (PEM or hex), client public key (hex), server private key, server public key, shared secret, nonce, plaintext, ciphertext+tag (hex). Hardcode these into `cli-login-crypto.test.ts` as the source-of-truth.

This catches the "auth tag concatenation" footgun (Decision 2) at the unit-test layer, well before any live VM testing.

```ts
const VECTOR = {
  clientPrivHex: '...',
  clientPubHex: '04...',
  serverPrivHex: '...',
  serverPubHex: '04...',
  sharedSecretHex: '...',  // 32 bytes
  nonceHex: '...',         // 12 bytes
  plaintext: 'sbp_0123456789abcdef0123456789abcdef01234567',
  ciphertextWithTagHex: '...', // ct (40 bytes) || tag (16 bytes) = 56 bytes = 112 hex
};
```

The implementation must encrypt the plaintext with the given keys + nonce and produce byte-identical ciphertext+tag.

**Rationale**: Catches Node ↔ Go interop bugs at the cheapest test layer.

**Alternatives considered**:
- Live E2E only — too slow, debugging-hostile.
- Property-based testing — fine but doesn't catch the Go-interop footgun specifically.

---

## Resolved NEEDS CLARIFICATION

All clarifications from spec.md Session 2026-05-25 are resolved:

| Clarification | Resolution |
|---|---|
| Confirm UX | Auto-mint on load (Cloud-style, screenshot-verified) |
| Token label | Use as-is from URL |
| Logged-out flow | `/login?next=<safe-relative>` bounce + return |
| Session reuse | Single-use error page (Cloud-style, screenshot-verified) |
| TTL | 5 minutes |
| Token visibility | Same list, `cli` badge |

Phase 0 complete. Proceeding to Phase 1 design.
