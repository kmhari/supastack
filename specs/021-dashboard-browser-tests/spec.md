# Feature Specification: Dashboard Browser-Level E2E Tests

**Feature Branch**: `021-dashboard-browser-tests`

**Created**: 2026-05-28

**Status**: Draft

**Input**: During the feature 020 deploy on 2026-05-28, a sidebar entry that shipped in source code (the "Authentication → Providers" navigation link) failed to surface in the operator's browser. The repo's tests caught zero of the conditions that produced the gap: vitest+jsdom unit tests proved the destination page rendered; backend contract tests proved the API surface worked; behavioral parity bash scripts proved the PATCH→container chain worked. None of them rendered the actual SPA inside a real browser, so the navigation, route registration, sidebar rendering, and bundle delivery paths were untested end-to-end. The existing `apps/web/tests/e2e/*.spec.ts` files are Playwright placeholders that have never been executed (they skip when `PLAYWRIGHT_BASE_URL` is unset; CI never sets it). This feature closes that gap by standing up a real browser test harness against the deployed dashboard and codifies smokes for the operator paths that vitest cannot cover.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — A regression in dashboard navigation fails CI before reaching production (Priority: P1)

A developer ships a change that breaks the dashboard's sidebar — a typo in a route path, a deleted navigation entry, a build pipeline change that omits an asset. Today this only surfaces when an operator notices on a deployed environment. After this feature, a browser-level CI job opens the actual SPA, asserts the sidebar contains the expected navigation entries, and fails before the PR can merge.

**Why this priority**: This is the gap that motivated the feature. The cost of a navigation regression reaching production is real: operators lose visibility into a feature, support time gets spent on "I can't find X", trust in the dashboard erodes. Catching this in CI is the highest-leverage outcome.

**Independent Test**: Make a PR that removes one sidebar entry from `ProjectShell.tsx`. The browser test suite fails on a specific assertion naming the missing entry. Restore the entry; the test passes. No other CI change required.

**Acceptance Scenarios**:

1. **Given** a deployed dashboard reachable at a known URL, **When** the browser test suite runs, **Then** it logs in as a seeded admin user, navigates to a known project, and asserts the project-shell sidebar contains every expected navigation group and entry by visible text.
2. **Given** a developer deletes one sidebar entry in source, **When** CI runs the browser test suite, **Then** the suite fails with a message that identifies which expected entry was not found.
3. **Given** the test suite runs against a freshly-built dashboard, **When** the bundle hash changes between runs, **Then** the suite continues to work (it asserts on visible text, not bundle hashes).

---

### User Story 2 — Auth Providers page is exercised end-to-end in a browser (Priority: P1)

A developer changes the Auth Providers page — adds a new provider row, changes the drawer's field set, alters the deep-link querystring. After this feature, browser tests verify the page loads, the providers list contains the expected rows, clicking a row opens the side drawer, the drawer's form fields exist with the right labels, and the `?provider=Google` deep-link opens the right drawer on mount. Regressions in any of these paths fail CI.

**Why this priority**: Feature 020 deliberately deferred drawer-interaction RTL tests because Radix Sheet's portal-rendered DOM is fragile in jsdom. A real browser doesn't have that limitation. The Auth Providers page is the canonical complex-interaction surface in the dashboard; if browser tests cover it, the pattern extends naturally to every other interactive page.

**Independent Test**: Browser test opens the Auth Providers page, asserts at least 5 provider rows are visible, clicks the Google row, asserts the side drawer becomes visible with `Client IDs`, `Client Secret`, and `Callback URL` labels, closes the drawer, opens via `?provider=Slack (OIDC)` deep-link, asserts the OIDC-shape drawer renders.

**Acceptance Scenarios**:

1. **Given** the operator opens the Auth Providers page, **When** the page mounts, **Then** the providers list contains rows for Email, Phone, the 21 OAuth provider rows, and the disabled coming-soon rows (SAML, Web3, Custom Providers).
2. **Given** the operator clicks the Google row, **When** the click event resolves, **Then** the side drawer is visible and contains form inputs for Client IDs, Client Secret (with Reveal button), Skip nonce checks, and Callback URL (pre-filled, read-only).
3. **Given** the operator navigates to `/auth/providers?provider=Slack%20(OIDC)`, **When** the page mounts, **Then** the side drawer is open on the OIDC-shape Slack drawer, not the legacy Slack drawer.
4. **Given** the operator is logged in as a non-admin role, **When** they open the Auth Providers page, **Then** the Save button on the global toggles is not present in the DOM.

---

### User Story 3 — Critical operator flows have at least one browser smoke each (Priority: P2)

For every dashboard page that represents a critical operator path (creating a project, revealing credentials, configuring backups, viewing health, managing org members), a browser test mounts the page in a real browser and asserts the page's primary UI elements are visible. Coverage is breadth-first: one assertion per page, not exhaustive interaction trees.

**Why this priority**: P2 because US1 + US2 already deliver the highest-value coverage. US3 generalizes the harness to the rest of the dashboard so future features inherit baseline coverage without each having to invent its own test setup. Lower urgency than US1/US2 but high leverage over time.

