# Feature Specification: URL Configuration page

**Feature Branch**: `022-url-configuration`

**Created**: 2026-05-28

**Status**: Draft

**Input**: User description: "Add a URL Configuration page under Authentication in selfbase settings, mirroring Supabase Cloud's /auth/url-configuration page. Operators set Site URL (default redirect destination when no redirect_to is supplied or when the supplied one fails allow-list matching) and Redirect URLs (the allow-list of permitted post-auth redirect destinations, with wildcard glob support — `*` for single-segment, `**` for any segment). Selfbase's backend already honors both fields (`site_url` → `SITE_URL`; `uri_allow_list` → `GOTRUE_URI_ALLOW_LIST` via env-field-mapper); only the UI is missing. Page content must visually match the Cloud page closely enough that a screenshot diff is unsurprising."

## Clarifications

### Session 2026-05-28

- Q: When the operator clicks 'Add URL' in the Redirect URLs section, what UX shape should the input use? → A: Modal dialog with batch-add (replicating Cloud verbatim: dialog titled "Add new redirect URLs", first-class URL input row, internal "+ Add URL" button to insert additional rows, trash icon next to each row, full-width green "Save URLs" submit that PATCHes the merged list in one call).
- Q: What should happen when an operator saves an empty Site URL? → A: Refuse empty + require non-empty value (Save button stays disabled while input is empty/whitespace-only). Site URL is the OPERATOR'S frontend application URL (where their app is hosted, e.g. https://app.example.com), NOT anything selfbase can derive — selfbase MUST NOT seed it or default it. New + existing projects start with an empty `site_url`; the operator types their app URL before first save.
- Q: When checking whether a newly-added Redirect URL is a duplicate, how should we compare? → A: Case-insensitive scheme+host, exact path (lowercase the scheme + host before comparing; the path/query/wildcard segments stay byte-exact so /foo vs /foo/ are NOT folded).
- Q: How should existing projects (whose `site_url` is currently null/empty) behave when the URL Configuration page loads? → A: Don't seed, don't auto-fill, don't migrate. The page renders with an empty Site URL input; Save stays disabled until the operator types a non-empty value. Operators are expected to know their own app URL.

## Motivation

GoTrue gates every OAuth/passwordless/magic-link redirect through (a) the `SITE_URL` fallback and (b) the `URI_ALLOW_LIST` whitelist. When the dashboard saves an OAuth provider but the operator's app lives on a host that isn't in the allow list, GoTrue silently rewrites the post-flow redirect back to `SITE_URL`. Today selfbase operators experience this as "OAuth seems to work but I get bounced to a no-match error page on my project URL" — there's no UI surface to add their app's URL.

A real example surfaced this week: operator tested GitHub OAuth from `http://localhost:8765/`, GitHub authorization succeeded, but GoTrue's final redirect landed on `https://<ref>.supaviser.dev/?code=…` instead of localhost because localhost wasn't in the allow list. The only workaround today is editing the per-instance `.env` file via SSH or PATCHing the auth-config endpoint directly with curl — both unacceptable for a dashboard product.

Cloud's page is the canonical UX; matching it gives operators a familiar surface and lets us close this entire class of "OAuth redirect bounced" support questions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Set Site URL (Priority: P1)

An operator opens the Auth → URL Configuration page, sees the current Site URL pre-filled, edits it to their app's production URL (e.g. `https://app.example.com`), and saves. The dashboard confirms the save with a non-blocking restart toast (same pattern as the Auth Providers page), the auth container reloads with the new env, and subsequent OAuth flows that don't supply an explicit `redirect_to` land on the new URL.

**Why this priority**: Site URL is the operator's frontend app URL — the place users land after clicking password-reset emails, email-confirmation links, and OAuth flows that omit `redirect_to`. It's also the destination used for email-template links (`{{ .SiteURL }}`). Wrong value = users bounced to the wrong domain after auth events.

**Independent Test**: With selfbase running and a project created, navigate to `/dashboard/project/<ref>/auth/url-configuration`. Enter `https://example.com` in Site URL, click Save changes. Confirm:
1. Dashboard shows success toast.
2. `GET /api/v1/projects/<ref>/config/auth` returns `site_url: "https://example.com"`.
3. The project's `.env` file contains `SITE_URL=https://example.com`.
4. The auth container env has `GOTRUE_SITE_URL=https://example.com` after the reload.

**Acceptance Scenarios**:

