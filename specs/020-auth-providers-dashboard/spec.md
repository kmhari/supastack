# Feature Specification: Auth Providers Dashboard + Behavioral Parity (closes #21 + #34)

**Feature Branch**: `020-auth-providers-dashboard`

**Created**: 2026-05-28

**Status**: Draft

**Supersedes**: feature 019 (auth-config behavioral parity standalone) — that work folds into User Story 3 of this combined spec because issue #34 (the dashboard) hard-depends on issue #21's OAuth provider promotions, and the two are simpler shipped together.

**Input**: Combine two coupled issues:

1. **#21** — close the silent-no-op gap between full **shape** parity and full **behavioral** parity of the auth-config Management API. Today 24 of 234 fields wired to the per-instance auth container actually take effect; the other 210 are persisted but inert. Scope after splitting six follow-up issues (#61 SAML, #62 captcha, #63 custom OAuth server, #64 hooks, #65 MFA, #66 SMS providers): **141 fields** to promote, all template-cheap with no new endpoints or services. Plus a transparency layer that surfaces per-field `honored` / `stored-only` / `unsupported` status in the Management API GET response. Plus a behavioral parity test harness that proves every honored field actually changes runtime behavior.

2. **#34** — ship a supastack dashboard page at `Auth → Providers` mirroring Cloud's `/auth/providers`. List of provider rows; click opens a side drawer with the provider's specific form; pre-filled read-only callback URL with a Copy button; container-restart toast after Save. The page is the visible operator-UX deliverable that depends on #21's OAuth promotions.

The combination is **not** a UI for all 141 promoted fields. The dashboard page covers **only** what Cloud's auth providers page covers: 4 top-level toggles + Email/Phone toggle rows + 21 OAuth provider rows (20 unique providers with Slack rendered as two rows — legacy + OIDC) + disabled placeholder rows for SAML / Web3 / Custom Providers. The other ~100 promoted fields (mailer templates, rate limits, sessions, password rules, etc.) are backend-only in this feature; their dashboard surfaces are separate future pages (#71 Email Templates page, #68 Phone Settings page, etc.) under the same Authentication sidebar group.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator configures Google sign-in entirely from the dashboard (Priority: P1)

An operator opens `Auth → Providers` in their supastack project, clicks the Google row, sees the open side drawer with empty Client IDs / Client Secret fields and a pre-filled read-only Callback URL with a Copy button. They paste credentials they obtained from Google Cloud Console, toggle Enable, click Save. The drawer closes; a toast appears: "Restarting auth — your changes will be live in ~30s." Roughly thirty seconds later the toast flips to "Google enabled." The operator tests by visiting their app, clicks Sign in with Google, and is redirected to Google's consent screen.

**Why this priority**: This is the entire raison d'être for the combined feature. Today the operator either runs `supabase config update --external-google-enabled=…` (which works only for google/github/azure) or SSHes into the VM and edits the .env. Both ugly. This story validates the dashboard, the OAuth provider promotion, the restart UX, and the secret-handling all at once. Without it nothing else matters.

**Independent Test**: Fresh supastack project. From the dashboard, complete a Google OAuth provider configuration end-to-end (enable + paste creds + Save), wait for the toast to flip, then trigger a real OAuth handshake from a sample app and verify the user lands back signed-in. Pass = the full loop succeeds with zero CLI or SSH intervention.

**Acceptance Scenarios**:

1. **Given** an admin operator on `Auth → Providers`, **When** they click the Google row, **Then** a side drawer opens with the Google form (Enable toggle, Client IDs, Client Secret with Reveal, Skip nonce checks, Allow users without an email, Callback URL with Copy) and the Callback URL field is pre-filled and read-only.
2. **Given** the operator pastes a valid Client ID + Client Secret and toggles Enable, **When** they click Save, **Then** the drawer closes immediately and a non-blocking toast appears stating that the auth container is restarting.
3. **Given** the restart is in progress, **When** the per-instance auth container passes its healthcheck, **Then** the toast updates to a success state and the Google row's status pill flips from Disabled to Enabled.
4. **Given** Google is enabled, **When** an end user visits `/auth/v1/authorize?provider=google` on the per-instance auth surface, **Then** they are redirected to Google's OAuth consent screen with the configured client_id.
5. **Given** a non-admin operator, **When** they attempt to open the same drawer and Save, **Then** the page either hides the Save action or returns a permission-denied error consistent with the existing `config.write` RBAC action.

