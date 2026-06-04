# Feature Specification: Platform Studio base=root API URL + legacy studio reduced to /setup

**Feature Branch**: `086-platform-base-root-url`

**Created**: 2026-06-04

**Status**: Draft

**Input**: User direction (refined): "Cut the supastack platform studio (IS_PLATFORM=true) over to a base=root API URL so its management calls resolve as /v1/* and its platform calls as /platform/* directly — eliminating the /api/v1/v1/* double-prefix and the rewrite shim. Migrate the legacy supastack studio to serve ONLY the /setup purpose and remove its other pages. The setup flow should create the first user via the GoTrue API and create the first organization via the platform organization API (not the inline legacy duplicate)."

## Context & Glossary

Operator-established naming (used throughout):

- **supastack platform studio** — the single shared Studio running with `IS_PLATFORM=true` in the control plane. Served at the apex root (and `/dashboard`). The live, in-use dashboard.
- **supabase project studio** — the per-instance Studio inside each provisioned project stack. Not affected.
- **legacy supastack studio** — the older bespoke React SPA (`apps/web`). Already routing-retired (only `/setup` reaches it). Being reduced to a **setup-only** SPA: its non-setup pages are removed.
- **supastack platform API Server** — the single control-plane API (`apps/api`).

### Corrected premise (from the 2026-06-04 audit)

An audit established that **`/api/v1` is NOT a dead legacy namespace** — it is the **internal engine** that the platform studio sits on top of:

- The platform studio's `/platform/*` surface is largely a Studio-shaped façade: many of its routes `app.inject` *back into* `/api/v1/*` or `/v1/*`. In particular `POST /platform/projects` (project create) and `/platform/projects/:ref/restart` delegate to `/api/v1/instances` — so **`/api/v1/instances` is load-bearing**, not legacy-dead.
- **Backups and audit have no working platform equivalent**: `/platform/database/:ref/backups` and `/platform/.../audit` are **stubs** (`{backups:[]}`, restore = no-op `{status:'restoring'}`, `{result:[],count:0}`). The only real implementations are the legacy `/api/v1/instances/:ref/backups` (feature 019 async worker) and `/api/v1/audit`.
- Multi-tenant **organizations were never on legacy `/api/v1`** — they are a platform-only concept (feature 084: `/platform/organizations`, real + tested). `org.ts` (`/api/v1/org`) is the **installation** singleton (apex + backup-store), an infra concern.
- The only genuinely-redundant legacy copies are `/api/v1/projects/:ref/secrets` (secrets-dashboard) and the `/api/v1`-mounted `/projects/:ref/config/auth` — because the platform studio routes those through `/v1`/`/platform`, not the `/api/v1` copy.

**Therefore this feature does NOT delete the `/api/v1` engine.** It (1) gives the platform studio clean Cloud-parity URLs, (2) reduces the legacy SPA to the setup wizard only, and (3) makes setup reuse the platform identity/tenancy primitives. `/api/v1` remains the retained internal engine.

**Today's URL problem**: the platform studio's API base is `…/api/v1`. For Management-compat calls it appends a hard-coded `/v1/…` (upstream generated client), producing `/api/v1/v1/projects/<ref>/…`, caught by an `app.inject` rewrite shim. The doubling exists only because bare `/v1/*` is not routed to the API at the apex.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Platform studio calls resolve at clean Cloud-parity URLs (Priority: P1)

When the operator uses the platform studio, every request resolves at a single clean path — platform calls at `/platform/…`, Management-compat calls at `/v1/…` — with no doubled `/api/v1/v1/…` segment and no rewrite hop. The studio's internal server-side delegations (e.g. project-create injecting to `/api/v1/instances`) are unaffected because they are server-internal.

**Why this priority**: The core value — removes the doubled-prefix artifact, matches Supabase Cloud's URL shape, drops the shim, and stops the studio from borrowing the `/api/v1` prefix for its browser calls.

**Independent Test**: Load a project's pages in the platform studio and inspect the network panel. Management-compat requests go to `https://<apex>/v1/projects/<ref>/…` (200), platform requests to `https://<apex>/platform/…` (200), and there are zero requests to any `…/api/v1/v1/…` path. Visible feature surface renders identically.

**Acceptance Scenarios**:

1. **Given** the platform studio is open on a project, **When** it fetches API keys, **Then** the request resolves at `/v1/projects/<ref>/api-keys` (200, same payload) and no `/api/v1/v1/…` request is issued.
2. **Given** the studio reads/saves auth-config, **When** those calls fire, **Then** they resolve at `/platform/auth/<ref>/config` (+ `/config/hooks`) (200), preserving feature-085 behavior.
3. **Given** the operator creates a project in the studio, **When** the create fires at `/platform/projects`, **Then** it succeeds — its internal delegation to `/api/v1/instances` still provisions (server-side, unaffected by the base change).

---

### User Story 2 - Legacy studio reduced to the /setup wizard; other pages removed (Priority: P2)

The legacy supastack studio (`apps/web`) is reduced to a **setup-only** SPA. Its non-setup pages (projects/instances dashboard, organizations, backups, audit, settings, tokens, pooler, etc.) and their API client methods are removed. Only the install-wizard flow and its gate remain. The retained `/api/v1` engine routes are **not** removed — they continue to serve the platform studio's internal delegations, the CLI, the worker, and tests.

**Why this priority**: Cleanup that makes the legacy SPA's scope match reality (it is only ever served at `/setup`). It removes dead UI + dead client code without touching the load-bearing API engine.

**Independent Test**: Build/serve `apps/web`; confirm only the setup wizard is reachable and the removed pages are gone from the bundle. Confirm the apex root + `/dashboard` serve the platform studio. Confirm the platform studio's project create/restart, backups, and audit still work (they use the retained `/api/v1` engine internally).

**Acceptance Scenarios**:

1. **Given** the slimmed legacy SPA, **When** the operator opens `/setup`, **Then** the wizard loads and completes; **When** they navigate to any former page route, **Then** it no longer exists in the SPA.
2. **Given** the cutover is deployed, **When** the operator opens the apex root, **Then** the platform studio loads (not the legacy SPA).
3. **Given** the SPA pages are removed, **When** the operator exercises project create/restart, backups, and audit in the platform studio, **Then** all still work (the `/api/v1` engine routes they delegate to are retained).

---

### User Story 3 - Setup creates the first user via GoTrue and the first org via the platform org primitive (Priority: P2)

The `/setup` flow stops hand-rolling identity/tenancy. The first operator is created via the control-plane **GoTrue** API (already the case via `ensureGotrueUser` — to be verified, with any residual legacy `users`-table write removed). The first organization + owner membership is created through the **same org-creation primitive as `POST /platform/organizations`**, eliminating today's inline-SQL duplicate in `setup.ts`. Setup-specific concerns (installation row, `setup_state`, master-PAT mint, audit, ownerless-org backfill) remain in setup.

**Why this priority**: Removes a real divergence — org-creation logic currently lives in two places that must be kept in sync. Consolidating to one primitive makes the platform studio and setup agree by construction.

**Independent Test**: Run a fresh setup against a clean control plane. Confirm the created operator is a real GoTrue `auth.users` row, the created org + owner membership are produced by the shared platform org-creation path (same ref format, same role assignment), and a subsequent `GET /platform/organizations` lists that org for the operator.

**Acceptance Scenarios**:

1. **Given** a fresh install, **When** `POST /api/v1/setup` runs, **Then** the operator exists as a GoTrue user (no legacy `public.users` insert) and the org+membership are created via the shared platform org primitive (not inline SQL).
2. **Given** setup completed, **When** the operator signs into the platform studio and calls `GET /platform/organizations`, **Then** the setup-created org appears with the operator as owner.
3. **Given** the org primitive is shared, **When** an org is created in the platform studio vs. via setup, **Then** both produce structurally identical org+membership rows (one implementation).

---

### User Story 4 - No regression to the CLI Management API, login, or the /api/v1 engine (Priority: P3)

