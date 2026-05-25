# Feature 011 — CLI device-code login

**Spec**: [specs/011-cli-device-login/spec.md](../../specs/011-cli-device-login/spec.md)
**Closes**: dashboard-side gap that forced operators to use `supabase login --token sbp_…`

## What changed

`supabase login` (with no flags) now works against selfbase exactly like it does against Supabase Cloud:

1. Operator runs `supabase login`
2. Browser opens `https://<apex>/dashboard/cli/login?session_id=…&token_name=…&public_key=…`
3. Dashboard auto-mints a Personal Access Token for the signed-in user, encrypts it with ECDH-P256 + AES-256-GCM against the client's public key, displays an 8-character verification code
4. Operator pastes the code into the terminal
5. CLI polls `https://api.<apex>/platform/cli/login/<session>?device_code=<code>`, gets back the encrypted bundle, decrypts with its private key, saves to `~/.supabase/access-token`

No more `sbp_…` token paste. No need to visit `/dashboard/settings/tokens` first.

## Architecture

```
operator terminal                          browser                                api process
   │                                          │                                       │
   │ supabase login                           │                                       │
   ├ generates ECDH-P256 keypair              │                                       │
   ├ session_id = uuid v4                     │                                       │
   ├ opens browser ───────────────────────────►                                       │
   │                                          │ /dashboard/cli/login?...              │
   │                                          ├ if no session → /login?next=… → back  │
   │                                          ├ POST /api/v1/cli/login ───────────────►
   │                                          │                                       │ mint PAT (source='cli')
   │                                          │                                       │ ECDH derive shared secret
   │                                          │                                       │ AES-256-GCM encrypt (12B nonce)
   │                                          │                                       │ append auth tag to ciphertext
   │                                          │                                       │ generateDeviceCode (4 random bytes hex)
   │                                          │                                       │ Redis SET selfbase:cli-login:<id>
   │                                          │                                       │   EX 300 with {device_code, access_token,
   │                                          │                                       │     public_key, nonce, …}
   │                                          │ ◄────────────────────────────── 200 {device_code}
   │                                          ├ replaceState → ?device_code=<code>    │
   │                                          ├ render "Authorize selfbase CLI"       │
   │ operator pastes code into terminal       │ + 8 monospace cells + Copy code btn   │
   │                                          │                                       │
   ├ GET /platform/cli/login/<id>?device_code=<code> ───────────────────────────────►
   │                                          │                                       │ Redis GET; verify device_code
   │                                          │                                       │ Redis DEL (single-use)
   │ ◄──────────────────────────────────── 200 {id, created_at, access_token,        │
   │                                              public_key, nonce}                  │
   ├ ECDH derive shared secret                                                        │
   ├ AES-256-GCM decrypt → sbp_<40hex>                                                │
   └ write ~/.supabase/access-token                                                   │
```

## Knobs / config

None. The TTL (5 min) and device_code length (8 hex) are constants; revisit only if Cloud's defaults change.

## Operator runbook

### Revoking a CLI session

CLI-minted tokens show in `/dashboard/settings/tokens` with a small `cli` badge next to the label. Click Revoke as you would for any token. The CLI on that laptop gets 401 on its next call; the operator re-runs `supabase login`.

### Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard shows "Unable to create CLI sign-in" | session_id already used (replay) | Re-run `supabase login` in the terminal to get a fresh session_id; the URL with the old one is invalid |
| CLI prints "cannot decrypt access token" | Wire-protocol mismatch (extremely unlikely; selfbase + upstream CLI agree on the bytes per the test-vector unit test) | Check `supabase --version` vs `infra/supabase-template/docker-compose.yml`'s edge-runtime version. If they diverge by >3 minor versions, file an issue and pin selfbase to a matching runtime. |
| CLI prints "Enter your verification code:" but operator never sees the code in the dashboard | Browser didn't open, or operator opened a different URL | Use the fallback link the CLI prints; copy it manually |
| Dashboard redirects to /login then back to /dashboard (not /dashboard/cli/login) | `?next=` didn't survive the bounce | Check that `RequireAuth` in `apps/web/src/App.tsx` is encoding `pathname + window.location.search`. Verify with browser devtools network tab. |
| HTTP 404 from polling endpoint when operator pastes the right code | Either: session expired (>5 min between dashboard visit and CLI paste), OR session was already consumed (single-use) | Re-run `supabase login` |

### Security notes

- The polling endpoint `/platform/cli/login/:session_id` is **unauthenticated by design** — security comes from session_id being a UUID v4 (~122 bits of entropy) AND device_code being a per-session 32-bit secret in a 5-minute window. Brute-forcing requires knowing the UUID first.
- All 404 responses from the polling endpoint are **byte-identical** to prevent session-existence enumeration (verified by unit test).
- The plaintext PAT exists in two places only: (1) the api process during mint+encrypt, (2) the CLI process after decrypt. NEVER in Redis (only ciphertext), NEVER in logs (verified by E2E log-grep).
- Open-redirect attacks on the post-login `?next=` are blocked by `safeNext()` (rejects external URLs, protocol-relative paths, encoded variants — see `apps/web/src/lib/safe-next.ts`).

### What if Cloud's wire protocol changes upstream?

Selfbase's tests pin against a hardcoded vector from the current `supabase/cli` `develop` branch. If the upstream changes ECDH curve, nonce length, response field names, or hex encoding, the test vector test in `apps/api/tests/unit/cli-login-crypto.test.ts` will fail. Update accordingly + bump the vector.

## Caveats

- Polling endpoint has no rate limiting in v1. Justification: 8-hex device_code (32 bits) + UUID v4 session_id (122 bits) + 5-min TTL = effectively unguessable. If we see abuse patterns in audit logs, add a per-session attempt counter in Redis.
- Single-org deployments only. Multi-org dashboard (if it ever happens) will need an org picker on the CLI-login page.
- The CLI gives the operator 3 paste attempts before giving up. If they typo 3x, the Redis session entry persists for the remaining TTL but no longer matters — operator re-runs `supabase login`.