**Independent Test**: For each of the eight critical project + settings pages, the browser test loads the page (with the necessary auth context) and asserts a known headline text is visible (e.g. "API Keys", "Backups", "JWT Keys"). All eight pass.

**Acceptance Scenarios**:

1. **Given** a logged-in admin and an existing test project, **When** the browser test navigates to each of the project shell's pages (General, API Keys, JWT Keys, Secrets, Backups, Auth Providers, Health), **Then** each page renders without console errors and its primary heading is visible.
2. **Given** a logged-in admin, **When** the browser test navigates to each of the org-level settings pages (Members, Audit, Database, Tokens, CLI, MCP Clients), **Then** each page renders without console errors.
3. **Given** any of the above pages errors during render, **When** CI runs, **Then** the test fails with a screenshot artifact showing the broken state.

---

### User Story 4 — Browser tests run on every PR, not only on operator demand (Priority: P2)

The Playwright suite executes as a CI job triggered on every pull request that touches files under `apps/web/`, `infra/`, or `apps/api/src/routes/`. The job spins up the full stack against a disposable test database, runs the suite, captures screenshots on failure, and posts a comment back to the PR with the result. Developers see the outcome before requesting review.

**Why this priority**: P2 because the value lands incrementally — even without CI integration, a developer running `pnpm test:e2e` locally before merging catches most regressions. CI automation is the multiplier. Lower priority than US1/US2 because those land the assertions; this lands the automation around them.

**Independent Test**: Open a PR that breaks the sidebar. CI emits a `e2e-tests` check that fails within 10 minutes. The PR check page links to a screenshot of the failing state.

**Acceptance Scenarios**:

1. **Given** a PR modifies a dashboard component, **When** the PR is opened, **Then** the browser-test CI job runs within 2 minutes of opening.
2. **Given** the CI job runs, **When** any test in the suite fails, **Then** the job posts a comment to the PR with the failing test name, the assertion message, and an attached screenshot.
3. **Given** the suite passes, **When** CI finishes, **Then** the job emits a green check on the PR with run duration and the count of tests executed.
4. **Given** a developer wants to run the suite locally, **When** they execute the documented command, **Then** the suite runs against `localhost:5173` (or the configured port) in under 5 minutes and produces the same pass/fail signals as CI.

---

### Edge Cases

- The dashboard bundle hash changes between test runs. Assertions on hashed asset filenames are not used; tests resolve to visible text or stable test IDs.
- The deployed dashboard is unreachable during a test run (DNS failure, Caddy down). The suite reports a clear "could not reach `BASE_URL`" error rather than per-test failures.
- A test logs in but the admin user's session expires mid-suite. The harness re-authenticates automatically or fails fast with a clear "session lost" message.
- A test mutates state (creates a project, modifies auth-config) and a previous run left side effects. Each test starts from a known-good baseline OR is idempotent.
- Screenshots captured on failure include sensitive values (admin PAT in network panel). The screenshot pipeline redacts known secret patterns before upload.
- Tests are slow and flaky because of real-network conditions against `supaviser.dev`. The CI variant runs against a local stack; only the manual nightly run uses the live VM.
- A new dashboard page is added and the developer forgets to add a smoke. A linting step in CI warns when new files appear under `apps/web/src/pages/` without a corresponding browser-test reference.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A browser test suite MUST exercise the deployed dashboard SPA using a real browser engine, not jsdom.
- **FR-002**: The suite MUST log in as a seeded admin user using the existing dashboard authentication flow (session cookie OR PAT, whichever the dashboard accepts).
- **FR-003**: The suite MUST assert that every expected sidebar navigation entry on the project shell is present and links to a non-404 route. The expected set of entries is enumerated in the suite as a single source of truth that future features extend.
- **FR-004**: The suite MUST open the Auth Providers page and assert: the providers list contains rows for Email + Phone + 21 active OAuth providers + 3 coming-soon placeholders; clicking an active provider row opens a side drawer; the drawer contains the form fields documented in feature 020's provider-form-templates contract for that provider family.
- **FR-005**: The suite MUST cover at least one assertion per critical dashboard page (project-level + org-level). The list of "critical pages" is documented in the suite README and updated as new pages ship.
- **FR-006**: The suite MUST run locally via a single documented command, and via CI on every pull request that touches dashboard or infrastructure source paths.
- **FR-007**: When a test fails, the suite MUST capture a screenshot of the failing browser state and surface it as a CI artifact attached to the pull request.
- **FR-008**: The suite MUST NOT depend on the live production VM for CI runs. CI uses a disposable local stack. A separate manual workflow MAY target the live VM for nightly verification.
- **FR-009**: Captured **text artifacts** (console logs, network panel JSON, JUnit reports, log files) MUST redact known secret patterns (admin PAT format, OAuth client secrets, AWS keys) before upload as CI artifacts. PNG screenshot redaction is out of scope for v1 — image redaction requires OCR or display-region heuristics that exceed the harness's complexity budget. A separate follow-up issue tracks PNG redaction if a real leak surfaces.
- **FR-010**: Adding a new dashboard page MUST require updating the suite's expected-pages list, enforced by a lint step that compares files under the pages directory with the suite's coverage list and fails when they drift.
- **FR-011**: The suite MUST run to completion (pass or fail) in under 5 minutes on the CI runner.
- **FR-012**: A failing browser test MUST identify the exact UI element it expected to find (by text or test ID), the page URL it was on, and the path it took to get there — so a developer can reproduce the failure without running the suite locally.

