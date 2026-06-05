# Feature Specification: API host-parity — serve the platform + Management API at `api.<apex>` (cross-origin, scoped CORS)

**Feature Branch**: `107-api-host-parity`

**Created**: 2026-06-05

**Status**: Draft

**Input**: Mirror Supabase Cloud's host nomenclature — the dashboard calls `api.supabase.com/platform/*` + `/v1/*`. Today supastack's shared Studio (served at the apex `/dashboard`) calls the **apex root** (`<apex>/platform/*` + `/v1/*`, feature 086). Move the dashboard's API base to a dedicated `api.<apex>` host so URLs match Supabase, which makes those calls **cross-origin** and therefore requires a tightly-scoped CORS layer on the API. Login/auth stays at the apex.

## Context & Glossary

- **apex** — the installation's root domain (e.g. `supaviser.dev`). The shared Studio (the operator's dashboard) is served here under `/dashboard`.
- **API host** — a dedicated `api.<apex>` (e.g. `api.supaviser.dev`) that serves the dashboard's internal **platform API** (`/platform/*`) and the **Management API** (`/v1/*`). The wildcard `*.<apex>` TLS cert already covers it. The CLI/MCP already target `api.<apex>/v1`.
- **Same-origin vs cross-origin** — today the dashboard (apex) calls the API (apex) **same-origin**, so no CORS is involved (feature 086 chose this deliberately). Pointing the dashboard at `api.<apex>` makes those calls **cross-origin** (different host), so the browser enforces CORS: the API must return the right `Access-Control-Allow-*` headers, including answering preflight `OPTIONS`.
- **Auth boundary** — control-plane login (GoTrue) stays at the apex (`<apex>/auth/v1`, same-origin to the dashboard). Only `/platform/*` and `/v1/*` move to the API host. Dashboard→API auth is a Bearer JWT in the `Authorization` header (feature 084), not a cookie.

This feature is a **conscious reversal** of feature 086's same-origin apex-root decision, taken to match Supabase's host structure. The trade accepted: cross-origin + a CORS layer, in exchange for exact host nomenclature parity and a clean separation of the API host from the dashboard host. The `/v1` Management API **contract** (paths, request/response shapes) is unchanged — only the host the dashboard targets changes.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - The dashboard works fully against the dedicated API host (Priority: P1)