1. **Given** a project with no Site URL set, **When** operator saves `https://app.example.com`, **Then** the value persists to DB + .env + auth container env after restart.
2. **Given** a Site URL already set, **When** the page loads, **Then** the input is pre-filled with the current value (not a placeholder).
3. **Given** the operator enters an obviously invalid value (e.g. `not a url`), **When** they click Save, **Then** the dashboard blocks the save with an inline validation message and does not call the PATCH endpoint.
4. **Given** the operator is a member (non-admin), **When** they open the page, **Then** the input is read-only and the Save button is disabled with a tooltip explaining admin-only.

---

### User Story 2 — Add and remove Redirect URLs (Priority: P1)

An operator opens the page, clicks "Add URL", a modal dialog ("Add new redirect URLs", subtitle "This will add a URL to a list of allowed URLs that can interact with your Authentication services for this project.") appears with one URL input row, an internal "+ Add URL" button to insert additional rows for batch-adding several URLs in one go, and a full-width green "Save URLs" submit. After save the new entries appear in the Redirect URLs list. Deleting an entry from the list (trash icon next to each row outside the dialog) persists immediately as a single PATCH.

**Why this priority**: This is the unblock for the OAuth-redirect-bounce class of problem. Without it, every operator hits the silent SITE_URL fallback when testing their own app.

**Independent Test**: On the same page, click Add URL, enter `http://localhost:3000/**`, confirm. Confirm:
1. The URL appears in the displayed Redirect URLs list.
2. `GET /api/v1/projects/<ref>/config/auth` returns `uri_allow_list` containing the new URL (comma-separated, the form GoTrue expects).
3. The auth container env has the new URL in `GOTRUE_URI_ALLOW_LIST` after the reload.
4. Clicking the delete icon next to that URL removes it and rewrites .env + reloads.

**Acceptance Scenarios**:

1. **Given** an empty allow list, **When** the page loads, **Then** the operator sees the empty-state copy "No Redirect URLs / Auth providers may need a URL to redirect back to" matching Cloud.
2. **Given** the operator clicks Add URL and enters a value, **When** they confirm, **Then** the URL appears in the list and the auth container reloads in the background.
3. **Given** the operator enters a duplicate URL, **When** they confirm, **Then** the dashboard rejects with "URL already added" and the list is not mutated.
4. **Given** the operator enters a URL with an unsupported scheme (e.g. `javascript:`), **When** they confirm, **Then** the dashboard rejects with a clear validation error.
5. **Given** a list of 3+ URLs, **When** the operator deletes one, **Then** the remaining entries persist correctly (comma list properly re-joined, no orphan commas).
6. **Given** a wildcard URL like `http://localhost:*` is entered, **When** confirmed, **Then** it is accepted and stored verbatim (we do not normalize or canonicalize the pattern).

---

### User Story 3 — Visual parity with Supabase Cloud (Priority: P2)

A side-by-side screenshot of the selfbase `/auth/url-configuration` page and the Cloud `/auth/url-configuration` page should be unsurprising — same layout (Site URL section on top, Redirect URLs section below), same headings, same descriptions verbatim where they apply, same empty-state copy, same "Docs" link button next to the Redirect URLs description, same overall card + section structure as the Auth Providers page (feature 020) already uses.

**Why this priority**: Matching Cloud is what makes the page learnable for operators coming from supabase.com. It's not P1 because the functionality of P1+P2 above is what unblocks the real-world bug; parity is the polish.

**Independent Test**: Capture screenshots of both pages at 1440px viewport. Verify:
1. Section ordering: Site URL on top, Redirect URLs below.
2. Section headings match: "Site URL", "Redirect URLs".
3. Subtitle copy matches: "Configure site URL and redirect URLs for authentication" under the page title.
4. Site URL section: single labeled input with description "Configure the default redirect URL used when a redirect URL is not specified or doesn't match one from the Redirect URLs list" + "Save changes" button.
5. Redirect URLs section: description "URLs that auth providers are permitted to redirect to post authentication. Wildcards are allowed, for example…" + "Docs" link pointing at supabase.com/docs/guides/auth/redirect-urls + "Add URL" button.
6. Empty state heading "No Redirect URLs" + subtitle "Auth providers may need a URL to redirect back to".

---

### User Story 4 — Sidebar entry and deep-linking (Priority: P3)

The Auth → Configuration sidebar group in `ProjectShell` gains a new "URL Configuration" link below "Providers", in the same group, matching the order Cloud uses (Providers before URL Configuration is fine; what matters is both live under Authentication). Pasting `/dashboard/project/<ref>/auth/url-configuration` directly into the address bar loads the page.

**Why this priority**: Discoverability matters for product polish, but operators can also reach the page from the OAuth-provider drawers (which will eventually link out to it — see open-ended scope below).

