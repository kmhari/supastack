# Feature Specification: Auth Hooks (hook_*) — pg-functions:// + HTTPS Dispatcher

**Feature Branch**: `082-auth-hooks`

**Created**: 2026-05-25

**Status**: Draft

**Input**: User description: "auth-config: auth hooks (hook_*) — pg-functions:// + HTTPS dispatcher (issue #64, split off from #21)"

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Enable Postgres Function Hook (Priority: P1)

An operator wants to customise how JWTs are issued for their project by writing a plpgsql function in their project database. They enable the `custom_access_token` hook, point it at `pg-functions://postgres/public/my_custom_jwt`, save, and their function is invoked by the auth service on every sign-in, adding extra claims to the issued token.

**Why this priority**: `pg-functions://` is the low-cost, no-external-service path. It unblocks the most common hook use-cases (custom JWT claims, sign-up validation, MFA policy) and is the recommended path in upstream docs.

**Independent Test**: Enable the `custom_access_token` hook with a `pg-functions://` URI in the dashboard, sign in as a test user, inspect the issued JWT — the custom claim added by the plpgsql function must be present.

**Acceptance Scenarios**:

1. **Given** a project with a plpgsql function `public.custom_jwt(event jsonb)` that adds `"custom_claim": true` to the response, **When** the operator sets `hook_custom_access_token_uri = "pg-functions://postgres/public/custom_jwt"` and `hook_custom_access_token_enabled = true`, **Then** every JWT issued by the auth service for that project includes `"custom_claim": true`.
2. **Given** a saved `pg-functions://` hook, **When** the operator disables it (`_enabled = false`), **Then** the auth service stops invoking the function and issues plain JWTs.
3. **Given** a valid `pg-functions://` URI, **When** the hook config is saved, **Then** the platform classifies the field as `honored` and stores it in the container env.

---

### User Story 2 — Reject HTTPS Hook URIs with Clear Error (Priority: P2)

An operator tries to point a hook at an HTTPS endpoint (`https://my-service.example.com/hook`). The platform rejects the URI with a 400 error explaining that HTTPS dispatching is not yet available and references issue #64.

**Why this priority**: Preventing silent misconfiguration is critical for operator trust. A clear error message avoids operators thinking the hook is live when it is not.

**Independent Test**: Submit a PATCH to the auth-config endpoint with `hook_send_email_uri = "https://..."` — verify a 400 response with a message referencing the deferred HTTPS phase.

**Acceptance Scenarios**:

1. **Given** an operator submits `hook_send_email_uri = "https://my-sender.example.com"`, **When** the save request is processed, **Then** the platform returns HTTP 400 with a body such as `"HTTPS hook URIs are not yet supported. See issue #64."`.
2. **Given** the same request, **When** the error is returned, **Then** no changes are written to the container env, and the existing hook config is preserved.
3. **Given** an operator submits a URI with any unsupported scheme (e.g., `grpc://`, `amqp://`), **When** the save request is processed, **Then** the platform returns HTTP 400 indicating only `pg-functions://` is accepted.

---

### User Story 3 — View and Edit All Hook Fields in Dashboard (Priority: P3)

An operator visits the Auth Hooks section of the dashboard. They see all seven hook types, each with an enabled toggle, a URI input, and a secrets field. They can turn hooks on/off, set URIs, and save per-hook — with a restart toast appearing while the container picks up the new config.

**Why this priority**: Dashboard parity with upstream Supabase Cloud is necessary for operator usability. Hook config should not require direct API calls.

**Independent Test**: Open the Auth → Hooks page (or equivalent section) for any project, enable and save one hook with a valid `pg-functions://` URI, verify the restart toast appears and the field is persisted after reload.

**Acceptance Scenarios**:

1. **Given** the Auth configuration page is open, **When** an operator navigates to the Hooks section, **Then** all seven hook types are listed, each with an `enabled` toggle, a URI field, and a secrets field.
2. **Given** the operator sets a valid `pg-functions://` URI and clicks Save, **When** the save completes, **Then** a restart toast appears, the container restarts, and the URI is visible in the field after the page refreshes.
3. **Given** the hook secrets field, **When** the operator enters a secret value, **Then** the value is stored securely and the field displays a masked placeholder on reload (no plaintext secret in the page HTML).

---

### Edge Cases

