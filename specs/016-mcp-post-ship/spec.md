# Feature Specification: MCP Post-Ship Hardening (Issues #50–#53)

**Feature Branch**: `016-mcp-post-ship`

**Created**: 2026-05-26

**Status**: Draft

**Input**: pickup issue 50,51,52,53 into a single spec

## Overview

Four follow-up improvements to feature 014 (Hosted MCP + OAuth 2.1) that were deferred from the initial ship. Together they close the gap between the spec's stated requirements and what was actually delivered: a runaway-query safety net for new projects (#50), a clean MCP tool surface with no phantom tools (#51), fully automated `get_logs` setup with no operator SSH required (#52), and route-level test coverage for the OAuth authorize + token endpoints (#53).

---

## User Scenarios & Testing

### User Story 1 — Statement Timeout Default at Provision (Priority: P1)

An operator provisions a new selfbase project. Without any manual configuration, every SQL query run through the MCP `execute_sql` tool, `supabase db query --linked`, or any other query path is protected by an 8-second statement timeout. Runaway queries cannot hold per-project Postgres indefinitely.

**Why this priority**: Directly prevents a class of operational incidents (long-running MCP queries holding locks or exhausting connections). Low implementation risk, high safety value. The spec originally stated this as MUST (FR-007).

**Independent Test**: Provision a new project, connect via `psql`, run `SHOW statement_timeout` — must return `8s`.

**Acceptance Scenarios**:

1. **Given** a freshly provisioned project, **When** `SHOW statement_timeout` is run inside it, **Then** the result is `8s`.
2. **Given** an existing project provisioned before this change, **When** `SHOW statement_timeout` is run, **Then** the result is unchanged (typically `0` = unlimited, unless operator already configured it).
3. **Given** an operator runs `supabase postgres-config update --statement-timeout=30000` on any project, **When** `SHOW statement_timeout` is checked, **Then** the operator-set value overrides the provision default.

---

### User Story 2 — Clean MCP Tool Surface (Priority: P2)

An operator connects Claude Code (or any MCP client) to `mcp.<apex>/mcp`. The LLM receives a `tools/list` containing only the tools that actually work. The four phantom tools (`create_project`, `get_cost`, `confirm_cost`, `get_advisors`) that show up today but fail with "not implemented" at call time are absent entirely. The LLM never attempts them and never surfaces a confusing 501 error to the operator.

**Why this priority**: UX quality — a clean tool surface means fewer LLM hallucinations attempting tools that will fail. Directly addresses SC-006 from the feature 014 spec.

**Independent Test**: Call `tools/list` via `mcp-roundtrip.sh`, count tool names — must be ≤ 19, none of the 4 deferred names present.

**Acceptance Scenarios**:

1. **Given** a valid MCP session, **When** `tools/list` is called, **Then** none of `create_project`, `get_cost`, `confirm_cost`, `get_advisors` (or any variant names like `get_security_advisors`, `get_performance_advisors`) appear in the response.
2. **Given** the filtered tool list, **When** an in-scope tool like `execute_sql` or `list_projects` is called, **Then** it works correctly (no regression from the filtering).
3. **Given** the filtered list, **When** `tools/list` is called twice in the same session, **Then** both responses are identical (filter is deterministic, not session-state-dependent).

---

### User Story 3 — Automatic Kong Analytics Route Setup for get_logs (Priority: P3)

An operator uses the `get_logs` MCP tool (or calls `GET /v1/projects/:ref/analytics/endpoints/logs.all`) on any project — whether newly provisioned or existing — without needing to SSH into the VM, edit kong.yml, and restart Kong manually. The platform handles this automatically.

**Why this priority**: Reduces operational friction. Today every project requires a manual per-project SSH+edit+restart sequence before `get_logs` works. With many projects, this is a significant burden. Medium-priority because it's a quality-of-life improvement rather than a safety fix.

**Independent Test**: Provision a new project, call `get_logs` via the MCP roundtrip script — must return 200 or 503 (analytics unreachable) rather than 404 or 502 (Kong route missing).

**Acceptance Scenarios**:

1. **Given** a newly provisioned project, **When** `get_logs` is called, **Then** the request reaches the analytics container (200) or returns 503 if analytics is unreachable — never a Kong 404 for missing route.
2. **Given** an existing project that has the analytics block commented out in its kong.yml, **When** the platform runs its patching routine, **Then** the block is uncommented and the project's Kong is restarted.
3. **Given** a project that already has the analytics block uncommented, **When** the patching routine runs again, **Then** it is a no-op (idempotent — no unnecessary Kong restart).
4. **Given** Kong restart fails for a specific project (e.g., container not running), **When** the patch job encounters the error, **Then** it logs the error and continues to patch remaining projects rather than aborting.

---

### User Story 4 — OAuth Route-Level Test Coverage (Priority: P4)

A developer modifying the OAuth `authorize` or `token` endpoints has route-level tests that run in CI and catch regressions in per-error-path behavior, HTTP status codes, redirect shapes, and response envelope formats — without requiring a live VM or full OAuth dance.

**Why this priority**: Developer quality of life + regression protection. The routes work (proven by live E2E), but test-level coverage for error paths (wrong code_verifier, mismatched redirect_uri, token reuse) is absent. This is the last gap between the 014 spec's test requirements and what CI actually exercises.

**Independent Test**: Run `pnpm test` in `apps/api` — the two new test files must pass with ≥ 7 cases each.

**Acceptance Scenarios**:

1. **Given** a valid OAuth session for the authorize endpoint, **When** it receives a GET with a valid session cookie + `code_challenge_method=plain`, **Then** it returns 400 `invalid_request` (OAuth 2.1 hardening).
2. **Given** the authorize endpoint, **When** it receives a POST deny decision, **Then** it redirects to redirect_uri with `error=access_denied` and emits an audit event.
3. **Given** the token endpoint with a valid authorization code, **When** the same code is exchanged twice, **Then** the second exchange returns 400 `invalid_grant`.
4. **Given** the token endpoint with a valid refresh token, **When** the same refresh token is used twice (reuse attack), **Then** the second use returns 400 `invalid_grant` AND the entire grant is revoked.
5. **Given** the token endpoint, **When** a valid refresh token is exchanged, **Then** the response contains a new access token and new refresh token, and the old refresh token row is deleted.

---

### Edge Cases

- Existing projects (pre-feature-016) must not have their `statement_timeout` changed by anything in this feature.
- MCP tool filtering must be resilient to upstream `@supabase/mcp-server-supabase` version changes that rename deferred tools — the filter list should be a named constant, easy to update.
- Kong analytics patch must not restart Kong for projects that are paused/stopped (container not running); it should skip with a log entry.
- OAuth test mocks must follow the same pattern as `oauth-register.test.ts` — no live DB or Redis connections.
- Token reuse detection (refresh reuse → grant revocation) must be tested at the route level, not just the store level.

---

## Requirements

### Functional Requirements

- **FR-001**: New projects MUST be provisioned with a default `statement_timeout` of 8 seconds (8000ms) applied to the project's Postgres database.
- **FR-002**: The MCP `tools/list` response MUST NOT include any of the deferred tools: `create_project`, `get_cost`, `confirm_cost`, `get_advisors`, `get_security_advisors`, `get_performance_advisors`, `get_storage_config`, `update_storage_config`, or any branching tools.
- **FR-003**: The tool filtering MUST be applied post-construction (after the upstream MCP server is instantiated) so it works regardless of how the upstream server registers tools.
- **FR-004**: Newly provisioned projects MUST have the Kong analytics routing block enabled by default, with no manual operator steps required.
- **FR-005**: The platform MUST provide an automated mechanism to patch existing projects' Kong analytics configuration and restart their Kong containers.
- **FR-006**: The Kong analytics patching mechanism MUST be idempotent — running it multiple times against an already-patched project must be a no-op with no unnecessary restarts.
- **FR-007**: Route-level tests MUST be written for `GET /v1/oauth/authorize`, `POST /v1/oauth/authorize`, and `POST /v1/oauth/token` endpoints covering at minimum the 7 cases described for each in issue #53.
- **FR-008**: All existing in-scope MCP tools MUST continue to function correctly after the tool filtering is applied (no regression).
- **FR-009**: The OAuth route tests MUST mock all external dependencies (DB, Redis) — no live connections required to run them.

### Key Entities

- **Provision job**: The worker job that runs when a new project is created; FR-001 adds one SQL statement to its bootstrap sequence.
- **MCP server instance**: The per-session `@supabase/mcp-server-supabase` instance; FR-002/FR-003 wrap its `tools/list` handler.
- **Kong analytics block**: The `analytics-v1-api` route configuration block in each project's `kong.yml`; FR-004/FR-005/FR-006 manage its state.
- **Kong patch job**: New worker job that iterates per-project kong.yml files and applies the analytics uncomment + Kong restart; covers FR-005/FR-006.
- **OAuth authorize route**: `GET/POST /v1/oauth/authorize`; FR-007 adds `oauth-authorize.test.ts`.
- **OAuth token route**: `POST /v1/oauth/token`; FR-007 adds `oauth-token.test.ts`.

---

## Success Criteria

### Measurable Outcomes

- **SC-001**: All newly provisioned projects have `statement_timeout = 8s` without any operator action — verifiable by `SHOW statement_timeout` immediately after provisioning.
- **SC-002**: The MCP `tools/list` response contains ≤ 19 tools and zero phantom/deferred tools — verifiable by the existing `mcp-roundtrip.sh` E2E script.
- **SC-003**: `get_logs` works on any project (new or existing) without any SSH/manual intervention — verifiable by calling the endpoint and receiving 200 or 503 (not 404).
- **SC-004**: `pnpm test` in `apps/api` passes with ≥ 14 new test cases across the two new OAuth test files (7 per file) — verifiable by CI output.
- **SC-005**: The Kong analytics patch job completes with no unnecessary container restarts when run twice consecutively on the same set of projects.
- **SC-006**: Zero regressions in existing `tools/list` in-scope tools — all tools documented in `docs/changes/014-mcp-http-oauth.md` remain present and callable.

---

## Assumptions

- Issues #50–#53 are all follow-ups to feature 014 and are implemented on the same codebase without any intermediate breaking changes.
- The MCP SDK (`@modelcontextprotocol/sdk`) exposes a `setRequestHandler` API on the `Server` class that can override the built-in `ListToolsRequestSchema` handler; implementation will confirm the exact API before coding.
- The Kong analytics block in `infra/supabase-template/volumes/api/kong.yml` (lines ~310–318) uses the exact commented/uncommented pattern described in `docs/changes/014-mcp-http-oauth.md` — the patch logic targets this known pattern.
- Existing projects' `statement_timeout` is intentionally left unchanged by this feature; operators who want the 8s default on existing projects will use the `postgres-config` endpoint from feature 009.
- The Kong patch worker job runs once at worker boot (not on a recurring schedule) unless the operator triggers it manually; this is sufficient because once a project is patched, the setting persists.
- OAuth test files follow the identical mocking pattern as `apps/api/tests/unit/oauth-register.test.ts` (vi.hoisted + vi.mock + Fastify inject).
- Mobile/browser support is not relevant — this feature is entirely server-side and developer-tooling-focused.
