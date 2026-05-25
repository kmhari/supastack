# Tasks: CLI device-code login

**Input**: Design documents from `/specs/011-cli-device-login/`
**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/, quickstart.md

**Tests**: Included (security-sensitive crypto; SC-007 + SC-008 require automated test coverage).

## Format

`[ID] [P?] [Story?] Description with file path`

- **[P]** — can run in parallel (different file, no in-flight dependency)
- **[Story]** — US1 / US2 / US3 / US4 per spec
- All paths are repo-relative

---

## Phase 1: Setup

**Purpose**: Schema migration + shared wire-shape Zod schema. No code yet — just the foundations both api routes will depend on.

- [X] T001 Create migration `packages/db/migrations/0012_api_tokens_source.sql`: idempotent `ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual'` + guarded CHECK constraint `source IN ('manual', 'cli')` via `DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_source_check') THEN … END IF; END $$`.
- [X] T002 Update Drizzle schema in `packages/db/src/schema/identity.ts` `apiTokens` table: add `source: text('source').notNull().default('manual')`. Verify TypeScript type inference on `select` returns the new field.
- [X] T003 [P] Add `CliLoginResponseSchema` to `packages/shared/src/mgmt-api-schemas.ts` — Zod schema enforcing the upstream-CLI wire shape per `contracts/cli-wire-protocol.md`: `id` UUID, `created_at` ISO8601, `access_token` lowercase-hex, `public_key` 130-char hex starting `04`, `nonce` 24-char hex. Export type. This is the runtime guard that catches regressions if anyone touches the response shape.

---

## Phase 2: Foundational

**Purpose**: Pure helpers — crypto + Redis store. Both routes depend on these. Unit-testable in isolation; should ship first so US1/US2/US3 work can proceed in parallel.

- [X] T004 [P] Create `apps/api/src/services/cli-login-crypto.ts`. Exports:
  - `generateServerKeypair(): { privateKey: Buffer, publicKey: Buffer }` — wraps Node's `crypto.createECDH('prime256v1')`
  - `encryptForClient(plaintext: string, clientPubKeyHex: string): { accessTokenHex, publicKeyHex, nonceHex }` — does ECDH derive + AES-256-GCM encrypt + auth-tag concat per the gotcha in `contracts/cli-wire-protocol.md`
  - `generateDeviceCode(): string` — 8 lowercase hex chars from `randomBytes(4)`
  - `validateClientPublicKey(hex: string): { valid: true } | { valid: false; reason: string }` — checks length, prefix, and that Node accepts it as a P-256 point (try/catch on `setPublicKey`)
- [X] T005 [P] Unit test `apps/api/tests/unit/cli-login-crypto.test.ts` (7+ cases):
  - `generateServerKeypair` returns 32-byte private + 65-byte public (uncompressed, starts with `0x04`)
  - `encryptForClient` round-trip: encrypt with our impl, decrypt with the SAME impl playing both sides — plaintext recovered
  - **Known-vector test (Go interop)**: hardcoded clientPriv/clientPub/serverPriv/serverPub/nonce/plaintext/expectedCiphertextHex from a Go test run. Our impl with same keys+nonce MUST produce byte-identical hex (catches the auth-tag-concat footgun).
    
    **Generating the vectors** — run this Go snippet once and copy values into the test file:
    
    ```go
    package main
    import ("crypto/aes"; "crypto/cipher"; "crypto/ecdh"; "crypto/rand"; "encoding/hex"; "fmt")
    func main() {
        c := ecdh.P256()
        srvPriv, _ := c.GenerateKey(rand.Reader)
        cliPriv, _ := c.GenerateKey(rand.Reader)
        secret, _ := srvPriv.ECDH(cliPriv.PublicKey())
        nonce := make([]byte, 12); rand.Read(nonce)
        plaintext := []byte("sbp_0123456789abcdef0123456789abcdef01234567")
        block, _ := aes.NewCipher(secret)
        gcm, _ := cipher.NewGCM(block)
        ct := gcm.Seal(nil, nonce, plaintext, nil)
        fmt.Printf("serverPrivHex   = %x\n", srvPriv.Bytes())
        fmt.Printf("serverPubHex    = %x\n", srvPriv.PublicKey().Bytes())
        fmt.Printf("clientPrivHex   = %x\n", cliPriv.Bytes())
        fmt.Printf("clientPubHex    = %x\n", cliPriv.PublicKey().Bytes())
        fmt.Printf("sharedSecretHex = %x\n", secret)
        fmt.Printf("nonceHex        = %x\n", nonce)
        fmt.Printf("plaintext       = %s\n", plaintext)
        fmt.Printf("ciphertextHex   = %x\n", ct)  // ct = encrypted+tag (Go's Seal concats)
    }
    ```
    
    Run: `go run gen-vectors.go` (single file, no module needed). Paste the output into the test as the `VECTOR` constant.
  - `generateDeviceCode` returns 8 lowercase hex chars; 100 calls produce no duplicates (statistical sanity)
  - `validateClientPublicKey` accepts known-good 130-char hex starting `04`; rejects: wrong length, non-hex, wrong prefix (`02`/`03` compressed), `04` prefix + invalid curve point
