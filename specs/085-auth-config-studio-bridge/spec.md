# Feature Specification: Auth Config (GoTrue settings per project) — Studio parity

**Feature Branch**: `085-auth-config-studio-bridge`

**Created**: 2026-06-03

**Status**: Draft

**Input**: User description: "lets create or fix 'Auth Config (GoTrue settings per project)' apis from API-FULL-COMPARISON.md"

## Context

The dashboard exposes per-project authentication settings — OAuth providers, email/SMTP, sessions, security, MFA policy, and auth hooks — under **Authentication → Providers / settings**. These pages read and write a project's auth configuration through four endpoints (the "Auth Config (GoTrue settings per project)" section of `scripts/studio-mock-api/API-FULL-COMPARISON.md`):

| Endpoint | Today | Problem |
|---|---|---|
| `GET /platform/auth/:ref/config` | ⚠️ broken | Returns the config in one field-name convention; the dashboard reads a different one, so saved settings display as empty/default. |
| `PATCH /platform/auth/:ref/config` | ⚠️ broken | The dashboard's payload is rejected ("unknown field"), surfaced to the operator as a generic **"internal error"**. |
| `GET /platform/auth/:ref/config/hooks` | ⚠️ not implemented | The auth-hooks page has no data source. |
| `PATCH /platform/auth/:ref/config/hooks` | ⚠️ not implemented | The auth-hooks page cannot save. |

Root cause: the dashboard speaks one field-name convention (UPPERCASE provider/setting names, e.g. `EXTERNAL_GITHUB_ENABLED`) while the platform's stored/validated convention is a different casing (lowercase, e.g. `external_github_enabled`). The two are the same names modulo case, but the validation layer rejects the mismatched casing outright, and the read path returns the un-translated shape. The separate command-line/automation path that uses the lowercase convention already works and must keep working.

Net effect: an operator cannot configure authentication for a project through the dashboard at all today.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Configure an OAuth provider from the dashboard (Priority: P1)

An operator opens **Authentication → Providers** for a project, enables a provider (e.g. GitHub), enters the client ID and secret, and saves. The change persists, the project's auth service applies it, and sign-in with that provider works — with no "internal error".

**Why this priority**: This is the headline failure the user reported. Without it, no project's authentication can be configured through the dashboard — the single most important auth admin task is completely blocked.

**Independent Test**: Enable a provider via the dashboard (or an equivalent dashboard-shaped request), confirm a success response, then confirm the project's auth service reports that provider as enabled. Delivers a working "turn on a login provider" flow on its own.

**Acceptance Scenarios**:

1. **Given** a running project and an operator on its Providers page, **When** they enable GitHub with a client ID + secret and save, **Then** the save succeeds (no error) and the provider is active after the auth service applies the change.
2. **Given** an operator changes a non-OAuth auth setting (e.g. Site URL, email confirmation toggle, session timeout), **When** they save, **Then** the change is accepted and applied — the same way OAuth changes are.
3. **Given** the command-line / automation path that already configures auth settings in the lowercase convention, **When** this feature ships, **Then** that path continues to work unchanged (no regression).

---

### User Story 2 - See current auth settings accurately (Priority: P1)

When an operator opens any auth settings page, it shows the project's **current** configuration — which providers are on, the existing Site URL, redirect allow-list, SMTP, session settings, etc. — so they can review and edit rather than blind-overwrite.

**Why this priority**: Saving (US1) without correct display is dangerous — an operator who sees "everything disabled" when GitHub is actually enabled may wipe working config. Read parity is a co-requirement of write parity for a usable page.

**Independent Test**: Configure a few auth settings (by any working path), then load the dashboard auth page and confirm it reflects those exact values. Delivers an accurate, reviewable settings view.

**Acceptance Scenarios**:

1. **Given** a project with GitHub enabled and a Site URL set, **When** the operator opens the auth settings page, **Then** GitHub shows as enabled and the Site URL field shows the configured value.
2. **Given** a freshly created project with defaults, **When** the operator opens the page, **Then** the displayed values match the project's actual current defaults (not an unrelated/empty shape).

---

### User Story 3 - Clear, actionable error feedback (Priority: P2)

