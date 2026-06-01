# Feature Specification: Secret Reveal — No-Password UI Masking

**Feature Branch**: `081-secret-reveal-no-password`

**Created**: 2026-05-25

**Status**: Draft

**Input**: Remove password gate from secret reveal across JWT keys, API keys, and OAuth provider forms. Values are fetched from the API and shown masked in the UI; clicking "Reveal" shows the value without any password prompt.

---

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Reveal JWT Secret without password (Priority: P1)

An admin navigates to the JWT Keys page. The JWT secret is displayed as masked dots. When the admin clicks "Reveal", the actual value appears immediately (no password dialog). The "Reveal" button becomes a "Copy" button. The admin can then copy the value to use in an external tool.

**Why this priority**: The password gate was the primary friction point on this page. Removing it unblocks the most common admin workflow (inspecting the JWT secret).

**Independent Test**: Navigate to `/dashboard/project/:ref/jwt-keys`, see masked value, click Reveal, confirm actual value is shown and a Copy button replaces the Reveal button.

**Acceptance Scenarios**:

1. **Given** an admin is on the JWT Keys page, **When** the page loads, **Then** the JWT secret is shown as masked characters (no value visible) and a "Reveal" button is present.
2. **Given** the JWT secret is masked, **When** the admin clicks "Reveal", **Then** a loading indicator appears briefly, the actual JWT secret value is shown, and the "Reveal" button is replaced by a "Copy" button.
3. **Given** the secret has been revealed, **When** the admin clicks "Copy", **Then** the JWT secret is copied to the clipboard.
4. **Given** the secret has been revealed, **When** the admin navigates away and returns, **Then** the value is masked again (reveal is per-session, per-page-load).
5. **Given** the reveal API call fails, **When** the admin clicks "Reveal", **Then** an error state is shown and the "Reveal" button remains so the admin can retry.

---

### User Story 2 — Reveal API Keys (anon + service_role) without password (Priority: P1)

An admin navigates to the API Keys page. Both the `anon` key and `service_role` key are masked. A single "Reveal" click fetches both keys and shows them: anon always visible after reveal, service_role visible with a Copy button. No password dialog appears at any point.

**Why this priority**: API keys are accessed more frequently than JWT secrets; removing the password gate here has the highest daily-use impact.

**Independent Test**: Navigate to `/dashboard/project/:ref/api-keys`, click Reveal on either key, confirm both keys become visible and Copy buttons appear.

**Acceptance Scenarios**:

1. **Given** an admin is on the API Keys page, **When** the page loads, **Then** both `anon` and `service_role` keys show as masked dots with a "Reveal" button.
2. **Given** both keys are masked, **When** the admin clicks "Reveal" on either key, **Then** both keys are fetched together and shown: `anon` displayed in full, `service_role` displayed in full with a Copy button.
3. **Given** the keys have been revealed, **When** the admin refreshes the page, **Then** keys are masked again.

---

### User Story 3 — Reveal OAuth provider client secret (Priority: P2)

An admin opens an OAuth provider drawer (e.g., GitHub, Google, Discord). A saved client secret is shown as a masked input field with a "Reveal" button. Clicking "Reveal" fetches and populates the input with the plaintext secret. The "Reveal" button disappears after the value is shown. The admin can then see or update the secret and save.

**Why this priority**: This surface is used less frequently but is the only way for admins to verify or recover a saved OAuth secret without re-entering it.

**Independent Test**: Open any OAuth provider drawer where a secret has already been saved, click Reveal, confirm the secret value appears in the input as plain text and the Reveal button disappears.

**Acceptance Scenarios**:

1. **Given** an admin opens an OAuth provider drawer with a saved secret, **When** the drawer opens, **Then** the secret field shows as a masked (password-type) input with a "Reveal" button and a placeholder indicating a value is saved.
2. **Given** the secret field is masked, **When** the admin clicks "Reveal", **Then** a brief loading state is shown, the actual secret value populates the input as plain text, and the "Reveal" button disappears.
3. **Given** the secret has been revealed, **When** the admin edits the input and saves, **Then** the updated value is saved as the new secret.
4. **Given** an OAuth provider drawer where NO secret has ever been saved, **When** the drawer opens, **Then** no "Reveal" button is shown (nothing to reveal; the placeholder prompts "paste secret here").
5. **Given** the reveal API call fails (network error), **When** the admin clicks "Reveal", **Then** the button remains visible so the admin can retry; the input stays masked.