### Key Entities

- **Browser test case**: One or more navigation actions followed by assertions against the rendered DOM. Each test is independent (can run alone) and idempotent (does not leave behind state that breaks the next run).
- **Expected-pages registry**: A code-level list of dashboard pages with their expected URL paths, headline text, and the navigation entry that should link to them. The lint step in FR-010 reads this list and compares it to the filesystem.
- **Test admin account**: A seeded user with admin role on a seeded test organization, used by the suite for authentication. The CI environment provisions this account fresh on every run.
- **CI artifact bundle**: Screenshots, console logs, and a JUnit-format test report attached to the pull request on failure.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A developer making a change that removes a sidebar navigation entry sees the test fail in their local pre-merge run within 5 minutes of running the suite.
- **SC-002**: A pull request touching files under `apps/web/`, `infra/`, or `apps/api/src/routes/` triggers the browser-test CI job automatically; the job appears in the PR's check list when GitHub Actions provisions a runner (typically within 5 minutes on `ubuntu-latest`). The 5-minute window is a runner-availability observation, not a selfbase-enforceable contract.
- **SC-003**: On a clean run against an up-to-date `main`, the suite passes 100% of tests in under 5 minutes total wall-clock.
- **SC-004**: For every dashboard page reachable via the project shell sidebar or settings sidebar, at least one browser-test assertion exists in the suite at merge time, enforced by the lint step.
- **SC-005**: On a failing test, a developer can reproduce the failure locally using only the information in the CI artifact bundle, without consulting the test source code.
- **SC-006**: At least 10 historical bugs that would have been caught by a browser test (drawn from project history) have a corresponding regression test in the suite within 60 days of this feature shipping.
- **SC-007** *(post-ship metric; not blocking feature merge)*: The suite catches every dashboard regression that would otherwise require manual operator discovery, measured by tracking issues filed against feature 020's sidebar-missing class of bug — zero such issues filed in the 90 days after the suite ships. Measurement is operator-comms / issue-tracker analysis; no build task implements it.

## Assumptions

- A Playwright (or equivalent real-browser) harness is the implementation choice. The existing placeholder files at `apps/web/tests/e2e/*.spec.ts` use this idiom, and `package.json` already has the dependency slot.
- CI provisions a disposable test stack (control-plane api + web + db + redis + caddy) per PR run; existing scripts for `pnpm dev` are reusable for the test environment.
- The dashboard's existing authentication flow (session cookie set via `/api/v1/auth/login`) is the canonical login path the suite uses.
- A seeded admin user can be created via the existing setup/seed scripts; the suite reuses that mechanism rather than inventing a new test-user provisioner.
- Browser tests run against the dashboard SPA served at the same host as the api (Caddy reverse-proxies both). No CORS or cross-origin authentication complexity is introduced.
- Per-instance project provisioning is NOT exercised in CI (too slow, requires docker-in-docker). Tests that need a project use a pre-seeded fixture project. A manual nightly job MAY run a full-stack suite that creates real projects.
- The screenshot redaction list (admin PAT pattern, OAuth secret pattern, etc.) is implemented as a regex set documented in the test README, extensible as new secret formats appear in the project.

## Dependencies

- **Feature 020** — exposes the gap that motivated this feature; the Auth Providers page is the first surface tested.
- **apps/web/tests/e2e/** — placeholder files exist; they get replaced with real implementations.
- **Dashboard authentication** — depends on the existing `/api/v1/auth/login` endpoint and session-cookie flow.
- **Setup / seed scripts** — the suite reuses whatever path the dev `pnpm dev` flow uses to bootstrap an admin user.

## Out of Scope

- Visual regression / pixel-diff testing. Screenshots are captured only on failure for diagnostic purposes, not compared against goldens.
- Performance / load testing. The suite is a correctness gate, not a benchmark.
- Multi-browser coverage. The suite targets Chromium-equivalent only at first; Firefox/WebKit can be added later if specific bugs justify it.
- Accessibility (a11y) audits. Worth doing eventually but a separate effort.
- Mobile / responsive layout testing. The dashboard is desktop-only by current design.
- Browser-level testing of the per-instance Supabase Studio. Studio is upstream and not selfbase's surface to test.
- End-to-end testing of OAuth provider IdP roundtrips with real Google/GitHub/etc. Network-bound, slow, and depends on external services; manual smoke remains the source of truth for that path.
- Backfilling 10 historical regression tests in this feature. SC-006 is a 60-day target; the initial ship lands the harness + US1 + US2 + US3 coverage.
- A nightly workflow targeting the live VM (`supaviser.dev`). Tracked separately in plan.md §D2 / tasks.md T034; not part of v1.