When an operator submits an invalid value (an unrecognized setting, or a value outside allowed bounds), they get a specific, human-readable message identifying the problem field — not an opaque "internal error".

**Why this priority**: Configuration mistakes are routine; masking every validation problem as a 500 makes the page undebuggable and erodes trust. Important, but secondary to the page working at all (US1/US2).

**Independent Test**: Submit a payload with a genuinely invalid field/value and confirm the response is a clear validation error naming the offending field, with an appropriate (non-server-error) status.

**Acceptance Scenarios**:

1. **Given** an operator submits an unknown/invalid auth setting, **When** they save, **Then** they see a validation message naming the field, and the status reflects a client input error (not a generic server error).
2. **Given** a valid dashboard payload, **When** they save, **Then** no validation error is shown and the change applies.

---

### User Story 4 - Manage auth hooks from the dashboard (Priority: P3)

An operator opens the **Auth Hooks** settings, views the project's current hook configuration (e.g. custom access token, MFA verification attempt, send SMS/email, before/after user created), enables one with its target + secret, and saves. The hooks page reflects current state and persists changes.

**Why this priority**: Auth hooks are an advanced, lower-frequency capability. The honoring of hook settings already exists in the platform; this story is about giving the dashboard's hooks page a working read/write surface. Valuable but not blocking basic auth setup.

**Independent Test**: View and set an auth hook through the dashboard hooks surface, confirm it persists and is reflected on reload, and that the platform applies it. Delivers a working auth-hooks admin page.

**Acceptance Scenarios**:

1. **Given** an operator on the Auth Hooks page, **When** they enable a hook with a valid target and save, **Then** the change persists and is shown on reload.
2. **Given** a project with no hooks configured, **When** the operator opens the page, **Then** it loads (no error) showing all hooks disabled.

---

### Edge Cases

- **Mixed-case / partial payloads**: the dashboard sends only the fields it changed (a partial update). Translation MUST preserve partial-update semantics — untouched settings are not reset.
- **Fields the platform stores but does not yet enforce**: a setting that is accepted-and-persisted but not actively honored must still round-trip on read (no data loss, no false rejection).
- **Unknown but dashboard-sent fields**: if a future dashboard version sends a name the platform doesn't recognize, the response MUST be a clear "unknown field: X" rather than a silent drop or a generic failure.
- **Secret-bearing fields** (client secrets, SMTP password, hook secrets): writes accept them; reads MUST NOT leak them in cleartext if the existing convention masks them — match the established secret-handling behavior for auth config.
- **Project not running**: configuration changes require the project's auth service to be running to apply; a paused/provisioning project MUST return a clear "not running" condition, not a generic error.
- **Apply window**: a successful save triggers the project's auth service to reload; the dashboard's existing "applying… / done" feedback must remain accurate during that window.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The system MUST accept a dashboard-shaped auth-config update (UPPERCASE provider/setting names) on `PATCH /platform/auth/:ref/config` and apply it to the project's auth service, returning success — for OAuth providers and for all other honored auth settings.
- **FR-002**: The system MUST return the project's current auth configuration on `GET /platform/auth/:ref/config` in the field-name convention the dashboard reads, so saved settings display correctly.
- **FR-003**: Read and write MUST round-trip: a value written via the dashboard MUST be returned by the dashboard read of the same project.
- **FR-004**: Translation MUST cover the full set of auth-config fields the dashboard's pages use (providers, email/SMTP, URLs, sessions, security, MFA policy, mailer templates, etc.) — not only OAuth.
- **FR-005**: The existing command-line / automation auth-config path (lowercase convention) MUST continue to work unchanged — no regression to its request shape, response shape, or validation.
- **FR-006**: Partial updates MUST be preserved — submitting a subset of fields MUST change only those fields and leave the rest untouched.
- **FR-007**: A genuinely invalid input (unknown field, or value outside allowed bounds) MUST produce a clear, field-identifying validation error with a client-error status, surfaced to the operator as a readable message rather than "internal error".
- **FR-008**: The system MUST provide a working read surface (`GET /platform/auth/:ref/config/hooks`) returning the project's current auth-hook configuration in the convention the dashboard reads.
- **FR-009**: The system MUST provide a working write surface (`PATCH /platform/auth/:ref/config/hooks`) that persists auth-hook changes and applies them to the project's auth service.
- **FR-010**: Configuration changes MUST be scoped to operators authorized for the target project; an unauthorized caller MUST be refused without revealing project existence beyond current behavior.
- **FR-011**: When the target project's auth service is not running, configuration writes MUST return a clear, specific condition (e.g. "project not running"), not a generic failure.
- **FR-012**: The four "Auth Config (GoTrue settings per project)" rows in `API-FULL-COMPARISON.md` MUST be updated to reflect real, working coverage once this feature ships, backed by an automated check so the status cannot silently regress.

