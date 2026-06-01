# Feature Specification: Auth-Config Behavioral Parity

**Feature Branch**: `019-auth-config-behavioral-parity`

**Created**: 2026-05-27

**Status**: Draft

**Input**: Issue #21 — close the gap between full **shape** parity and full **behavioral** parity in the auth-config Management API. Today, the endpoint accepts every field upstream accepts, validates it against upstream bounds, and persists it — but a subset of fields is stored-and-echoed without any wiring into the running per-instance GoTrue container. Operators cannot tell from the API response which fields actually take effect.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operators can see which auth settings actually work (Priority: P1)

An operator using the CLI or dashboard sets an auth-config field and reads it back. The response makes it unambiguous whether the value they set will change runtime behavior, is accepted-but-inert (stored only), or is explicitly not supported on this supastack deployment.

**Why this priority**: This is the single most user-visible defect of the current behavior. Without it, operators silently believe they have configured something (SAML, a webhook secret, a captcha key) when in fact the running auth container is unchanged. This destroys trust in the Management API. It can be shipped without any new GoTrue wiring — it is a pure transparency change layered on top of feature 009.

**Independent Test**: Mutate any stored-only field via `PATCH /v1/projects/<ref>/config/auth`, then `GET` the same path. The response surfaces a per-field status (`honored` / `stored-only` / `unsupported`) that matches reality. No GoTrue restart or template change required.

**Acceptance Scenarios**:

1. **Given** the operator PATCHes a field known to be wired into the GoTrue template (e.g. `jwt_exp`), **When** they GET the auth config, **Then** the response marks that field as `honored` and the new value is reflected.
2. **Given** the operator PATCHes a field that is accepted by the schema but not wired into the template (e.g. `hook_custom_access_token_uri`), **When** they GET the auth config, **Then** the response marks that field as `stored-only` with a short reason.
3. **Given** the operator PATCHes a field supastack has explicitly chosen never to support (e.g. a Cloud-internal field), **When** they GET the auth config, **Then** the response marks that field as `unsupported` with a short reason.
4. **Given** an unmodified `supabase` CLI client that ignores unknown response fields, **When** it consumes the GET response, **Then** existing CLI workflows continue to work unchanged.

---

### User Story 2 — Behavioral parity is provable, not assumed (Priority: P2)

For every field supastack claims to honor, an automated test mutates the field and asserts the runtime auth container actually behaves differently. Promoting a field from stored-only to honored requires its assertion to be added to the test suite as part of the same change.

**Why this priority**: Without this, the honored/stored-only/unsupported labels can drift from reality the next time the template or pinned GoTrue image changes. Operators get a false sense of safety. This is high-value but lower urgency than US1 because it protects future correctness rather than fixing today's silent failures.

**Independent Test**: Run `tests/cli-e2e/auth-config-behavioral-parity.sh` against a fresh test project. The script enumerates honored fields, mutates each, and asserts an observable runtime change (token TTL changes, OAuth provider becomes callable, redirect URI is accepted by `/auth/v1/authorize`, etc.). All assertions pass.

**Acceptance Scenarios**:

1. **Given** the auth-config status map labels a field as `honored`, **When** the behavioral parity test runs, **Then** the field has at least one assertion proving a runtime change.
2. **Given** the operator adds a new honored field without adding its assertion, **When** CI runs the coverage check, **Then** the check fails with a clear message naming the missing field.
3. **Given** an upstream OpenAPI snapshot refresh introduces new auth-config fields, **When** the contract test runs, **Then** any new field that is unclassified (neither honored nor stored-only nor unsupported) causes a build failure.

---

### User Story 3 — Selected stored-only fields are promoted to honored (Priority: P3)

For each currently stored-only field, an explicit per-field decision is recorded: promote (wire into the template), keep as stored-only with a documented reason, or mark as unsupported with a documented reason. Low-cost promotions (those needing only an env-var addition in the template) are shipped as part of this feature.

**Why this priority**: Strictly delivering on US1+US2 is enough to remove silent failure. Actually promoting fields is additional operator value but is the most expensive part of the work and varies wildly per field. By scoping promotion to the low-cost subset, the feature ships with a clear before/after delta without committing to multi-week infrastructure work (SAML keypair generation, hook dispatcher) that belongs in its own feature.

**Independent Test**: After promotion, the field appears as `honored` in the status map and has a passing assertion in the behavioral parity test. Stored-only fields that intentionally stayed stored-only have a one-line rationale in the operator documentation.

**Acceptance Scenarios**:

1. **Given** a field is promoted from stored-only to honored, **When** the operator PATCHes it and triggers the runtime check, **Then** the per-instance auth container picks up the new value within the same provisioning window as other auth-config edits.
2. **Given** a field is deliberately kept as stored-only, **When** the operator reads the operator runbook, **Then** they see a one-line explanation of why supastack does not wire it.

---

### Edge Cases

