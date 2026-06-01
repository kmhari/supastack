# Feature Specification: CLI device-code login

**Feature Branch**: `011-cli-device-login`

**Created**: 2026-05-25

**Status**: Draft

**Input**: When an operator runs `supabase login` against a supastack deployment (without `--token`), the upstream CLI tries to open a browser at `<dashboard_url>/cli/login?session_id=…&token_name=…&public_key=…`, then prompts for a verification code that the dashboard is supposed to display, then polls `<api_url>/platform/cli/login/<session_id>?device_code=…` for an encrypted token. supastack doesn't implement that flow today — only PAT-based `--token` login works. This feature adds the dashboard page + polling endpoint so plain `supabase login` becomes a one-shot, copy-paste flow that mints a real PAT under the hood and saves it to the operator's CLI.

## Clarifications

### Session 2026-05-25

- Q: Should the dashboard require an explicit "Allow" click before minting, or auto-mint on page load? → A: **Auto-mint on load.** Authentication itself is the consent (verified against Cloud's actual UX via screenshot). The page shows "Signed in as <email>" for confidence, no extra button.
- Q: How should the dashboard handle the `token_name` from the URL? → A: **Use as-is, not editable.** Label written to `api_tokens.label` verbatim from the URL parameter; operator identifies tokens by hostname + timestamp in the existing tokens page.
- Q: What happens if the operator hits the page without being logged in? → A: **Redirect to /login?next=<original-url>** (existing supastack pattern). After login, return to the CLI-login page with all original query params intact and continue the mint.
- Q: Session reuse — what if the same `session_id` is hit twice? → A: **Single-use at mint time.** Once a `session_id` has been used to mint a token, any second visit to the dashboard with that `session_id` shows an "Unable to create CLI sign-in" error page (matches Cloud's screenshot). The CLI must retry with a fresh `supabase login` to get a new `session_id`.
- Q: How long should the pending session live in Redis? → A: **5 minutes.** Matches Cloud's defaults. Plenty for copy-paste; bounded enough that abandoned sessions garbage-collect quickly.
- Q: Should CLI-minted PATs be visible in the dashboard's tokens page? → A: **Yes, in the same list, with a small "cli" badge** next to the label. Same `api_tokens` row; revoke works identically. Operators can find and kill CLI sessions from the existing settings UI without needing a separate page.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Plain `supabase login` against supastack succeeds with zero manual token paste (Priority: P1) 🎯 MVP

An operator on their laptop runs `supabase login` (with no flags). The CLI:

1. Generates a keypair locally
2. Prints "Press Enter to open browser and login automatically" and a fallback URL
3. The operator presses Enter; the browser opens to `https://<apex>/dashboard/cli/login?session_id=<uuid>&token_name=<name>&public_key=<hex>`
4. The dashboard (operator already signed in) shows an "Authorize supastack CLI" page with an 8-character verification code in big monospace boxes + a "Copy code" button + "Signed in as <email>"
5. The operator clicks "Copy code"
6. Back in the terminal, the CLI prompts "Enter your verification code:"; the operator pastes; presses Enter
7. The CLI prints "You are now logged in. Happy coding!" and saves the token to `~/.supabase/access-token`
8. From then on, `supabase projects list`, `supabase functions deploy`, etc. all work without any `--token` flag

**Why this priority**: This IS the feature. Without it, the only way to authenticate the CLI against supastack is `supabase login --token sbp_…`, which means operators have to first navigate to `/settings/tokens`, click Create, copy the token, paste into the terminal. The auto-flow eliminates that, exactly mirroring the Cloud experience.

**Independent Test**: On a fresh laptop with no `~/.supabase/access-token`, configure the supastack profile (see existing docs), then run `supabase login`. Without ever pasting a `sbp_…` token, complete the flow end-to-end. Verify `~/.supabase/access-token` now exists; `supabase projects list` returns the deployment's projects; the new token shows up in `https://<apex>/settings/tokens` with a "cli" badge.

**Acceptance Scenarios**:

1. **Given** the operator is signed in to the dashboard in their browser, **When** the CLI opens the `/dashboard/cli/login?session_id=…&token_name=…&public_key=…` URL, **Then** within 2 seconds the dashboard renders the "Authorize supastack CLI" page with an 8-character verification code in monospaced boxes.
2. **Given** the dashboard has displayed the verification code, **When** the operator copies it and pastes it into the CLI's verification prompt, **Then** within 1 second the CLI prints "You are now logged in. Happy coding!" and exits 0.
3. **Given** the CLI has just logged in, **When** the operator runs `supabase projects list`, **Then** the deployment's projects are listed (no `--token` flag, no env var needed).
4. **Given** the operator has just logged in via the flow, **When** they open `/settings/tokens` in the dashboard, **Then** the newly created token is in the list with the URL's `token_name` as its label AND a small "cli" badge next to the label.
5. **Given** the operator typed the verification code wrong, **When** the CLI polls with the wrong code, **Then** the CLI prints an error and re-prompts up to 2 retries; on 3rd failure the CLI exits non-zero with a clear message.

---

### User Story 2 — Logged-out browser bounce-and-return (Priority: P2)

An operator runs `supabase login` from a fresh machine where their browser doesn't have an active dashboard session.

1. CLI opens the `/dashboard/cli/login?session_id=…&token_name=…&public_key=…` URL
2. The dashboard sees no session → redirects to `/login?next=/dashboard/cli/login?session_id=…&token_name=…&public_key=…`
3. The operator signs in
4. On successful login, the browser bounces back to the original URL (with all query params intact)
5. The dashboard now auto-mints the token + shows the verification code, exactly as in US1
6. The operator finishes the flow as in US1

**Why this priority**: Common first-time-on-a-new-machine case. Without this redirect, the operator hits a 401 page and has to manually navigate back to the URL from CLI output. Lower than US1 because logged-in is the more common state once an operator's been around.

**Independent Test**: In an incognito window with no supastack session, paste the CLI-login URL. Confirm bounce to `/login?next=…`. Sign in. Confirm bounce back to the CLI-login URL with the same `session_id`/`token_name`/`public_key`. Confirm the code appears.

**Acceptance Scenarios**:

1. **Given** the operator's browser has no active supastack session, **When** they navigate to `/dashboard/cli/login?session_id=A&token_name=B&public_key=C`, **Then** the browser is redirected to `/login?next=<url-encoded-original-url>`.
2. **Given** the operator just signed in via the bounced login form, **When** the login completes, **Then** the browser lands back at `/dashboard/cli/login?session_id=A&token_name=B&public_key=C` (all original params preserved) and the dashboard auto-mints the token.
3. **Given** the operator cancels the login (closes tab) before signing in, **When** the CLI polls, **Then** the CLI's polling loop times out (no Redis entry was created) and surfaces "session not found" after its built-in retries.

---

### User Story 3 — Session ID replay is rejected with a clear error (Priority: P2)

The CLI's `session_id` is single-use. If the operator (or anything else) opens the same `/dashboard/cli/login?session_id=…` URL after a token has already been minted for that session, the dashboard must NOT mint a second token. Instead it shows the operator a clear "Unable to create CLI sign-in" error page so they know to re-run `supabase login` in the terminal to get a fresh session_id.

**Why this priority**: Security + correctness. Without single-use enforcement, refreshing the page would silently rotate to a new PAT, breaking the existing CLI session and leaving orphan tokens. Bounded at P2 because the failure mode is recoverable (operator re-runs `supabase login`).

**Independent Test**: Open the dashboard CLI-login URL, get a verification code, finish the CLI flow. Then refresh the dashboard tab (or open the same URL in a new tab). Confirm the error page renders with the message and a "Back to dashboard" link. Confirm `/settings/tokens` shows exactly one new token for that session, not two.

**Acceptance Scenarios**:

1. **Given** a CLI-login flow has already minted a token for `session_id=X`, **When** the same URL with `session_id=X` is opened again, **Then** the dashboard renders "Unable to create CLI sign-in" with the body text "supastack could not create the CLI sign-in session. Error: Could not create CLI login session" and a "Back to dashboard" button.
2. **Given** a session_id is in use (token minted, not yet polled by CLI), **When** the CLI polls and gets the encrypted token bundle, **Then** Redis deletes the entry; any subsequent poll for the same session_id returns 404.
3. **Given** a session_id was never used (CLI exited before polling), **When** 5 minutes pass with no activity, **Then** Redis garbage-collects the entry and subsequent polls return 404 with no manual cleanup needed.

---

### User Story 4 — CLI-minted tokens are revocable from the dashboard (Priority: P3)

An operator who's stopped using a particular laptop wants to invalidate the CLI session that ran from it. They open `/settings/tokens`, find the row with the `cli` badge and the matching hostname in the label, click Revoke. The token is invalidated immediately; subsequent CLI calls from that laptop get a 401.

**Why this priority**: Hygiene. The token will work indefinitely once minted, so a revoke path is required. The existing token-revoke flow already covers this — we're confirming the cli-badged tokens follow the same path.

**Independent Test**: After a successful CLI login, find the token in `/settings/tokens` (cli-badged row), click Revoke, confirm. From the same laptop's CLI, run `supabase projects list` — expect a 401 "unauthenticated" response. Re-run `supabase login` to re-auth.

**Acceptance Scenarios**:

1. **Given** a CLI-minted token exists for the current user, **When** the operator views `/settings/tokens`, **Then** the row shows the URL's `token_name` as the label AND a small `cli` badge to the right.
2. **Given** the operator clicks Revoke on a cli-badged token, **When** they confirm, **Then** the row's `revokedAt` is set and the row is hidden from the active list (same behavior as manually-minted tokens).
3. **Given** a CLI token has been revoked, **When** the CLI uses it for any management API call, **Then** the api returns 401 unauthenticated.

---

### Edge Cases

- **CLI session_id is malformed (not a UUID)**: dashboard rejects with a clear error before any Redis write or DB write happens.
- **Public_key is malformed (wrong length, non-hex, not a valid P-256 point)**: dashboard rejects with a clear error and does NOT mint a token.
- **Operator confirms in dashboard but never runs the CLI poll**: Redis entry expires after 5 minutes; no orphan PAT row in `api_tokens` (the token IS created at mint time, but it's tied to the operator's account and visible in their tokens list — they can manually revoke it if they want).
- **Browser auto-fills `?next=` with an external URL on the post-login bounce**: the login handler MUST validate the `next` param is a same-origin relative path; reject external URLs to prevent open-redirect abuse.
- **Operator copies the code but waits >5 minutes before pasting into CLI**: CLI polling returns 404; operator re-runs `supabase login` to get a fresh `session_id`.
- **Two operators open the same CLI-login URL by mistake (operator A copies the URL into a message)**: first one to load it wins (mints the token under whoever is signed in there). Acceptable risk — the URL is single-use and the operator clearly initiated the flow on their own machine; resulting token is bound to whoever was signed in when it was minted.
- **Operator already signed in, but the browser has multiple supastack orgs eventually (post-v1)**: out of scope for v1; supastack is single-org per deployment.
- **Operator's PAT-write RBAC is denied (e.g., suspended account)**: dashboard mint fails → error page shown.
- **CLI's verification-code-attempts limit (max 2 retries per the CLI source)**: if the operator typos the code 3 times, the CLI gives up; the dashboard's `session_id` entry persists for the remaining TTL, but is functionally orphaned (the CLI process has exited). It garbage-collects in Redis on TTL expiry.

## Requirements *(mandatory)*

### Functional Requirements

#### Dashboard page (US1, US2, US3)

- **FR-001**: System MUST expose a new dashboard route at `/dashboard/cli/login` that accepts query parameters `session_id` (UUID), `token_name` (string, ≤200 chars), and `public_key` (130-character hex string starting with `04`, the uncompressed encoding of an ECDH P-256 public key).
- **FR-002**: On load, if there is no active dashboard session, the page MUST redirect to `/login?next=<url-encoded-original-url-including-query>`.
- **FR-003**: On load with an active session AND a fresh, never-used `session_id`, the page MUST automatically:
  - Validate `session_id` is a valid UUID, `token_name` is non-empty and ≤200 chars, `public_key` is exactly 130 hex chars beginning with `04` and decodes to a valid P-256 point
  - Mint a Personal Access Token using the existing PAT-mint mechanism, attributed to the current session's user, with the URL's `token_name` as the label and a per-source marker so this token is recognizable as CLI-originated
  - Generate an ephemeral ECDH P-256 server keypair
  - Derive a 32-byte shared secret via ECDH against the client's public key
  - Generate a random 12-byte nonce
  - AES-256-GCM-encrypt the PAT plaintext with the shared secret + nonce
  - Generate a random 8-character lowercase-hex verification code (the "device_code")
  - Store the encrypted bundle in a session store keyed by `session_id` with a 5-minute TTL, payload `{ device_code, access_token (hex), public_key (server pub key, hex), nonce (hex), created_at }`
  - Render the page in "code display" mode (see FR-004)
- **FR-004**: The "code display" mode MUST show:
  - Title: "Authorize supastack CLI" (or similar branded variant)
  - Subtitle: "Enter this verification code in Supabase CLI to finish signing in"
  - The 8-character verification code in 8 separate large monospace boxes (one char per box)
  - A full-width "Copy code" button that copies the code to clipboard on click and visually confirms ("Copied!")
  - A "Signed in as <email>" card with the operator's avatar/initials
  - Footer text: "After authorizing, you can close this tab or manage tokens like this one in <a href='/settings/tokens'>Access Tokens</a>."
- **FR-005**: On load with a `session_id` that has already been used (i.e., a session bundle exists in the store OR existed and was deleted by a CLI poll), the page MUST render the error state:
  - Title: "Unable to create CLI sign-in"
  - Subtitle: "Retry the sign-in command from supastack CLI"
  - Body: warning card with "supastack could not create the CLI sign-in session. Error: Could not create CLI login session"
  - "Back to dashboard" button
  - NO new token minted

#### CLI-facing polling endpoint (US1)

- **FR-006**: System MUST expose `GET /platform/cli/login/:session_id?device_code=<8hex>` on the api host (the same Fastify process that serves `/v1/*` and `/api/v1/*`). This endpoint requires NO authentication header — security comes from `session_id` being unguessable (UUID v4, 122 bits) and `device_code` being a per-session 32-bit secret.
- **FR-007**: On a request, the endpoint MUST:
  - Look up the session store for key `session_id`
  - If absent → 404 with `{ message: "session not found" }`
  - If the stored `device_code` doesn't match the query parameter → 404 with the same shape (deliberately ambiguous to avoid leaking session existence)
  - Otherwise → return 200 with the response body shape that matches the upstream CLI's `AccessTokenResponse`: `{ id: <session_id>, created_at: <ISO8601>, access_token: <hex>, public_key: <hex>, nonce: <hex> }`
  - Delete the session store entry immediately after a successful response (single-use)
- **FR-008**: The polling endpoint MUST NOT be CORS-restricted (CLI is not a browser; no preflight). Standard error handler shape applies.

#### Token storage + visibility (US1, US4)

- **FR-009**: CLI-minted PATs MUST go into the existing PAT storage table with no schema change beyond what's needed for the source marker — the URL's `token_name` becomes the label, the existing token hash + lookup mechanism is reused, the token is bound to the user_id from the dashboard session that initiated the mint.
- **FR-010**: Each PAT row MUST have a marker indicating CLI origin (e.g., a `source` column, OR a label prefix convention that the UI recognizes). The dashboard's tokens page MUST render a small "cli" badge next to the label for any CLI-minted token.
- **FR-011**: The existing token revoke flow MUST work for CLI-minted tokens with no special-case handling.

#### Crypto + security (US1, US3, cross-cutting)

- **FR-012**: All crypto operations (ECDH key generation, ECDH shared-secret derivation, AES-256-GCM encryption) MUST use platform-stdlib primitives — no new third-party crypto dependencies.
- **FR-013**: The PAT plaintext MUST exist ONLY in: (a) the operator's CLI process after decryption, (b) the api process during the mint+encrypt step. It MUST NOT be logged, stored persistently in plaintext, or transmitted unencrypted.
- **FR-014**: The encrypted bundle in the session store MUST expire automatically after 5 minutes if not consumed (existing session-store TTL semantics).
- **FR-015**: The `next=` parameter on the post-login bounce MUST be validated as a same-origin relative path beginning with `/dashboard/cli/login` (or more broadly a same-origin path) — reject external URLs to prevent open-redirect abuse.
- **FR-016**: Both admin and member roles MUST be able to use the CLI-login flow (matches existing token-create permission). No new RBAC action is needed; reuse the existing PAT-create permission check.

#### Routing (cross-cutting)

- **FR-017**: The new `/dashboard/cli/login` route MUST be reachable on the apex host (`<apex>/dashboard/cli/login`) — it falls under the existing dashboard catch-all in the reverse-proxy config.
- **FR-018**: The new `/platform/cli/login/:session_id` endpoint MUST be reachable on the api host (`api.<apex>/platform/cli/login/<session_id>`) — it falls under the existing `api.<apex>` reverse-proxy to the api Fastify process.

### Key Entities

- **CLI login session** (transient, session-store only): keyed by `session_id` (UUID v4). Payload: `device_code` (8 hex chars), `access_token` (hex-encoded ciphertext), `public_key` (hex-encoded server ECDH public key), `nonce` (hex-encoded 12 bytes), `created_at` (ISO8601). TTL: 5 minutes. Deleted on successful CLI poll OR on TTL expiry.
- **PAT row** (existing, no schema change beyond a possible `source` column): minted at dashboard load time, bound to the operator's user_id, labeled with the URL's `token_name`. Marker (column or convention) tags it as CLI-originated for dashboard rendering.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator who has never authenticated the CLI against supastack can complete `supabase login` (no flags) end-to-end in under 30 seconds on a laptop with their browser already signed in. (US1)
- **SC-002**: For 100% of completed CLI-login flows, the resulting access token in `~/.supabase/access-token` is a valid PAT that authenticates `supabase projects list` against the deployment without any additional configuration. (US1)
- **SC-003**: For 100% of completed flows, the freshly minted PAT appears in the dashboard's tokens page within 2 seconds of completion, visually distinguished from manually-created tokens. (US1, US4)
- **SC-004**: An operator whose browser is logged out can complete the flow (login bounce + return + finish) in under 60 seconds. (US2)
- **SC-005**: Replaying a used `session_id` URL in the dashboard NEVER mints a second token — 100% of replay attempts hit the error page and produce zero new rows in the PAT table. (US3)
- **SC-006**: An abandoned CLI session (operator confirms in dashboard, never runs CLI poll) leaves no orphan state after 5 minutes of TTL — the session store entry is gone; the PAT row remains (visible + revocable by the operator from the dashboard like any other token). (FR-014, US4)
- **SC-007**: Wrong verification code attempts return 404 with NO information that distinguishes "no such session" from "wrong code for existing session" — verified by testing both cases produce byte-identical response bodies. (FR-007, security)
- **SC-008**: Zero plaintext PATs appear in api or web logs across the full mint → encrypt → store → poll → respond → CLI decrypt cycle, verified by inspecting log output for any string matching the `sbp_[0-9a-f]{40}` pattern. (FR-013)

## Assumptions

- The upstream supabase CLI's PKCE-style login protocol (as implemented in `supabase/cli` at `apps/cli-go/internal/login/login.go` HEAD of `develop`) is stable: ECDH P-256 keypair on the client, hex-encoded uncompressed public key (130 chars, `04` prefix), AES-256-GCM with 12-byte nonces, response shape `{ id, created_at, access_token, public_key, nonce }` with hex values, polling endpoint at `/platform/cli/login/:session_id?device_code=…`, single-use via deletion on successful poll.
- The dashboard's tokens page (`/settings/tokens`) already exists with a Create/Revoke flow and can absorb a small badge addition next to the label without restructuring.
- The api Fastify process is reachable on the api host (`api.<apex>`) via the existing reverse-proxy; no proxy config changes needed to expose `/platform/*`.
- The session store (used for the existing dashboard session cookies) has TTL semantics and can hold a few-hundred-byte JSON payload per session_id — same data shape, different key namespace.
- 8 lowercase-hex characters (32 bits) for the verification code is enough entropy when combined with a UUID v4 session_id (122 bits) and a 5-minute TTL: brute-force on the polling endpoint would need on average ~2 billion attempts per session within 5 minutes against a single session_id the attacker has to also guess.
- Operators are willing to copy + paste an 8-character code into the terminal; the alternative (CLI auto-poll without verification code) requires upstream CLI changes we don't control.
- Out of scope: the auto-poll-without-code UX, multi-org dashboard support, OAuth-app integration, refresh tokens (PATs do not expire on their own; revoke is manual), cross-deployment SSO, login-via-magic-link.
- Out of scope: changes to the upstream supabase CLI itself — this feature targets only the server side of an interaction the CLI already initiates.