---

### User Story 2 — Operator configures the other 20 OAuth providers from the same dashboard (Priority: P1)

The Google story works identically for the other 20 OAuth provider rows (rendered as 21 rows because Slack shows both legacy + OIDC), each with the right field shape: Common-4 providers (bitbucket, discord, facebook, figma, github, kakao, notion, slack-legacy, spotify, twitch, twitter, x, zoom) show Enable + Client ID + Secret + Allow-users-without-email. Plus-URL providers (azure, gitlab, keycloak) add a URL field. WorkOS drops the email-optional toggle. Apple adds Additional Client IDs. Google adds Additional Client IDs + Skip nonce checks. LinkedIn renders OIDC-prefixed fields. Slack renders TWO rows (deprecated legacy + new OIDC). Every provider's Callback URL is pre-filled correctly.

**Why this priority**: P1 alongside US1 because the value isn't "one provider works" — it's "any of the 20 OAuth providers works without leaving the dashboard." Cloud parity demands all 21 rows. Without this, the dashboard ships as a Google-only feature.

**Independent Test**: For each of 21 OAuth rows (20 unique providers; Slack legacy + Slack OIDC count separately), complete the same flow as US1: open drawer → fill fields → Save → toast → status pill flips → handshake succeeds. Parameterized; one test loop, 21 iterations, 6 form templates exercised (Common-4, +URL, WorkOS-shape, Google, Apple, OIDC).

**Acceptance Scenarios**:

1. **Given** the operator clicks any of 21 OAuth provider rows, **When** the drawer opens, **Then** the form fields rendered match upstream's known shape for that provider family (Common-4, +URL, +URL-no-email-optional, Google-extras, Apple-extras, OIDC-only).
2. **Given** Slack appears in the provider list, **When** the operator sees the list, **Then** there are two distinct Slack rows: "Slack (OIDC)" and "Slack (Deprecated)", each with its own drawer mapping to the corresponding `external_slack_oidc_*` and `external_slack_*` field sets.
3. **Given** a provider's drawer has a Callback URL field, **When** the drawer opens, **Then** the URL shown is `https://<ref>.<apex>/auth/v1/callback` (the per-instance kong-fronted URL) and a Copy button copies it to the clipboard.
4. **Given** an operator configures and enables 5 different providers in one sitting, **When** each is saved, **Then** each save triggers a single container restart with the cumulative env state (no per-Save container restart storm).

Note on provider list: upstream `UpdateAuthConfigBody` exposes 20 OAuth provider key prefixes (apple, azure, bitbucket, discord, facebook, figma, github, gitlab, google, kakao, keycloak, linkedin, notion, slack, spotify, twitch, twitter, workos, x, zoom). Slack has two field families (`external_slack_*` and `external_slack_oidc_*`) and renders as two rows. LinkedIn is OIDC-only. Two providers Cloud's UI also lists (`fly`, `snapchat`) are NOT present in the pinned upstream snapshot and are intentionally excluded from this feature.

---

### User Story 3 — Behavioral parity for the cheap-promotion field set (Priority: P1)