The operator uses the dashboard exactly as before, but every API call now goes to `api.<apex>` (matching Supabase's `api.supabase.com`). Every page loads, every query and table/policy/trigger action works, the SQL/pg-meta calls work, and there are **no CORS errors** — the cross-origin requests are accepted because they come from the dashboard's own origin.

**Why this priority**: This is the feature. If any dashboard call is blocked by CORS (a missing allowed header, an unhandled preflight, a wrong origin), that page breaks — a partial CORS allow-list silently breaks a subset of the dashboard.

**Independent Test**: With the dashboard pointed at `api.<apex>`, exercise the main pages (home, tables, SQL editor, triggers/policies, auth config, settings, backups) and confirm 0 CORS errors in the browser console and every data-fetch + mutation succeeds — including the pg-meta proxy POST that carries custom headers and a body.

**Acceptance Scenarios**:

1. **Given** the dashboard is served at the apex and its API base is `https://api.<apex>`, **When** the operator opens any project page, **Then** the page's API calls succeed cross-origin with no CORS rejection.
2. **Given** a dashboard mutation (e.g. create a trigger via pg-meta, save auth config), **When** it issues a cross-origin `POST/PATCH` with `Authorization` + custom headers, **Then** the browser's preflight is answered and the request succeeds.
3. **Given** login at the apex (`/auth/v1`, same-origin), **When** the operator signs in, **Then** the session is established and subsequent cross-origin API calls carry the Bearer token and are accepted.

---

### User Story 2 - Cross-origin access is locked to the dashboard origin only (Priority: P2)

The API accepts cross-origin browser calls **only** from the dashboard's own apex origin. A request presenting any other `Origin` does not receive a usable CORS grant, so a malicious third-party site cannot drive the credentialed API from a victim operator's browser.

**Why this priority**: The API is credentialed (Bearer). A permissive CORS policy (`*`, or echoing arbitrary origins) would let any website make authenticated calls with the operator's token context. Scoping is a security control, not a nicety.

**Independent Test**: Send a request with `Origin: https://evil.example` → the response does NOT include an `Access-Control-Allow-Origin` for that origin (so the browser blocks the JS from reading it). Send with the dashboard origin → it does.

**Acceptance Scenarios**:

1. **Given** a browser request with the dashboard apex `Origin`, **When** the API responds, **Then** `Access-Control-Allow-Origin` is exactly that origin (never `*`).
2. **Given** a request with a foreign `Origin`, **When** the API responds, **Then** no permissive CORS grant is returned for that origin.
3. **Given** the credentialed nature of the API, **When** CORS is configured, **Then** the credentials posture matches the real auth mechanism (Bearer header — no cross-origin cookies required; if any cookie session remains it is handled deliberately, not by a blanket `Allow-Credentials` with a wildcard origin).

---

### User Story 3 - No regression to CLI, MCP, login, or the Management contract (Priority: P3)

The `supabase` CLI and MCP (which already target `api.<apex>/v1`) keep working unchanged; login keeps working at the apex; and the `/v1` Management API paths/shapes are byte-for-byte unchanged. Non-browser clients don't do CORS, so they're unaffected.

**Why this priority**: The move must not break the surfaces that already work. The Management contract is pinned (Constitution IV); CLI/MCP/login are existing live flows.

**Independent Test**: Run the CLI against `api.<apex>/v1` (list/migration/gen-types) and a login round-trip → all pass, identical to before; the `/v1` OpenAPI snapshot contract test is unchanged.

**Acceptance Scenarios**:

1. **Given** the CLI configured for `api.<apex>`, **When** it runs management commands, **Then** they succeed exactly as before the change.
2. **Given** the `/v1` contract test, **When** it runs after the change, **Then** there is no drift.
3. **Given** login at the apex, **When** the operator authenticates, **Then** it works same-origin with no CORS involvement.

---

### Edge Cases

- **Preflight for the pg-meta proxy**: a `POST /platform/pg-meta/:ref/query` with `x-connection-encrypted`, `x-pg-application-name`, `x-request-id`, `content-type: application/json`, and a SQL body — the preflight `OPTIONS` must allow those exact headers, or the query silently fails in the browser.
- **Future Studio version sends a new header**: the allow-list must be reviewed when the vendored Studio is bumped (a new custom header would be CORS-blocked). The allow-list should be maintainable/auditable, not scattered.
- **Cookie-based session remnants**: if any pre-feature-084 cookie auth path still exists, a cross-origin cookie needs `SameSite=None; Secure` + `Allow-Credentials: true` + an exact origin — the feature MUST confirm the dashboard→API auth is Bearer-only and no cookie is required, or handle it explicitly.
- **Cross-origin realtime/WebSocket** (if the dashboard opens one to the API host): WS isn't governed by CORS the same way; confirm the dashboard's socket connection (if any) still connects against the API host.
- **The apex still answers `/platform` + `/v1`**: existing same-origin apex routes (feature 086) are kept so the move is low-risk and reversible; the dashboard simply repoints.
- **Rollback mid-deploy**: if the rebuilt Studio fails cross-origin, reverting the Studio base to the apex restores same-origin operation without API changes.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The dashboard's platform (`/platform/*`) and Management (`/v1/*`) API calls MUST resolve at the dedicated `api.<apex>` host, mirroring Supabase Cloud's `api.supabase.com` nomenclature.
- **FR-002**: Every API call the dashboard makes (all methods it uses — GET/POST/PUT/PATCH/DELETE — and all request headers it sends, including `Authorization` and the custom `x-*` headers) MUST succeed cross-origin from the dashboard origin, with no CORS rejection.
- **FR-003**: The API MUST correctly answer CORS preflight (`OPTIONS`) requests for the dashboard origin, allowing the methods and headers the dashboard uses.
- **FR-004**: `Access-Control-Allow-Origin` MUST be the specific dashboard apex origin only — never `*` — because the API is credentialed.
- **FR-005**: The CORS allowed-request-headers MUST include `authorization` and every custom header the Studio sends (at minimum `x-connection-encrypted`, `x-pg-application-name`, `x-request-id`); the allow-list MUST be defined in one auditable place so it can be reviewed when the Studio is upgraded.
- **FR-006**: The `Allow-Credentials` posture MUST be determined from the real auth mechanism: the feature MUST confirm dashboard→API auth is a Bearer token (no cross-origin cookie), and MUST NOT enable credentialed CORS unless a cookie session genuinely requires it.
- **FR-007**: Control-plane login/auth MUST remain at the apex (`<apex>/auth/v1`, same-origin to the dashboard); only `/platform/*` and `/v1/*` move to the API host.
- **FR-008**: The `api.<apex>` host MUST be explicitly routed to the API (not served only incidentally via a host-agnostic fallback), so the API host is an intentional, durable surface.
- **FR-009**: The `/v1` Management API contract (paths, request/response shapes) and the existing `api.<apex>/v1` CLI/MCP behaviour MUST be unchanged (Constitution IV — pinned contract).
- **FR-010**: A cross-origin browser request from any origin other than the dashboard apex MUST NOT receive a CORS grant for that origin (no foreign-origin data access).
- **FR-011**: The change MUST be deployable as a coordinated sequence (API CORS available before the dashboard is repointed) with a clean rollback (revert the dashboard's API base to the apex), with no data migration.
- **FR-012**: The existing apex `/platform/*` + `/v1/*` routes MAY remain (dual-served) so the cutover is reversible and low-risk; removing them is out of scope for this feature.

### Key Entities

- **Dashboard origin** — the apex origin the shared Studio is served from; the sole allowed CORS origin for the API host.
- **API host (`api.<apex>`)** — the dedicated host serving `/platform/*` + `/v1/*`; the new dashboard API base and the existing CLI/MCP host.
- **CORS policy** — the single, auditable allow-list: allowed origin (the dashboard apex), allowed methods, allowed request headers (incl. the custom `x-*` set), credentials posture, preflight max-age.
- **Auth boundary** — login at apex `/auth/v1` (same-origin); API auth via Bearer JWT (cross-origin, header-based).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: With the dashboard pointed at `api.<apex>`, **100%** of the dashboard pages/flows that worked same-origin work cross-origin, with **0** CORS errors in the browser console across the exercised page set.
- **SC-002**: Login + the post-login dashboard load succeed unchanged (auth stays same-origin at the apex).
- **SC-003**: A browser request to the API host from a non-dashboard origin receives **no** usable CORS grant — **0** foreign origins can read API responses.
- **SC-004**: CLI (`supabase` against `api.<apex>/v1`) + MCP + the `/v1` contract test show **0** regressions vs before the change.
- **SC-005**: Rollback restores same-origin operation via a single dashboard-base revert (+ Studio rebuild), with no API or data change required.

## Assumptions

- Dashboard→API authentication is a Bearer JWT in the `Authorization` header (feature 084); no cookie-based control-plane session remains, so credentialed CORS is not required (to be confirmed during planning — FR-006).
- Login/auth stays at the apex; only the platform + Management surfaces move to the API host (not GoTrue).
- The apex continues to serve `/platform/*` + `/v1/*` (dual-serve) for reversibility; the dashboard simply changes which host it targets. Removing the apex copies is a separate future cleanup.
- The wildcard `*.<apex>` TLS cert already covers `api.<apex>`; no new certificate is required.
- The CLI/MCP already use `api.<apex>/v1`; this feature does not change their behaviour.
- The set of custom request headers the Studio sends is captured from the current vendored Studio (HAR-observed: `x-connection-encrypted`, `x-pg-application-name`, `x-request-id`); the allow-list must be revisited when the Studio is upgraded.
- This becomes the default dashboard configuration (not an opt-in), consciously superseding feature 086's same-origin apex base for the dashboard.