**Independent Test**: Open the project shell sidebar. Confirm the new entry under Authentication. Click it. Confirm the URL changes and the page renders.

---

### Edge Cases

- **Empty Site URL**: rejected client-side (FR-012). Required-on-save; operators overwrite to a new value but cannot clear it once set. Projects are NOT seeded — first-load on a project that has never set Site URL renders an empty input and a disabled Save button. The operator types their app URL (whatever frontend will host the auth integration) and saves.
- **Very long allow list**: GoTrue accepts a comma-separated list in a single env var. The page must not silently truncate. Bound it at 50 entries (matches Cloud's published soft limit) and show a clear error if the operator tries to add more.
- **Whitespace in URL input**: trim leading/trailing whitespace before submit; reject internal whitespace.
- **URL without scheme**: e.g. `localhost:8765` (no `http://`). The dashboard should reject with a validation error pointing the operator at the scheme requirement.
- **Concurrent edits**: two admins editing simultaneously. Last write wins (existing PATCH semantics). Dashboard does not need optimistic-locking UI.
- **Member role accessing the page**: page renders read-only; inputs disabled; Add URL button hidden; delete icons hidden.
- **Auth container fails to reload after save**: the page shows the existing restart-toast Retry pattern from feature 020; operator can retry without re-entering values.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: System MUST add a new page at `/dashboard/project/<ref>/auth/url-configuration` rendered through `ProjectShell` (same layout shell as other Auth pages).
- **FR-002**: System MUST add a sidebar entry "URL Configuration" under the Authentication group, placed after "Providers".
- **FR-003**: Page MUST fetch the current auth-config via the existing `GET /api/v1/projects/<ref>/config/auth` endpoint and seed `site_url` + `uri_allow_list` into form state.
- **FR-004**: The Site URL section MUST present a single labeled input pre-filled with `site_url`, a description matching Cloud's copy, and a Save changes button that PATCHes `{ site_url: <value> }` to `/api/v1/projects/<ref>/config/auth`.
- **FR-005**: The Redirect URLs section MUST present an Add URL button, a list of current URLs (parsed from the comma-separated `uri_allow_list` string), a delete icon per URL, an empty state matching Cloud's copy ("No Redirect URLs" + subtitle), and a Docs link to supabase.com/docs/guides/auth/redirect-urls.
- **FR-006**: Adding URLs uses a modal dialog ("Add new redirect URLs") that supports batch-add (one or more URL rows added in one session) and persists the merged allow-list with a single PATCH `{ uri_allow_list: "<existing>,<row1>,<row2>,…" }` when the "Save URLs" button is clicked. Removing a URL from the displayed list MUST persist immediately via PATCH `{ uri_allow_list: "<remaining>" }`. Both operations MUST be atomic from the dashboard's perspective (single PATCH per save click / single PATCH per delete click).
- **FR-007**: System MUST validate URL inputs client-side: must parse as a valid URL with `http://` or `https://` scheme; wildcards (`*`, `**`, `?`) anywhere in the path are allowed (skip URL-validator's scheme check on the segment containing wildcards); reject other schemes (e.g. `javascript:`, `data:`, `file:`).
- **FR-008**: System MUST reject duplicate URLs in the Redirect URLs list with a clear inline error and no state mutation. Duplicate comparison lowercases the scheme + host before matching; the path / query / wildcard segments are compared byte-exact (so `/foo` and `/foo/` are NOT considered duplicates, but `http://Localhost` and `http://localhost` are). URLs are stored verbatim (no canonicalization on write); only the dedup check normalizes.
- **FR-009**: System MUST cap the Redirect URLs list at 50 entries; the Add URL button is disabled at the cap with a tooltip.
- **FR-010**: System MUST show the existing non-blocking restart toast pattern (poll per-instance health for ~30s, flip to success/Retry) after each save. Existing utility `use-restart-toast.ts` from feature 020 SHOULD be reused.
- **FR-011**: System MUST gate writes on the `admin` role. Member-role operators see the page as read-only: inputs disabled, Save button hidden, Add URL button hidden, delete icons hidden.
- **FR-012**: System MUST refuse to save an empty (or whitespace-only) Site URL — the Save button stays disabled until the input contains a non-empty, validly-shaped URL. **Site URL is the operator's frontend application URL** (e.g. `https://app.example.com`, `http://localhost:3000`) — the URL of the app that authenticates against this project — NOT the project's kong URL or anything selfbase can derive. Selfbase MUST NOT seed, migrate, or auto-default `site_url`. New and existing projects start with `site_url = null/empty`; the operator types the value once before first save. Once set, operators can overwrite to a new value but not clear it.
- **FR-013**: Browser test coverage (Playwright) MUST cover: page renders for admin and member; adding a URL persists across reload; deleting a URL persists across reload; member sees read-only state; deep-link to the URL loads the page. Add as a new spec file `apps/web/tests/e2e/url-configuration.spec.ts` and register in `EXPECTED_PAGES`.
- **FR-014**: `_selfbase.fieldStatus.site_url` and `_selfbase.fieldStatus.uri_allow_list` MUST already report `status: "honored"` (they already do — this is a regression-guard requirement, not new work).

### Out of Scope (this feature)

- Custom-domain CNAME setup (no `/settings/domain` page — that's a separate operator workflow).
- Auto-suggesting `http://localhost:<port>` from running dev servers.
- Linking from OAuth provider drawers to this page (nice-to-have polish for a follow-up).
- Programmatic CLI command (`supabase domains` is in upstream Tier-3 backlog).
- Validating that wildcard patterns are syntactically well-formed glob expressions (we trust operator input here — GoTrue rejects malformed patterns at parse time).

## Success Criteria

1. **Time to add allow-list entry**: from page load, operator can add a redirect URL in under 30 seconds (no SSH, no curl, no doc-reading required).
2. **Visual parity**: side-by-side screenshot diff of selfbase vs Cloud at 1440px viewport produces a reviewer's "yep, that's the same page" reaction. No exact-pixel match required.
3. **Zero regressions** in feature 020's auth-config PATCH flow: existing fields and the snapshot-drift contract test continue to pass.
4. **Functional verification**: a fresh project + `http://localhost:8765/**` added to allow list + the OAuth tester at `scripts/oauth-test/index.html` completes a GitHub round-trip landing back on localhost (not on the project URL).
5. **Member RBAC**: a member-role session loads the page without 403, sees current values, cannot mutate. Verified by Playwright spec.
6. **Browser test coverage**: the new spec file passes in CI's `e2e` job (feature 021's harness).

## Assumptions

- The existing `PATCH /api/v1/projects/<ref>/config/auth` endpoint accepts partial updates and re-writes only the requested fields (verified — this is how feature 020 works).
- The `uri_allow_list` field stores a comma-separated string (matches GoTrue's expected env-var format). Empty list = empty string.
- Wildcard syntax is opaque to selfbase — we store and forward whatever the operator types; GoTrue validates at consumption time. The Cloud docs page is the authority on syntax (`*`, `**`, `?` with `.` and `/` as separators).
- The existing restart-toast utility from feature 020 handles arbitrary auth-config PATCHes (not just provider toggles) and works here unchanged.
- No backend API changes are needed; this feature is dashboard-only. The env-field-mapper, runtime-config-store, and compose template already map both fields correctly.

## Dependencies

- Existing: `GET/PATCH /api/v1/projects/:ref/config/auth` (feature 009 + 020).
- Existing: `env-field-mapper.ts` already maps `site_url` → `SITE_URL` and `uri_allow_list` → `ADDITIONAL_REDIRECT_URLS` (compose then maps `ADDITIONAL_REDIRECT_URLS` → `GOTRUE_URI_ALLOW_LIST`).
- Existing: `use-restart-toast.ts` polling utility (feature 020).
- Existing: `Switch`, `InputWithSuffix`, `Card`, `Sheet` UI primitives.
- Existing: `EXPECTED_PAGES` registry + page-coverage lint (feature 021).
- New file: `apps/web/src/pages/ProjectAuthUrlConfig.tsx` (page component).
- New file: `apps/web/tests/e2e/url-configuration.spec.ts` (Playwright spec).
- Router: add route in `App.tsx`.
- Sidebar: add entry in `ProjectShell.tsx` under the Authentication group.

## Key Entities

- **AuthConfig** (existing, no schema change): `site_url: string`, `uri_allow_list: string` (comma-separated).
- **RedirectUrl** (frontend-only view-model): single string entry, parsed from `uri_allow_list.split(',').map(s => s.trim()).filter(Boolean)`. Re-joined on write.

## Verification Plan

1. Vitest unit test for the URL parsing/joining helpers (split, trim, dedupe, re-join).
2. Vitest component test for ProjectAuthUrlConfig — admin vs member rendering, add/remove behavior, validation rejection paths.
3. Playwright spec (FR-013).
4. Live-VM smoke: deploy to supaviser.dev, save a Site URL, save 3 Redirect URLs, verify .env contents + auth container env + GoTrue accepts a localhost redirect end-to-end via `scripts/oauth-test/index.html`.
5. Screenshot diff (manual) against `https://supabase.com/dashboard/project/<ref>/auth/url-configuration` at 1440px.