### Key Entities *(include if feature involves data)*

- **Project auth configuration**: the full per-project authentication settings set (providers + credentials, email/SMTP, site & redirect URLs, sessions, security, MFA policy, mailer subjects/templates, rate limits, hooks). Two naming conventions describe the same fields: the **dashboard convention** (UPPERCASE, env-style, e.g. `EXTERNAL_GITHUB_ENABLED`) and the **automation/Management convention** (lowercase snake_case, e.g. `external_github_enabled`). The feature is the faithful, bidirectional mapping between them.
- **Auth hook configuration**: the subset of auth settings describing per-project hooks (custom access token, MFA verification attempt, password verification attempt, send SMS, send email, before/after user created) — each with an enabled flag, a target, and optional secrets.
- **Validation outcome**: the result of checking a submitted config — either accepted (applied) or a field-identified rejection.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator can enable an OAuth provider from the dashboard and save with a **0% "internal error" rate** for well-formed dashboard payloads (previously 100% failure).
- **SC-002**: **100%** of the auth-config field names the dashboard's pages send are accepted (no "unknown field" rejection of a known/honored field).
- **SC-003**: A value saved via the dashboard is shown correctly when the page is reloaded for **100%** of honored fields (read/write round-trip).
- **SC-004**: After a successful save, the enabled provider/setting is in effect on the project's auth service within the existing restart window (operator sees the "applying → done" feedback complete, typically under ~60 seconds).
- **SC-005**: The pre-existing command-line / automation auth-config path passes its current regression checks unchanged (no behavioral diff).
- **SC-006**: Submitting an invalid field/value yields a clear, field-naming message in **100%** of invalid cases (no generic "internal error" for validation failures).
- **SC-007**: An operator can view and save an auth hook from the dashboard, with changes persisting across reload.
- **SC-008**: All four "Auth Config (GoTrue settings per project)" rows in `API-FULL-COMPARISON.md` are marked as real working coverage (✅), guarded by an automated check.

## Assumptions

- **Mechanism unchanged**: the platform stays the source of truth for auth config and applies changes by reconfiguring + reloading the project's auth service. The project's auth service exposes **no** runtime config-write API (verified: it is environment-driven), so this feature does not — and cannot — offload configuration to it. Only the dashboard-facing read/write translation is in scope.
- **Same field set as already honored**: the set of settings that actually take effect is the one the platform already honors (per features 020 and 082); this feature does not add new honored settings, it makes the existing ones reachable from the dashboard.
- **Convention is a casing relationship**: the dashboard and automation conventions are the same field names modulo case for the auth surface; where a field name diverges beyond casing, an explicit alias is provided. The honored-field registry is the authoritative list to translate against.
- **Hooks reach**: auth-hook settings are part of the honored auth-config set; whether the dashboard's hooks page uses the dedicated `/config/hooks` surface or routes hook fields through the main `/config/auth` surface will be confirmed during planning, but in both cases the operator outcome (view + save hooks) MUST work.
- **Restart UX exists**: the dashboard already shows a non-blocking "applying… / done" indication on auth-config save (feature 020); this feature relies on it and does not redesign it.
- **Real credentials out of scope**: providing valid third-party OAuth client IDs/secrets, SMTP servers, etc., is the operator's responsibility; the feature is correct if it faithfully stores/applies whatever the operator enters.
- **Single live environment**: verification targets the existing self-hosted VM (`supaviser.dev`) and one test project; no multi-region or HA considerations.