- A field is present in the upstream Zod schema but missing from supastack's status map (e.g. after an upstream snapshot refresh). The system must fail loudly rather than silently default to `stored-only`.
- A field's runtime check requires a container restart (typical for env-var-driven settings). The behavioral parity test must wait for the per-instance auth container's healthcheck, not merely for the PATCH response.
- A field is wired into the template but the pinned GoTrue image does not yet support it. The status map must reflect the runtime truth (`stored-only`), not the template intent.
- An operator PATCHes a field marked `unsupported`. The system must still accept and persist it (to preserve CLI compatibility) but the response must clearly indicate it has no effect.
- The supastack extension surface on the GET response must not collide with any future upstream field name. The extension is namespaced so unmodified upstream clients ignore it.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The auth-config GET response MUST surface a per-field status indicator that classifies each field as `honored`, `stored-only`, or `unsupported`.
- **FR-002**: The per-field status indicator MUST be exposed under a supastack-namespaced extension key in the response (so unmodified upstream clients ignore it).
- **FR-003**: PATCH MUST continue to accept every field present in the upstream `UpdateAuthConfigBody` shape, including `stored-only` and `unsupported` fields, to preserve CLI compatibility (feature 009 Q4 clarification stands).
- **FR-004**: For fields classified as `stored-only` or `unsupported`, the GET response MUST include a short, human-readable reason (e.g. "no SAML keypair infrastructure", "requires hook dispatcher not shipped").
- **FR-005**: The classification of every field in the upstream schema MUST be enumerable from a single source of truth in the codebase (a status map). Drift from the upstream snapshot MUST be caught by a contract test, not by runtime behavior.
- **FR-006**: For every field classified as `honored`, the behavioral parity test suite MUST contain at least one assertion proving a runtime change after a PATCH. The CI suite MUST fail when an honored field has no corresponding assertion.
- **FR-007**: The behavioral parity test MUST wait for the per-instance auth container's healthcheck to clear after a PATCH before asserting runtime behavior.
- **FR-008**: For each field currently in the stored-only bucket, a per-field disposition decision MUST be recorded (promote / keep stored-only / mark unsupported), each with a documented rationale visible in the operator runbook.
- **FR-009**: Low-cost promotions (fields needing only an additional env-var mapping in the per-instance template) MUST be shipped as part of this feature. High-cost promotions (those requiring new infrastructure such as SAML metadata endpoints or a hook dispatcher) MUST be deferred to dedicated features and explicitly listed in the runbook.
- **FR-010**: An upstream OpenAPI snapshot refresh that introduces a new auth-config field MUST cause a build-time failure if the field is not classified in the status map, preventing silent regressions to the pre-feature state.
- **FR-011**: The operator-facing documentation MUST include a table mapping every auth-config field to its current classification and (for non-honored fields) the reason.

### Key Entities

- **Auth-config field**: A single key in upstream's `UpdateAuthConfigBody` shape. Has a current value (from the per-instance row) and a classification (`honored` / `stored-only` / `unsupported`) plus an optional reason string.
- **Status map**: Code-level source of truth that classifies every auth-config field. Validated against the upstream OpenAPI snapshot at build time.
- **Behavioral assertion**: A test case that mutates a single honored field and verifies the per-instance auth container's runtime behavior reflects the new value.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After PATCHing any auth-config field, an operator can determine within a single GET round-trip whether the field is honored, stored-only, or unsupported. No external documentation lookup or container introspection is required.
- **SC-002**: 100% of fields in the current upstream auth-config schema are classified in the status map. Zero unclassified fields are present at merge time, enforced by a contract test.
- **SC-003**: 100% of fields classified as `honored` have at least one passing behavioral assertion in the test suite at merge time, enforced by a coverage check.
- **SC-004**: An unmodified `supabase` CLI (current pinned version) executing read/write workflows against the auth-config endpoint continues to succeed without modification — no regressions are introduced by the response shape change.
- **SC-005**: The number of fields classified as `honored` after this feature ships is strictly greater than the number classified as `honored` before this feature ships, by at least the count of low-cost promotions identified in the per-field disposition exercise.
- **SC-006**: An upstream OpenAPI snapshot refresh that adds a new auth-config field surfaces as a build-time failure within the first CI run that uses the refreshed snapshot.

## Assumptions

- Upstream `UpdateAuthConfigBody` remains the canonical shape for the auth-config endpoint; the contract continues to be sourced from `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json` or its successor snapshot.
- The honored/stored-only/unsupported labels are stable enough to be expressed as a small enum. No multi-state ("partially honored") classification is required; partially honored fields are treated as `stored-only` until fully wired.
- High-cost promotions (SAML, webhook dispatcher, MFA flags requiring a newer GoTrue image) are out of scope for this feature and are tracked separately. This feature only ships low-cost promotions plus the transparency layer.
- The unmodified upstream `supabase` CLI ignores unknown top-level keys in the GET response, allowing the per-field status indicator to be added without bumping any compat shim.
- The existing per-instance provisioning flow (feature 009) already restarts the per-instance auth container on auth-config PATCH; this feature does not change that lifecycle.
- The behavioral parity test runs against a live test project on the dev VM (consistent with other `tests/cli-e2e/*.sh` scripts) and is not expected to be a pure-unit test.

## Dependencies

- Feature 009 (`specs/009-runtime-config-tunables/`) — full shape parity on auth-config PATCH/GET; the data model and route already exist.
- The upstream OpenAPI snapshot used by feature 009 — used as the contract source for the status-map coverage check.
- The per-instance compose template at `infra/supabase-template/` — the destination for any low-cost promotions that require new `GOTRUE_*` env-var mappings.
- The CLI e2e test harness conventions in `tests/cli-e2e/` — used for the behavioral parity script.

## Out of Scope

- SAML SSO support (requires keypair generation, metadata endpoint, GoTrue SAML flags) — tracked separately.
- Auth webhook / "hook_*" support (requires a hook dispatcher service supastack does not ship) — tracked separately.
- MFA fields requiring a newer GoTrue image than the currently pinned per-instance image — tracked separately, gated on an image bump.
- Any change to PATCH validation behavior (continues to accept the full upstream shape).
- Any change to the dashboard UI for auth-config (this feature is API-surface-only; dashboard adoption of the new status indicator is a follow-up).