The Supabase-Management-compat surface at `https://api.<apex>/v1/*` (CLI/MCP), operator login (GoTrue `/auth/v1/*`), and the retained `/api/v1` engine routes (instances create/restart, backups, audit, credentials-reveal — used by the platform studio's internal delegations and by the test suite) all keep working.

**Why this priority**: Guardrail. The URL re-plumbing and SPA slimming must not break external contracts or the internal engine.

**Independent Test**: Run the CLI-compat E2E against `api.<apex>` (pass). Sign into the studio (GoTrue token exchange succeeds). Run the integration suite that drives `/api/v1/instances`, `/api/v1/auth/tokens`, `/api/v1/instances/:ref/backups` (pass).

**Acceptance Scenarios**:

1. **Given** an operator PAT, **When** the `supabase` CLI calls `https://api.<apex>/v1/projects/<ref>/…`, **Then** responses are unchanged.
2. **Given** the operator signs in, **When** login posts to the GoTrue token endpoint, **Then** auth succeeds (login path not derived from the studio API base).
3. **Given** the integration tests run, **When** they exercise `/api/v1/instances`/`/auth/tokens`/`/instances/:ref/backups`, **Then** they pass (the engine routes are retained).

---

### Edge Cases

- **Stale/cached studio build after cutover**: a cached bundle (old `…/api/v1` base) would still emit `/api/v1/v1/…`. Default: shim removed, hard refresh expected; rollback = revert the studio image together with the API/edge change.
- **`/setup` reached over plain HTTP before DNS/TLS**: must keep working at `http://<server-ip>/setup`; slimming the SPA and adding the apex `/v1*` route must not disturb the setup status/submit endpoints or the ACME challenge path.
- **Setup org-creation pre-auth ordering**: `POST /platform/organizations` requires an authenticated session; setup runs before any operator/session exists. The shared primitive must be reachable in setup's bootstrap ordering (create GoTrue user → mint PAT → create org via the shared path → write installation/setup_state/audit).
- **Removing an SPA page that still imports a shared client method used by setup**: the api-client methods setup needs (`setup`, `setup/status`, `auth/me`, `org` PATCH, `apex/*`, `wildcard-certs/*`) must be retained even as other methods are deleted.
- **Apex `/v1` vs `api.<apex>/v1` auth parity**: the same `/v1/*` routes become reachable at the apex (studio: session/JWT) and at `api.` (CLI: PAT); both credential types must continue to be accepted with no privilege change.
- **Path-prefix ordering at the edge**: the apex `/v1*` route must not shadow ACME, `/api/*`, `/platform/*`, websocket, or `/setup*`; the catch-all to the studio still wins for everything else.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform studio MUST issue Management-compat requests to a single `/v1/…` path at the apex (no `/api/v1/v1/…`).
- **FR-002**: The platform studio MUST issue platform requests to `/platform/…` at the apex, preserving all current behavior (including the feature-085 auth-config bridge).
- **FR-003**: The platform API Server MUST serve the studio's `/v1/*` and `/platform/*` requests at the apex root with the same responses they received via the previous `/api/v1/*` and `/api/v1/v1/*` paths.
- **FR-004**: The edge/router MUST route apex `/v1/*` to the platform API Server, ordered so it does not shadow ACME, `/api/*`, `/platform/*`, websocket, or `/setup*`, with the studio catch-all still applying to all other paths.
- **FR-005**: The `/api/v1/v1/*` rewrite shim MUST be removed once the cutover is in place (end state has no doubled-prefix handling).
- **FR-006**: The legacy supastack studio MUST be reduced to the `/setup` wizard only — its non-setup pages and the corresponding API client methods MUST be removed; the apex root and `/dashboard` MUST serve the platform studio.
- **FR-007**: The `/setup` install wizard MUST continue to function unchanged, including over plain HTTP before DNS/TLS, with its status/submit endpoints intact.
- **FR-008**: Operator login (GoTrue token exchange) MUST be unaffected by the API base change; the login endpoint MUST NOT be derived from the studio API base.
- **FR-009**: The Management-compat surface at `https://api.<apex>/v1/*` (CLI/MCP) MUST be unchanged in paths, shapes, and error envelope.
- **FR-010**: The `/api/v1` namespace MUST be RETAINED **in full** as the internal engine for this feature. Routes used by the platform studio's internal delegation (`/api/v1/instances` create/restart), the only-real-implementation routes (`/api/v1/instances/:ref/backups`, `/api/v1/audit`), credentials-reveal, and all INFRA routes (setup, health, apex, wildcard-certs, pooler, reset-pg-password, vault-enable, cli-*, org/backup-store) MUST NOT be removed. The redundant façade copies (`/api/v1/projects/:ref/secrets` (secrets-dashboard) and the `/api/v1`-mounted `/projects/:ref/config/auth`) are **retained this feature and their removal is DEFERRED to a follow-up** — they are not deleted here. Note the secrets-dashboard copy still has live test callers (`contract/secrets-wire.test.ts`, `dashboard-routes-smoke.test.ts`), so its removal requires test migration and is out of scope for 086.
- **FR-011**: The setup flow MUST create the first operator via the control-plane GoTrue API (verify `ensureGotrueUser` is the sole path; remove any residual legacy `users`-table write).
- **FR-012**: The setup flow MUST create the first organization + owner membership through the SAME primitive as `POST /platform/organizations` (single implementation; eliminate the inline-SQL duplicate). Installation row, `setup_state`, master-PAT mint, audit, and ownerless-org backfill remain setup-specific.
- **FR-013**: Removing legacy SPA pages MUST NOT remove any `/api/v1` route still used by the platform studio's internal delegation, the CLI, the worker, or the test suite. Any route deletion MUST be guarded by verifying it has no such caller.
- **FR-014**: The change MUST be deployable to the live VM and verifiable end-to-end (studio renders project pages with clean URLs; `/setup` runs a full first-install; login + CLI surface pass) before being considered complete.

### Key Entities

- **URL surface — platform**: `/platform/*`, served at the apex; the studio's platform calls move from `/api/v1/platform/*` to `/platform/*`.
- **URL surface — Management-compat (browser)**: `/v1/*` at the apex; replaces the doubled `/api/v1/v1/*`.
- **URL surface — Management-compat (CLI)**: `/v1/*` at `api.<apex>`. Unchanged.
- **`/api/v1` internal engine**: retained; serves the platform studio's internal `app.inject` delegations (instances create/restart), the only-real backups/audit, credentials-reveal, and all INFRA routes — plus the `/setup` wizard endpoints.
- **Legacy SPA (setup-only)**: `apps/web` reduced to the install wizard + its gate.
- **Org-creation primitive**: the single shared implementation used by both `POST /platform/organizations` and the setup flow.
- **Studio API base configuration**: the build-time value the studio uses to construct URLs; changes from `…/api/v1` to the apex root.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: Using the platform studio on a project, **0** requests go to any `…/api/v1/v1/…` path (down from non-zero).
- **SC-002**: **100%** of the studio's previously-working project pages render with identical data after the cutover.
- **SC-003**: `/setup` loads and completes a full first-install both over plain HTTP (pre-DNS) and over HTTPS.
- **SC-004**: The Supabase CLI-compat checks, operator login, and the integration suite (driving `/api/v1/instances`/`auth/tokens`/`backups`) all pass with no regression.
- **SC-005**: The legacy SPA contains only the setup wizard — the non-setup pages and their client methods are removed; the apex root serves the platform studio.
- **SC-006**: Org creation has a **single** implementation shared by setup and `POST /platform/organizations`; the setup-created operator is a GoTrue `auth.users` row with no legacy `users`-table insert.
- **SC-007**: The retained `/api/v1` engine still serves the platform studio's internal delegations (project create/restart, backups, audit) — verified working post-change.

## Assumptions

- The legacy SPA is already served only at `/setup`; the apex root + `/dashboard` already serve the platform studio. This feature formalizes that and removes the SPA's non-setup pages.
- The platform studio's request URLs derive from a single build-time API base value; changing it requires rebuilding/redeploying the studio image. A brief dashboard interruption during the coordinated deploy (studio image + edge route + base value, applied together) is acceptable on the single-operator VM.
- Operator login is handled by GoTrue at `/auth/v1/*` via its own URL, independent of the studio's API base — so the base change does not touch login.
- The `/api/v1/v1/*` shim is removed as part of the cutover; rollback safety = revert the studio image (restores the old base) together with the API/edge change.
- `/api/v1` remains routed to the API at the edge — it is the retained internal engine, still required by `/setup`, the platform studio's internal delegations, the CLI, the worker, and tests.
- Setup creating the org via the platform primitive will reuse it in setup's bootstrap ordering (create GoTrue user → mint PAT → create org via the shared path → write installation/setup_state/audit), most likely via an internal `app.inject` (the pattern already used by `/platform/projects` → `/api/v1/instances`); the exact mechanism is a planning concern.
- The Management-compat contract at `api.<apex>/v1` is canonical and frozen by this feature.
- Out of scope (filed as follow-ups): making the platform backup/restore + audit routes real (they are stubs today); removal of **all** redundant `/api/v1` façade copies, including the two named (`secrets-dashboard` + the `/api/v1` `config/auth` mount) — deferred because the secrets-dashboard copy still has live test callers and removal needs test migration.