- What happens when a plpgsql function referenced by a `pg-functions://` URI does not exist in the project DB? The auth service logs an error per the upstream GoTrue behaviour; the dashboard does not pre-validate function existence.
- What happens when the URI field is cleared (empty string) while `_enabled = true`? The platform rejects with a 400: a URI is required when the hook is enabled.
- What happens when the operator enters a malformed `pg-functions://` URI (e.g., wrong number of path segments)? The platform rejects with a 400 and a format hint.
- What happens if the container fails to restart after a hook config change? The restart toast exposes a Retry action; the auth-config fields remain in the stored state and are attempted again on Retry.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST accept `pg-functions://` URIs for all 21 hook fields (`hook_*_uri`) and write them to the per-project container env so GoTrue dispatches them natively.
- **FR-002**: The platform MUST classify all 21 hook fields (`hook_*_enabled`, `hook_*_uri`, `hook_*_secrets`) as `honored` when the URI scheme is `pg-functions://`, and reflect this in the `_supastack.fieldStatus` extension of `GET /v1/projects/:ref/config/auth`.
- **FR-003**: The platform MUST classify `hook_*_uri` fields as `stored_only` (with reference to issue #64) when the URI scheme is `https://`, returning HTTP 400 with a human-readable explanation when the operator attempts to save an HTTPS URI.
- **FR-004**: The platform MUST reject any hook URI scheme other than `pg-functions://` with HTTP 400, clearly stating which schemes are accepted.
- **FR-005**: The platform MUST require a non-empty URI when `hook_*_enabled = true`; saving `enabled = true` with an empty or absent URI MUST return HTTP 400.
- **FR-006**: The dashboard MUST display all seven hook types in the Auth configuration area, each with an enabled toggle, URI text input, and secrets field.
- **FR-007**: The dashboard MUST show a restart toast after saving hook configuration changes, consistent with the pattern established in feature 020 (auth providers).
- **FR-008**: Hook secrets MUST be stored securely and MUST NOT be returned in plaintext in any `GET` auth-config response.
- **FR-009**: Phase 1 MUST NOT require any new supastack-hosted microservice; GoTrue's native `pg-functions://` dispatch is sufficient.

### Key Entities

- **Hook configuration**: Per-project, per-hook-type group of three fields — `_enabled` (boolean), `_uri` (string), `_secrets` (optional string). Seven hook types × 3 fields = 21 fields total.
- **Hook type**: One of `custom_access_token`, `send_email`, `send_sms`, `mfa_verification_attempt`, `password_verification_attempt`, `before_user_created`, `after_user_created`.
- **Field status**: Classification of each auth-config field as `honored` (written to container env + takes effect), `stored_only` (persisted but not propagated, with reason), or `unsupported`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A `pg-functions://` hook URI saved by an operator takes effect within the time it takes the auth container to restart (≤ 60 seconds under normal load), with no manual operator intervention beyond clicking Save.
- **SC-002**: 100% of the 21 hook fields appear in `GET /v1/projects/:ref/config/auth` with a correct `_supastack.fieldStatus` entry — `honored` for `pg-functions://`-capable fields, `stored_only` for HTTPS-only fields.
- **SC-003**: Attempting to save an HTTPS hook URI returns a 400 response in under 500 ms with a message that an operator can act on (no cryptic error codes).
- **SC-004**: The `custom_access_token` hook adds a claim to issued JWTs within one auth-container restart cycle — verifiable end-to-end with a plpgsql function and a sign-in request.
- **SC-005**: No new supastack service is required for Phase 1 — the feature ships as configuration wiring only.

## Assumptions

- GoTrue's native `pg-functions://` dispatch is available in the GoTrue version pinned in the supastack template (no GoTrue version bump required for Phase 1).
- The `env-field-mapper.ts` pattern from feature 020 is the canonical mechanism for promoting auth-config fields to container env; this feature follows the same pattern.
- Operators are responsible for creating the plpgsql function in their project database; the platform does not scaffold or validate function existence at save time.
- `hook_*_secrets` are stored as opaque strings (not vault-managed) in Phase 1; vault migration is tracked separately in issue #70.
- Phase 2 (HTTPS dispatcher with egress allow-list, secret rotation endpoint, operator runbook) is explicitly out of scope for this feature and will be a follow-up.
- The dashboard hook UI will be added to the existing Auth configuration area (same sidebar group as Auth Providers from feature 020), not as a separate page requiring `EXPECTED_PAGES` registry entry updates.
- RBAC: configuring hooks is an admin-only action, consistent with all other auth-config write operations.