- [X] T006 [P] Create `apps/api/src/services/cli-login-store.ts` Redis wrapper. Uses the same Redis connection already created for `connect-redis` in `apps/api/src/plugins/auth.ts` (export the instance from there, or accept it via DI). Exports:
  - `putSession(sessionId, payload): Promise<void>` — `SET selfbase:cli-login:<sessionId> <json> EX 300`
  - `sessionExists(sessionId): Promise<boolean>` — `EXISTS` (used by dashboard mint endpoint for replay check BEFORE attempting to mint)
  - `getAndConsume(sessionId, deviceCode): Promise<Payload | null>` — `GET`, JSON-parse, compare deviceCode, on match `DEL` + return payload, on mismatch return null without DEL
- [X] T007 [P] Unit test `apps/api/tests/unit/cli-login-store.test.ts` using `ioredis-mock` or a Redis stub:
  - `putSession` writes the key with TTL ≤300 (use `TTL` command to verify)
  - `getAndConsume` with matching deviceCode → returns payload + key deleted
  - `getAndConsume` with mismatching deviceCode → returns null, key NOT deleted
  - `getAndConsume` on missing key → returns null
  - `sessionExists` returns true after putSession, false after getAndConsume

**Checkpoint**: Foundations done. US1/US2/US3 implementation can proceed in parallel.

---

## Phase 3: User Story 1 — Plain `supabase login` round-trip (Priority: P1) 🎯 MVP

**Goal**: The whole feature, end-to-end. Operator runs `supabase login`, browser auto-mints + shows code, operator pastes, CLI saves token.

**Independent test**: see quickstart.md US1 section.

### Tests for US1

- [X] T008 [P] [US1] Contract test `apps/api/tests/contract/cli-login-mint.contract.test.ts` (in-process Fastify via `app.inject` if test infra supports it; else live-API skipIf-gated). Cover per `contracts/dashboard-mint-endpoint.md`:
  - Happy path: 200 + `{ device_code }` shape + `api_tokens` row inserted with `source='cli'` + Redis key SET with TTL ≤300
  - Replay: second POST with same `session_id` → 409 `session_in_use`
  - Malformed `session_id`: 422 `invalid_params`, `details.field = 'session_id'`
  - Malformed `public_key`: 422, `details.field = 'public_key'`
  - No session cookie: 401
  - Member-role user (not admin): 200 (FR-016)
- [X] T009 [P] [US1] Contract test `apps/api/tests/contract/cli-login-poll.contract.test.ts` per `contracts/polling-endpoint.md`:
  - Pre-populated Redis → matching device_code → 200, response shape exactly matches `CliLoginResponseSchema` (Zod validation in test), Redis key deleted after response
  - **SC-007 indistinguishable-404 test**: 5 cases (unknown session_id, malformed session_id, malformed device_code, wrong device_code, expired session) MUST produce byte-identical response bodies
  - Single-use: GET twice → first 200, second 404
  - TTL expiry: stub Redis with short TTL, sleep, GET → 404
  - No auth headers: explicitly omit Authorization header + cookies; still 200 on valid input

### Implementation for US1

- [X] T010 [US1] Create route `apps/api/src/routes/cli-login.ts` — `POST /api/v1/cli/login` per `contracts/dashboard-mint-endpoint.md`. Flow:
  1. `app.requireAuth(req)` (session cookie)
  2. Validate body with Zod (`session_id` UUID, `token_name` 1..200, `public_key` 130-char hex `04...`)
  3. `validateClientPublicKey` from crypto service (catches invalid P-256 points)
  4. `cliLoginStore.sessionExists(session_id)` → if true, return 409 `session_in_use`
  5. Mint PAT via existing `mintApiToken(userId, label=token_name, source='cli')` (modify `mintApiToken` in `api-tokens.ts` to accept the new `source` param; default `'manual'`)
  6. `generateServerKeypair` + `encryptForClient(patPlaintext, public_key)` + `generateDeviceCode()`
  7. `cliLoginStore.putSession(session_id, { device_code, access_token, public_key (server), nonce, created_at, user_id })`
  8. Return `{ device_code }`