---

### Edge Cases

- What happens when the project is paused/stopped and credentials are requested? The reveal should still work for JWT/API keys (stored encrypted in the control plane), but may fail for OAuth secrets if the project snapshot is unavailable.
- What happens if two admins reveal credentials simultaneously? Each request is independent; audit log records both reveals separately.
- What if the admin has insufficient permissions (member role)? The Reveal button should not be shown to non-admin users.
- What if the secret field in the auth config response is empty/null (no secret saved)? No "Reveal" button is shown for that field.

---

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST allow admin users to reveal JWT secret, anon key, and service_role key by clicking a "Reveal" button — with no password dialog or re-authentication required.
- **FR-002**: The system MUST mask all project credentials (JWT secret, API keys, OAuth client secrets) by default when a page or drawer is loaded.
- **FR-003**: On the JWT Keys and API Keys pages, clicking "Reveal" MUST trigger an API call to fetch credential values; a loading indicator MUST be shown while the request is in-flight.
- **FR-004**: After revealing on JWT Keys and API Keys pages, the "Reveal" button MUST be replaced by a "Copy" button that copies the revealed value to the clipboard.
- **FR-005**: Reveal on JWT Keys and API Keys MUST be one-way per page session — once shown, the value stays visible until the page is reloaded; there is no re-mask toggle.
- **FR-006**: On OAuth provider drawers, clicking "Reveal" MUST fetch and display the saved client secret as plain text in the input field; the "Reveal" button MUST disappear after the value is shown.
- **FR-007**: The "Reveal" button on OAuth provider drawers MUST only be shown when a secret has previously been saved for that provider (i.e., the API indicates a value exists).
- **FR-008**: Every credential reveal action (JWT/API keys AND OAuth secrets) MUST produce an audit log entry recording which user revealed which credential and when.
- **FR-009**: The "Reveal" button MUST NOT be visible to users without admin permissions.
- **FR-010**: The system MUST surface an actionable error state if a reveal API call fails, and MUST allow the user to retry without reloading the page.

### Key Entities

- **Credential Reveal Event**: An audit record capturing `actor_user_id`, `action = 'secret.reveal'`, `target_kind = 'instance'`, `target_id = ref`, and timestamp.
- **Project Credentials**: JWT secret, anon key, service_role key, postgres password — stored encrypted in the control plane; revealed on demand via an authenticated API call.
- **Auth Config Snapshot**: Per-project encrypted snapshot of GoTrue configuration, including OAuth provider client secrets; revealed via a separate authenticated endpoint.

---

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An admin can go from "masked credentials" to "value copied to clipboard" in 3 or fewer clicks, with no password prompt at any point.
- **SC-002**: The reveal loading state resolves within 2 seconds under normal network conditions (no spinner left spinning indefinitely).
- **SC-003**: Every reveal interaction (across all three surfaces) produces a corresponding entry in the audit log — 100% of reveals are recorded.
- **SC-004**: The "Reveal" button is absent for all non-admin users across all three surfaces — 0 cases where a member-role user sees a functional Reveal button.
- **SC-005**: OAuth provider drawers correctly suppress the "Reveal" button when no secret is saved — 0 cases of a Reveal button appearing for a provider with no saved secret.

---

## Assumptions

- Reveal is admin-only; member-role users do not see the Reveal button on any surface.
- Reveal is one-way per page/drawer session for JWT/API keys (no re-mask toggle); for OAuth drawers, the revealed value populates the editable input and the button disappears.
- The audit log continues to record reveal events even after the password gate is removed — this is a deliberate policy choice (visibility without friction).
- The existing `instance.reveal-credentials` RBAC action covers JWT/API key reveal; the existing `auth_config.read` RBAC action covers OAuth secret reveal via the new endpoint.
- `RevealDialog.tsx` and the `CredentialRevealRequest` schema are left in place after this change (no active callers); cleanup is deferred to a separate task.
- OAuth reveal is only possible when the auth config snapshot exists (i.e., the project has been configured at least once). A new project with default config has no stored OAuth secrets to reveal.