Independent of the dashboard, the backend promotes the remaining auth-config fields to honored: 17 additional OAuth providers plus the Slack-OIDC variant and per-family extras (~77 fields = 14 × Common-4 family + Google extras + Apple extras + Slack OIDC extras + WorkOS shape + 2 Plus-URL providers); 37 mailer subjects / notifications / templates (subject to the GoTrue image flag-availability check from research R-001); 20 sessions / password / webauthn-rp / passkey / api / db / smtp-misc; 7 rate limits. After this story, the count of honored fields is **≥ 160** (target 165, ± 5 tolerance for GoTrue image flag-availability per research R-001) of 234 auth-config fields (up from 24). The remaining ~63 fields belong to the spun-out issues (#61–#66) or are explicitly unsupported (#63).

**Why this priority**: P1 because US1 and US2 hard-depend on the OAuth provider subset of this work. The non-OAuth promotions (mailer / rate limits / sessions / etc.) are CLI-only wins until their own dashboard pages ship, but they're free — same template-uncomment + mapping-table work. Shipping them together is cheaper than splitting.

**Independent Test**: With no dashboard interaction, drive the Management API: PATCH each of the 141 newly-honored fields with a known-changing value, restart, read back a runtime signal that proves the new value took effect (token TTL changes, OAuth provider becomes callable, rate-limit response code, mailer subject in a captured outgoing mail, etc.). All 141 assertions pass.

**Acceptance Scenarios**:

1. **Given** the auth-config status map after this story, **When** an enumeration runs, **Then** at least 160 fields are classified `honored` (target 165, ± 5 tolerance per research R-001), the rest are `stored_only` or `unsupported`, and zero fields are unclassified.
2. **Given** any honored field is PATCHed, **When** the behavioral parity test fires its assertion, **Then** the observed runtime behavior matches the new value within the container-restart window.
3. **Given** the upstream OpenAPI snapshot is refreshed and adds a new auth-config field, **When** the build runs, **Then** it fails with a clear error naming the unclassified field, preventing silent regression to the pre-feature state.

---

### User Story 4 — Per-field transparency in Management API responses (Priority: P2)

The Management API `GET /v1/projects/<ref>/config/auth` response gains a supastack-namespaced extension that classifies each of the 234 fields as `honored` / `stored_only` / `unsupported` with a short human-readable reason for non-honored entries. Unmodified upstream `supabase` CLI clients ignore the extension key and continue to work. CLI users (and operators using `curl` or scripts) can now tell from a single GET whether a value they set will take effect.

**Why this priority**: P2 because the dashboard already only renders honored fields, so dashboard operators don't experience the silent-no-op gap. CLI users and SREs do experience it — they routinely send fields that supastack ignores. This is the API-side transparency fix. Lower priority than US1–US3 because it benefits the smaller, more-technical audience.

**Independent Test**: PATCH a known-stored-only field via the Management API; GET; verify the response contains the extension key with that field classified `stored_only` and the reason text matches the status map. PATCH a known-honored field; GET; verify it's classified `honored`. PATCH a field in the `unsupported` set (e.g. `oauth_server_enabled`); GET; verify `unsupported` + reason.

**Acceptance Scenarios**:

1. **Given** the GET response, **When** an upstream `supabase` CLI parses it, **Then** the CLI continues to work without modification (the extension key is in an additive namespace it ignores).
2. **Given** any field in the upstream shape, **When** the operator inspects the GET response, **Then** the field's classification is present and the reason for non-honored entries is human-readable.
3. **Given** an operator PATCHes a stored-only field, **When** they GET back, **Then** the field's classification still reads `stored_only` (the API accepted and persisted, but the indicator did not lie).

---

### User Story 5 — Disabled "Coming soon" placeholder rows for non-shipping providers (Priority: P3)

Cloud's auth providers page shows SAML 2.0, Web3 Wallet, and Custom Providers rows. supastack does not honor these in this feature (split to #61, #72, #63 respectively). The dashboard renders them as disabled rows with a "Coming soon" badge linking to the tracking issue, so operators see the full provider taxonomy and know the work is tracked.

**Why this priority**: P3 because it's a transparency-vs-cleanliness call. Hiding the rows entirely is also defensible (recommended in earlier scoping); rendering them as disabled mirrors Cloud's layout and pre-empts operator confusion ("where's SAML?"). User chose disabled-with-badge. Pure UX work; no backend.

**Independent Test**: Load the providers page; verify SAML 2.0, Web3 Wallet, and the Custom Providers section render as disabled (no click handler opens a drawer), display a "Coming soon" badge, and the badge links out to the corresponding issue.

**Acceptance Scenarios**:

1. **Given** the providers list, **When** the operator scrolls past the 22 active OAuth providers and the Email + Phone rows, **Then** they see three disabled placeholder rows: SAML 2.0, Web3 Wallet, Custom Providers.
2. **Given** a placeholder row, **When** the operator clicks it, **Then** no drawer opens; the "Coming soon" badge links to the corresponding GitHub issue.

---

### Edge Cases

- An operator hits Save in the drawer while a previous container restart is still in flight. The Management API's existing per-project distributed lock from feature 009 queues the second PATCH; the dashboard's toast reflects the queued state ("Waiting for previous restart to finish").
- The container restart fails (image pull error, env validation error). The toast surfaces a clear failure with a Retry affordance; the row's status pill reverts to its previous value; the audit log records the failed restart.
- Operator opens a drawer for a provider whose secret is already configured. The Client Secret field shows a masked placeholder (no plaintext leaked even on Reveal — Reveal requires a separate explicit GET that returns the secret only for an admin role).
- Operator opens the Slack row. Both legacy (`external_slack_*`) and OIDC (`external_slack_oidc_*`) variants render as two distinct rows in the list (mirrors Cloud).
- Two operators in different browsers PATCH the same auth-config concurrently. The per-project distributed lock serializes them; the second operator's GET on save reload reflects the merged state.
- A new auth-config field is added by upstream between snapshots. The dashboard does not render it (form fields are hand-picked); the API's transparency layer classifies it; the contract test fails the build until the status map is updated.
- A field exists in the per-instance template's env mapping but the pinned GoTrue image version does not yet support it (theoretical example: a field promoted optimistically). The status map should reflect the runtime truth (`stored_only`) once the behavioral test catches the no-op.

## Requirements *(mandatory)*

### Functional Requirements — Backend (US3, US4)

- **FR-001**: The auth-config endpoint MUST classify every field in upstream's `UpdateAuthConfigBody` (234 fields at current snapshot) as `honored`, `stored_only`, or `unsupported`. Zero unclassified fields shall be present at merge time.
- **FR-002**: The per-field classification MUST be exposed in the `GET /v1/projects/<ref>/config/auth` response under a supastack-namespaced extension key.
- **FR-003**: Non-honored classifications MUST include a short human-readable `reason` field (e.g. "no SAML keypair infrastructure — see #61", "Cloud-only OAuth server — see #63").
- **FR-004**: After this feature ships, the count of honored fields MUST be at least 160 (target 165, ± 5 tolerance per research R-001): 20 OAuth providers fully honored (21 rendered rows including Slack's legacy + OIDC variants); ~37 mailer subjects/templates/notifications (subject to GoTrue image flag-availability); 20 sessions / password / webauthn-rp / passkey / api / db / smtp-misc (1 promoted in foundational task T010a — `security_manual_linking_enabled`; the remaining 19 in US3); 7 rate limits; plus the 24 already honored. Fields whose GoTrue version support is uncertain reclassify to `stored_only` with `reason: "requires GoTrue image bump — see #65"` rather than blocking the feature.
- **FR-005**: PATCH MUST continue to accept every field in the upstream shape (including `stored_only` and `unsupported`) to preserve unmodified `supabase` CLI compatibility (feature 009 Q4 clarification stands).
- **FR-006**: Every field classified `honored` MUST have at least one assertion in the behavioral parity test that mutates the field and verifies an observable runtime change. CI MUST fail when an honored field has no corresponding assertion.
- **FR-007**: The behavioral parity test MUST wait for the per-instance auth container's healthcheck to clear after a PATCH before asserting runtime behavior.
- **FR-008**: An upstream OpenAPI snapshot refresh that introduces a new auth-config field MUST cause a build-time failure if the field is unclassified, preventing silent regression.
- **FR-009**: All secret-typed fields in the honored set (every `external_*_secret`, `smtp_pass`, etc.) MUST be masked in the GET response. An admin-role-only reveal pathway MAY exist for the dashboard's Reveal button; if it does, it is explicit and audit-logged. Migration of secrets into `vault.secrets` is out of scope for this feature and tracked in #70.

### Functional Requirements — Dashboard (US1, US2, US5)

- **FR-010**: Supastack's project shell sidebar MUST expose a new top-level Authentication group with a Providers entry, opening the page at the conventional path under the project route (e.g. `…/auth/providers`).
- **FR-011**: The Providers page MUST render a top section with four toggles (Allow new users to sign up, Allow manual linking, Allow anonymous sign-ins, Confirm email) and a single Save button governing the bundle.
- **FR-012**: The Providers page MUST render two regions: (a) a top section with the 4 global toggles per FR-011, and (b) a separate providers list with 25 entries — Email row (toggle-only) + Phone row (toggle-only) + a disabled SAML 2.0 row + a disabled Web3 Wallet row + 21 active OAuth provider rows (20 unique providers; Slack appears as both legacy and OIDC rows). Plus (c) a separately-rendered, disabled Custom Providers section below the providers list.
- **FR-013**: Each disabled row MUST display a "Coming soon" badge linking to the corresponding GitHub issue (#61 SAML, #72 Web3 Wallet, #63 Custom Providers). Clicking the row itself MUST NOT open a drawer.
- **FR-014**: Clicking an active OAuth provider row MUST open a side drawer rendering the form fields specific to that provider's family (Common-4, +URL, +URL-no-email-optional, Google-extras, Apple-extras, OIDC-only). The drawer MUST also be openable via a `?provider=<DisplayName>` querystring (case-insensitive match against the provider's display name, e.g. `?provider=Google`, `?provider=Slack%20(OIDC)`).
- **FR-015**: Each OAuth drawer MUST include a Callback URL field that is pre-filled, read-only, and accompanied by a Copy button. The URL value MUST match the per-instance auth callback path (the kong-fronted URL the operator pastes into the IdP console).
- **FR-016**: Client Secret–type fields MUST be rendered as masked inputs with a Reveal affordance. The Reveal affordance is present in this feature as a placeholder UI; the actual admin-only plaintext-fetch pathway is split off to **#73** (auth provider secret-reveal) for separate implementation, including its own audit log event type. Operators who need to update a secret continue to do so by re-pasting; only the read-an-existing-secret capability is deferred.
- **FR-017**: Save in a drawer MUST issue a single PATCH containing only the fields modified in that drawer, close the drawer immediately, display a non-blocking toast indicating the auth container is restarting, and poll the per-instance container's healthcheck.
- **FR-018**: When the healthcheck clears, the toast MUST update to a success state and the row's status pill MUST reflect the new enabled/disabled state.
- **FR-019**: When the healthcheck fails or times out, the toast MUST display a clear failure with a Retry affordance and the row's status pill MUST revert to its previous value.
- **FR-020**: Save MUST be available only to operators with the existing `config.write` RBAC action. Non-admin operators see a read-only view (status pills visible, drawer fields disabled or hidden, no Save button).
- **FR-021**: The dashboard MUST render only fields that are classified `honored` in the status map. The transparency indicator from FR-002 is not surfaced in the dashboard UI (it serves CLI/SRE users).
- **FR-022**: Slack MUST be rendered as two distinct provider rows: "Slack (OIDC)" mapping to `external_slack_oidc_*` and "Slack (Deprecated)" mapping to `external_slack_*`.

### Key Entities

- **Auth-config field**: A single key in upstream's `UpdateAuthConfigBody`. Has a current value, a classification (`honored` / `stored_only` / `unsupported`), and an optional reason string.
- **Provider row definition**: The dashboard-side metadata describing a provider — its display name, icon, form template (Common-4 / +URL / Google-extras / Apple-extras / OIDC / WorkOS-shape), set of auth-config fields it maps to, status read from those fields, and (for disabled placeholders) the tracking issue URL.
- **Provider drawer state**: The transient form state inside an open drawer — pristine vs dirty, validation errors, secret-reveal state, in-flight Save status.
- **Container restart job**: The post-Save background activity that regenerates the per-instance `.env`, restarts the auth container, polls its healthcheck, and reports back to the dashboard toast and the audit log.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin operator can configure any one of the 20 unique OAuth providers (21 rendered rows, Slack having legacy + OIDC variants) end-to-end from the dashboard — open page, click provider, paste creds, Save, observe success toast — in under 2 minutes of active interaction time (excluding the ~30-second container restart wait).
- **SC-002**: 100% of the 234 fields in the upstream auth-config schema are classified in the status map at merge time, enforced by a contract test.
- **SC-003**: At least 160 fields are classified `honored` after this feature ships (target 165, ± 5 tolerance per research R-001; up from 24 today), enforced by a count-range assertion in CI.
- **SC-004**: 100% of fields classified `honored` have at least one passing behavioral assertion at merge time, enforced by a coverage check.
- **SC-005**: An unmodified `supabase` CLI executing read/write workflows against the auth-config endpoint continues to succeed without modification — no regressions introduced by the response-shape change.
- **SC-006**: An upstream OpenAPI snapshot refresh that adds a new auth-config field surfaces as a build-time failure within the first CI run that uses the refreshed snapshot.
- **SC-007**: After Save in a provider drawer, the new configuration is reflected in the per-instance auth container's behavior within 60 seconds (covers the ~30 second restart plus warm-up margin), 100% of the time on a healthy VM.
- **SC-008**: A non-admin operator visiting the page cannot trigger any state change — verified by an automated RBAC test that asserts both the absence of the Save action in the rendered UI and the rejection (403) of any direct PATCH from a non-admin token.
- **SC-009** *(post-ship metric; not blocking feature merge)*: Operators who previously configured providers via CLI or SSH no longer have any reason to do so for the 20 supported OAuth providers — verified by a one-question post-ship operator survey reporting that ≥ 80% of provider configurations were performed via the dashboard. Survey mechanism is part of operator communications (out of code scope); tracked here so the success target is recorded but no build task implements it.

## Assumptions

- The upstream `UpdateAuthConfigBody` shape remains canonical; the OpenAPI snapshot pinned under `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json` (or its successor) is the contract source.
- The unmodified upstream `supabase` CLI ignores unknown top-level keys in the GET response, allowing the per-field status indicator to be added without bumping any compat shim.
- The existing per-instance provisioning flow (feature 009) already regenerates the .env and restarts the per-instance auth container on auth-config PATCH; this feature reuses that lifecycle.
- The per-instance auth container's healthcheck endpoint reliably reports readiness within ~30 seconds on the production VM under normal load; the dashboard's toast UX is acceptable on that timing.
- All 20 unique OAuth providers' env-var mappings are determinable from upstream documentation; no provider requires supastack-hosted state beyond the per-instance .env.
- Operators bring their own credentials (Client ID + Secret) for every provider from the IdP's developer console; supastack does not register apps on operators' behalf.
- Existing RBAC infrastructure (the `config.write` action) is sufficient; no new RBAC actions need to be added.
- The dashboard SPA's existing toast and side-drawer primitives can be reused; no new dashboard component frameworks introduced.

## Dependencies

- **Feature 009** (`specs/009-runtime-config-tunables/`) — already-shipped backend (Management API endpoint, distributed lock, container restart, audit log, RBAC). This feature builds directly on top.
- **Issue #21** — closed by this feature's User Story 3 + 4 (this spec is the implementation of #21's revised scope).
- **Issue #34** — closed by this feature's User Story 1 + 2 + 5.
- **Spun-out backend issues** — explicitly out of scope here, blocked or independent:
  - #61 SAML — independent; SAML row remains placeholder until #61 ships.
  - #62 captcha — independent.
  - #63 custom OAuth server — independent; Custom Providers section remains placeholder.
  - #64 hooks — independent.
  - #65 MFA flags — independent (also gates webauthn-rp behavior beyond the rp identity fields promoted here).
  - #66 SMS providers — independent; Phone row remains toggle-only until #66 ships.
- **Spun-out dashboard issues** — follow-ups under the same Authentication sidebar group:
  - #68 Phone settings page — depends on #66.
  - #71 Email templates page — depends on the mailer-template promotions delivered here.
  - #72 Web3 Wallet — independent; Web3 row remains placeholder.
  - #70 secret migration into vault — independent.

## Out of Scope

- Any provider not in the 22-OAuth-provider list (SAML #61, Web3 #72, Custom Providers / OAuth server #63 — all rendered as disabled placeholders only).
- Full dashboard surfaces for the non-OAuth fields promoted in US3 (mailer templates, rate limits, sessions, password rules, etc.). Those promotions land as backend wiring only; dashboard surfaces tracked separately (#71, follow-ups).
- SMS provider configuration UI (covered by #66 backend + #68 dashboard).
- Migration of secrets into `vault.secrets` (#70).
- Bumping the pinned GoTrue image — kept at current version (any MFA flags or fields needing a newer GoTrue remain in #65).
- Custom dashboard themes, white-labeling, or per-provider icon assets beyond the existing icon set (operators get default provider icons).
- Auth user management, RLS policies, JWT key rotation UX, URL configuration page — those are siblings of the Providers page under the new Authentication group, each tracked as future work.
- Bulk-import provider configurations (e.g. CSV upload of 22 sets of creds). One provider at a time.
- Programmatic webhook on provider config changes — exists already in the audit log; no new event stream.