- [X] T011 [US1] Modify `apps/api/src/services/api-tokens.ts` `mintApiToken` signature to accept optional `source: 'manual' | 'cli'` param (default `'manual'`). Pass through to the INSERT. Keep existing callers untouched (default kicks in).
- [X] T012 [US1] Create route `apps/api/src/routes/platform-cli-login.ts` — `GET /platform/cli/login/:session_id` per `contracts/polling-endpoint.md`. Flow:
  1. NO auth check; this endpoint is anonymous
  2. Parse `:session_id` and `?device_code` — on ANY validation failure, return 404 `{ message: 'session not found' }` (same body as legitimate misses)
  3. `cliLoginStore.getAndConsume(session_id, device_code)` → if null, 404; if payload, return `{ id: session_id, created_at, access_token, public_key, nonce }`
  4. Set `Content-Type: application/json` explicitly
- [X] T013 [US1] Register both routes in `apps/api/src/server.ts`. `cliLoginRoutes` under `/api/v1` prefix; `platformCliLoginRoutes` mounted at root (no prefix) so its path is `/platform/cli/login/:session_id`.
- [X] T014 [P] [US1] Add `cliLoginApi.mint(body)` to `apps/web/src/lib/api.ts` returning `{ device_code }` on success.
- [X] T015 [US1] Create `apps/web/src/pages/CliLogin.tsx` per the 4-state state machine in `contracts/dashboard-page.md` (loading / code-display / error; logged-out redirect handled by T016b's RequireAuth wrapper). On mount: validate URL params via `URLSearchParams`; on validation pass, call `cliLoginApi.mint`; on success render code in 8 monospace cells + Copy code button + Signed-in-as card per the "State B" mockup; on 409/422/5xx render error state per the "State C" mockup with the Cloud-style message ("selfbase could not create the CLI sign-in session. Error: …"). After successful mint, `window.history.replaceState({}, '', \`/dashboard/cli/login?device_code=${code}\`)` to drop sensitive params from URL bar.
- [X] T016 [US1] Wire React Router route `/dashboard/cli/login` → `CliLogin` in `apps/web/src/App.tsx`, wrapped in `RequireAuth` so unauthenticated visits trigger the login-redirect flow (with `?next=` honored — see T016b/T016c).
- [X] T016b [US1] Modify `apps/web/src/components/RequireAuth.tsx` (or wherever the auth-gate component lives) to construct `?next=<URI-encoded current path + search>` when redirecting to `/login`. Without this, logged-out US1 users land at `/dashboard` after login and lose the CLI-login URL params. (Was T018, promoted into US1 per analyze C2 — MVP shouldn't ship a subtly-broken logged-out path.)
- [X] T016c [US1] Modify `apps/web/src/pages/Login.tsx` to read `?next=` on successful login and redirect to `safeNext(next)` (helper added in T019 of US2 — but inline the helper here at minimum for US1; US2's T020 promotes it to its own file + adds the unit test). `safeNext` rules per research.md Decision 6: must start with `/`, not start with `//`, not contain `://`; otherwise fall back to `/dashboard`.
- [ ] T017 [P] [US1] Live-VM E2E shell script `tests/cli-e2e/cli-login.sh` using `expect`(1) to drive a non-interactive `supabase login` flow: mint via api directly with curl, paste device_code into expect-controlled `supabase login` stdin, assert exit 0 + `~/.supabase/access-token` present + matches the minted PAT. Documents end-to-end timing (SC-001 < 30s). **MUST also include SC-008 log-leak check**: after the test, `ssh <vm> "sudo docker logs --since 2m selfbase-api-1 selfbase-web-1 2>&1 | grep -E 'sbp_[0-9a-f]{40}'"` must produce ZERO matches; fail the script if any plaintext PAT appears in container logs.

**Checkpoint**: US1 ships the full flow. US2 (logged-out) and US3 (replay) are refinements + UX edges built on this foundation.

---

## Phase 4: User Story 2 — Logged-out bounce-and-return (Priority: P2)

**Goal**: Operators on fresh machines (no session cookie) get bounced to `/login` and return seamlessly with all params intact.

**Independent test**: see quickstart.md US2 section (incognito flow).

- [X] T017 [US2] Done in T016b (RequireAuth `?next=` construction). Verify no regressions in other RequireAuth-wrapped routes (Instances, ProjectGeneral, etc.) — they should all still redirect to `/dashboard` post-login when no `?next=` is present.
- [X] T018 [US2] Extract the inline `safeNext` helper added in T016c into its own file `apps/web/src/lib/safe-next.ts`; update `Login.tsx` to import it. (T020's unit test depends on the helper being importable.)
- [X] T019 [P] [US2] Vitest unit test `apps/web/tests/unit/safe-next.test.ts` for the `safeNext` helper:
  - Valid: `/dashboard`, `/dashboard/cli/login?session_id=…`, `/foo/bar`
  - Rejected (falls back to `/dashboard`): `https://evil.com`, `//evil.com`, `javascript:alert(1)`, `mailto:x@y.com`, empty/null
- [X] T020 [P] [US2] Live-VM manual verification step added to `quickstart.md` US2 section already present; no automated test needed (incognito-flow needs a human-driven browser).

---

## Phase 5: User Story 3 — Session ID replay error (Priority: P2)

**Goal**: Hitting the same `session_id` URL twice in the dashboard shows the Cloud-style "Unable to create CLI sign-in" error page; no second token minted.

**Independent test**: see quickstart.md US3 section.

- [X] T021 [US3] T010 (the mint route) already returns 409 `session_in_use` on replay — confirm with a manual test that the error response shape matches what the dashboard page expects. No additional api work.
- [X] T022 [US3] T015 (the CliLogin page) already renders the error state on 409 — confirm the rendered text matches the screenshot ("selfbase could not create the CLI sign-in session. Error: Could not create CLI login session"). Adjust message string only if needed. No additional web work beyond polish.
- [X] T023 [P] [US3] Live-VM verification (manual) added to `quickstart.md` US3 — already present.

---

## Phase 6: User Story 4 — Revoke from dashboard (Priority: P3)

**Goal**: CLI-minted tokens show with a `cli` badge in `/dashboard/settings/tokens` and revoke normally.

**Independent test**: see quickstart.md US4 section.

- [X] T024 [US4] Modify `apps/web/src/pages/SettingsTokens.tsx`:
  - Add `source` to the `Token` type / fetch response if not present
  - Render a small `<Badge variant="outline">cli</Badge>` next to the label when `token.source === 'cli'`
  - No layout restructure; revoke flow already works for all rows
- [X] T025 [US4] Verify `apps/api/src/routes/auth.ts` token-list endpoint returns the `source` field (it should auto-pass through with the Drizzle schema update from T002; confirm via curl after deploy).

---

## Phase 7: Polish & cross-cutting

- [ ] T027 [P] Update `CLAUDE.md` "What's shipped" table with a row for feature 011 once merged.
- [ ] T028 [P] Create operator doc `docs/changes/011-cli-device-login.md`: what changed (operators can now run `supabase login` without `--token`), how it works at a high level, how to revoke a CLI session, troubleshooting (replay error, code-expired error, decryption failure → likely upstream CLI version skew).
- [ ] T029 [P] Update release notes / PR description with screenshots from US1 + US3 + the tokens-page badge.
- [ ] T030 [P] Audit logs: confirm a PAT-create audit entry IS emitted on CLI mint (existing `mintApiToken` should already emit it; verify with a curl + DB select after deploy). No code change unless the audit emit is currently in the route handler rather than the service.

---

## Dependencies

```
Setup (T001..T003)
  ├─→ Foundational (T004..T007)
  │     ├─→ US1 (T008..T017)  ← P1, MVP
  │     │     ├─→ US2 (T018..T021) ← P2, can ship as a follow-up patch
  │     │     ├─→ US3 (T022..T024) ← P2, mostly verification — implementation falls out of US1
  │     │     └─→ US4 (T025..T026) ← P3, isolated UI change
  │     └─ (no other deps)
  └─→ Polish (T027..T030)
```

Notes:
- US3 and US4 are tiny — most of US3's work is already done by US1's mint route returning 409 on replay; the dashboard page state machine in T015 handles the rendering. US4 is a single component edit.
- US2 is the only one with non-trivial standalone work (the `?next=` plumbing on the existing Login page).

## Parallel execution opportunities

Within each phase, `[P]` tasks touch different files and can run concurrently:

- **Setup**: T001 + T003 parallel; T002 sequential (depends on T001's column existing).
- **Foundational**: T004 + T005, T006 + T007 all parallel (4 simultaneously).
- **US1 tests**: T008 + T009 parallel (different test files); both can run before implementation.
- **US1 impl**: T010/T011/T012/T013 sequential (api route registration order); T014 + T015 + T016 parallel with the api work; T017 (E2E shell) parallel with everything.
- **US2**: T018 + T019 + T020 parallel.
- **Polish**: T027 + T028 + T029 + T030 all parallel.

## MVP scope

**US1 = MVP.** Shipping just US1 gives operators the working `supabase login` flow as long as they're already signed into the dashboard browser. US2/US3/US4 are polish:
- US2 = better first-time-on-new-machine UX
- US3 = nicer error than a generic 409
- US4 = visual distinction in tokens list

All four together = ~2–3 hours of focused work given the foundations are small. US1 alone = ~1 hour after Phase 2 lands.

## Task count summary

| Phase | Count |
|---|---|
| Setup | 3 |
| Foundational | 4 |
| US1 (mint + poll + page + e2e) | 10 |
| US2 (`?next=` plumbing) | 4 |
| US3 (replay error verification) | 3 |
| US4 (cli badge + tokens API) | 2 |
| Polish | 4 |
| **Total** | **30** |

All tasks include exact file paths. Most touch ≤2 files each.
