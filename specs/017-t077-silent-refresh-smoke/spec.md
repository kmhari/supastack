# Feature Specification: T077 — Silent OAuth Token Refresh Validation

**Feature Branch**: `017-t077-silent-refresh-smoke`

**Created**: 2026-05-27

**Status**: Draft

**Input**: User description: "lets explore T077"

> **Context**: T077 is one of three deferred post-deploy validations from feature 014 (hosted MCP + OAuth 2.1), tracked in issue #54. It validates **SC-003** from spec 014: *"silent refresh confirmed live"* — that after an MCP client's access token expires (current TTL = 1 hour), the next `tools/call` succeeds **without any browser intervention** because the refresh token transparently mints a new access token. The feature 014 acceptance offers two paths: a one-shot live confirmation, OR adding it as a recurring nightly CI smoke. This spec explores both.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator confirms silent refresh works on the live VM (Priority: P1)

As the operator who shipped feature 014, I want a repeatable procedure that proves an MCP client which has been idle longer than the access token's TTL can issue its next tool call without prompting the LLM user to re-authorize in a browser. Without this proof, SC-003 remains theoretical: the refresh endpoint is unit-tested and the `oauth-dance.sh` E2E exercises `grant_type=refresh_token` immediately after token issuance, but neither validates the wall-clock case where the access token has actually expired in the wild.

**Why this priority**: This is the minimum that closes T077 against the issue's "OR" acceptance. It produces evidence that the contract delivered to MCP-client users (Claude Code, Cursor, Windsurf) actually holds in production.

**Independent Test**: Run the procedure once against the live `supaviser.dev` deployment. The validation passes when, after the access token's TTL has fully elapsed, calling a protected endpoint with the originally-issued access token returns 401, the stored refresh token successfully exchanges for a fresh access token, and the same endpoint then succeeds — all without any human input after the initial authorization.

**Acceptance Scenarios**:

1. **Given** an MCP client has completed the full OAuth dance and holds an access token + refresh token, **When** at least the access-token TTL has elapsed since issuance, **Then** the original access token is rejected by a protected endpoint (proving expiry is real, not skipped).
2. **Given** the same client now holds an expired access token and a still-valid refresh token, **When** it exchanges the refresh token at the token endpoint, **Then** a new access token + rotated refresh token are returned without re-authorization, and the new access token successfully calls a protected endpoint.
3. **Given** silent refresh succeeded, **When** the procedure's outcome is recorded, **Then** the recorded evidence references the live deployment, the actual elapsed time between issuance and the post-expiry call, and the HTTP status codes observed.

---

### User Story 2 — Continuous assurance via recurring smoke (Priority: P2)

As the operator, I want this validation to run on a recurring schedule and surface failures somewhere I will notice them, so that a future regression in refresh-token rotation, JWT signing, the revocation list, or upstream gotrue behavior does not silently break every MCP client until users complain.

**Why this priority**: One-shot live confirmation closes the immediate ticket but offers no protection against drift. SC-003 is a contract that holds over time, not just the day we shipped. Continuous validation converts a frozen attestation into a living one.

**Independent Test**: After the smoke is in place, intentionally break refresh-token rotation in a temporary branch (e.g., short-circuit the reuse-detection store), let the smoke run, and confirm the failure is surfaced via the configured channel within one scheduled cycle.

**Acceptance Scenarios**:

1. **Given** the smoke is scheduled, **When** a scheduled run completes successfully against the live deployment, **Then** the run is observable (logs, dashboard, or CI history) and produces no alert.
2. **Given** the smoke is scheduled, **When** a scheduled run fails (refresh rejected, expiry not honored, network blocked, etc.), **Then** the failure is surfaced through a channel the operator monitors within the scheduled cycle's frequency, with enough context to triage (endpoint, HTTP status, response body, elapsed time).
3. **Given** the smoke runs repeatedly, **When** the operator audits 30 days of runs, **Then** the audit shows ≥ 95% pass rate with all failures triaged (real regression vs flake) and no silent gaps in scheduled execution.

---

### Edge Cases

- **Refresh token revoked between issuance and use**: The OAuth server enforces RFC 6749 §10.4 reuse-detection. If the smoke's refresh token is somehow used twice (e.g., a previous run aborted mid-rotation), the second use must be rejected and the entire token family invalidated. The smoke must distinguish "expected rotation succeeded" from "reuse-detection fired" and treat the latter as either a recoverable cleanup or a hard failure depending on cause.
- **Wall-clock drift on the runner vs the API server**: If the runner's clock is skewed by minutes, "wait TTL + buffer" may be wrong. The procedure must not depend on runner-clock-only timing; it should also observe the actual `expires_in` returned by the token endpoint or independently confirm expiry via a server-side check (calling a protected endpoint and seeing 401).
- **Maintenance window during the wait**: The api or db may restart during the 1-hour wait window. The smoke should either be resilient to a single transient failure during the wait, or distinguish "infra blip" from "refresh contract broken" in its pass/fail decision.
- **Token-family pollution across runs**: Each run issues a fresh authorization (new DCR client or reused fixture client + new auth code), then leaves behind tokens. Long-running cumulative runs must not exhaust storage, hit per-PAT rate limits, or pollute the revocation list with thousands of stale entries.
- **Test fixture session expiry**: The procedure needs a valid dashboard session cookie or equivalent to complete the initial authorization. If the fixture credential expires (PAT rotated, password changed), the smoke fails at setup time before reaching the actual refresh assertion — failure messaging must make this distinction obvious so operators don't chase a fake regression.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The validation MUST perform a complete OAuth 2.1 authorization flow against the live deployment, capturing an access token and a refresh token issued by the production token endpoint.
- **FR-002**: The validation MUST wait long enough that the captured access token is genuinely expired according to the server's clock, not merely assumed expired by the runner.
- **FR-003**: The validation MUST verify expiry by observing that a protected endpoint rejects the original access token after the wait (i.e., not skip the negative-path check).
- **FR-004**: The validation MUST exchange the refresh token at the token endpoint and assert that a new access token + new refresh token are returned, and that the new access token successfully calls the same protected endpoint that just rejected the old one.
- **FR-005**: The validation MUST complete end-to-end without any browser interaction, manual prompt, or out-of-band approval after initial setup — mirroring how an MCP client behaves in the field.
- **FR-006**: The validation MUST produce a structured outcome record (pass/fail, elapsed time, HTTP statuses observed, response bodies on failure) that an operator can audit without re-running.
- **FR-007**: ~~Recurring smoke failure surface~~ — out of scope (Q1 = one-shot only). Deferred to a future feature if continuous assurance is prioritized.
- **FR-008**: The validation MUST clean up after itself: any DCR client, tokens, or test fixtures created during the run must either be reused across runs (stable fixture) or deleted/expired so cumulative storage and rate-limit pressure stay bounded.
- **FR-009**: The validation's failure messages MUST distinguish *real* refresh-contract regressions from *environmental* failures (network blocked, fixture credential expired, api/db restart during the wait window) so triage is unambiguous.
- **FR-010**: The validation's source MUST live alongside existing live-VM E2E tests so a future maintainer encounters it in the same place as related scripts.

### Key Entities

- **OAuth client fixture**: The DCR-registered client used by the validation to drive the flow. May be a stable per-environment fixture (registered once, reused) or freshly registered per run; either choice has cleanup implications.
- **Token pair under test**: The `(access_token, refresh_token)` issued at the start of each run. The access token's lifetime defines the minimum wait; the refresh token's lifetime defines the maximum runs-per-pair.
- **Validation outcome record**: Per-run artifact (log line, CI job result, dashboard row) capturing pass/fail, timestamps, observed statuses, and enough context to triage without re-running.
- **Failure surface**: The channel through which a failed run reaches operator attention. Open question (see FR-007).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A documented one-shot run of the validation against the live production deployment exists, with a captured outcome record showing the access token was rejected post-TTL and a fresh access token successfully called a protected endpoint after refresh, all without browser intervention.
- **SC-002**: The total wall-clock time for a single validation run is bounded and predictable (current TTL is 1 hour, so a single run completes within ~70 minutes including setup and verification); operators can predict when results will be available.
- **SC-003**: When run as a recurring smoke, ≥ 95% of scheduled runs over any rolling 30-day window pass on the first attempt, with all failures triaged to a documented cause (real regression, infra blip, fixture-expiry) within one business day.
- **SC-004**: A deliberate regression in refresh-token rotation introduced in a test branch is detected by the smoke within one scheduled cycle and surfaces to the operator through the configured failure channel.
- **SC-005**: Cumulative storage and rate-limit pressure attributable to the smoke remains bounded: after 90 days of continuous operation, no more than a small constant number of stale DCR clients, tokens, or revocation-list entries are attributable to the smoke.
- **SC-006**: Issue #54's T077 acceptance checkbox is closeable: either a single live confirmation is recorded *or* a recurring smoke is operational, with the chosen path explicitly documented.

## Assumptions

- **Scope of "validation" depends on the path chosen**: This spec covers both User Story 1 (one-shot live confirmation, sufficient to close T077) and User Story 2 (continuous smoke, the issue's "suggested" path). The clarification below resolves which path is in scope for the first implementation.
- **The current access-token TTL is 1 hour** as defined in `apps/api/src/routes/oauth/token.ts` (`ACCESS_TOKEN_TTL_SEC = 3600`). The validation does not need to lower this TTL for the test — waiting the full hour is the truest validation of the production contract and is acceptable for both one-shot and scheduled runs.
- **The validation reuses the existing `tests/cli-e2e/oauth-dance.sh` flow** to obtain the initial token pair, then extends it with the wait + post-expiry assertions. Building entirely new authorization infrastructure for the smoke is out of scope.
- **The live deployment at `supaviser.dev` is the target environment** for both one-shot and scheduled runs. Running this against a local or ephemeral stack does not validate the SC-003 contract as deployed.
- **The dashboard session cookie or PAT used as a fixture credential is provisioned out-of-band** (operator-managed secret in CI or local environment). This spec does not cover how that fixture is rotated.
- **The MCP server itself is not exercised** by this validation. T077 specifically validates the OAuth refresh contract; full MCP-client roundtrip after refresh is covered by other smokes (`mcp-roundtrip.sh`). Including MCP in this spec would expand scope beyond SC-003.

## Decisions

**Scope (Q1)**: One-shot live confirmation only. User Story 2 (recurring smoke) is deferred. This closes issue #54 T077 as soon as the one-shot run is executed and evidenced. No failure-surface integration, no scheduled job, no cleanup-discipline requirements. FR-007 (scheduled failure surface) is removed from scope.
