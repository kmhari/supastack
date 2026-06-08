# Feature Specification: Fix Platform Proxy — Profile, Realtime Config & PgBouncer Config

**Feature Branch**: `112-fix-proxy-config`

**Created**: 2026-06-08

**Status**: Draft

## Overview

Three platform API endpoints currently return incorrect data to Studio:

1. `GET /platform/profile` — returns hardcoded fake data instead of the real authenticated user's profile.
2. `GET /platform/projects/:ref/config/realtime` — returns a hardcoded `max_concurrent_users: 200` instead of persisted config.
3. `PATCH /platform/projects/:ref/config/realtime` — silently discards writes (echoes body without persisting).
4. `GET /platform/projects/:ref/config/pgbouncer` — returns hardcoded pool defaults instead of persisted config.
5. `PATCH /platform/projects/:ref/config/pgbouncer` — silently discards writes (echoes body without persisting).

For profile, a real Management API handler (`GET /v1/profile`) already exists — the platform endpoint just needs to delegate to it and augment with Studio-only fields. For realtime and pgbouncer configs, no Management API handler exists yet, so both the `/v1/*` handler and the `/platform/*` proxy must be created together.

## User Scenarios & Testing

### User Story 1 — Real Profile Data in Studio (Priority: P1)

An authenticated operator opens Supabase Studio. The top-right avatar, the account settings page, and any reference to "your profile" show the operator's real email address and user ID — not fake placeholder data.

**Why this priority**: Profile data is displayed on every page load. Fake data (`free_project_limit: 999`, wrong email) causes confusion and can break Studio flows that depend on the real user identity.

**Independent Test**: Log in, open Studio account settings — the displayed email matches the login credential. The `primary_email` field in the API response matches what was used to authenticate.

**Acceptance Scenarios**:

1. **Given** an authenticated operator, **When** Studio calls `GET /platform/profile`, **Then** the response includes the operator's real `primary_email` and `id`.
2. **Given** an authenticated operator, **When** Studio calls `GET /platform/profile`, **Then** the response also includes Studio-required fields: `username`, `free_project_limit`, `disabled_features`, `is_alpha_user`.
3. **Given** an unauthenticated request, **When** `GET /platform/profile` is called, **Then** the response is 401 Unauthorized.

---

### User Story 2 — Realtime Config Persists Across Restarts (Priority: P2)

An operator opens the Studio Realtime settings page for a project, changes `max_concurrent_users`, and saves. On subsequent page loads — including after an API restart — the saved value is shown, not a hardcoded default.

**Why this priority**: Currently every PATCH is silently dropped. The operator thinks they saved a value but nothing persists. Realtime config affects live connection limits.

**Independent Test**: PATCH a new `max_concurrent_users` value, then GET — the returned value matches what was saved.

**Acceptance Scenarios**:

1. **Given** a project, **When** `PATCH /platform/projects/:ref/config/realtime` is called with `{ max_concurrent_users: 500 }`, **Then** the response reflects the new value.
2. **Given** a previously patched config, **When** `GET /platform/projects/:ref/config/realtime` is called, **Then** the persisted value is returned (not the hardcoded 200).
3. **Given** no prior config for a project, **When** `GET /platform/projects/:ref/config/realtime` is called, **Then** sensible defaults are returned.
4. **Given** an unknown project ref, **When** either endpoint is called, **Then** 404 is returned.

---

### User Story 3 — PgBouncer Config Persists Across Restarts (Priority: P3)

An operator opens the Studio Database → Connection Pooling settings page, changes `pool_mode` or `default_pool_size`, and saves. On subsequent page loads the saved values are shown.

**Why this priority**: Same as realtime — PATCH is currently silently dropped. PgBouncer config affects connection pooling behaviour for every client connecting through the pooler.

**Independent Test**: PATCH new pooling settings, then GET — returned values match what was saved.

**Acceptance Scenarios**:

1. **Given** a project, **When** `PATCH /platform/projects/:ref/config/pgbouncer` is called with new settings, **Then** the response reflects the updated values.
2. **Given** a previously patched config, **When** `GET /platform/projects/:ref/config/pgbouncer` is called, **Then** the persisted value is returned (not the hardcoded defaults).
3. **Given** no prior config, **When** `GET /platform/projects/:ref/config/pgbouncer` is called, **Then** sensible defaults are returned (`pool_mode: transaction`, `default_pool_size: 15`).
4. **Given** an unknown project ref, **When** either endpoint is called, **Then** 404 is returned.

---

### Edge Cases

- What happens when a project is deleted — are its stored configs cleaned up?
- What happens when a PATCH body omits a field — should it merge with existing config or replace it?
- What if the runtime config store has no row yet — should GET return defaults or 404?

## Requirements

### Functional Requirements

- **FR-001**: `GET /platform/profile` MUST return the authenticated user's real `id` and `primary_email` sourced from the user store.
- **FR-002**: `GET /platform/profile` MUST also return Studio-required fields: `username` (derived from email), `free_project_limit` (fixed at 999 for self-hosted), `disabled_features` (empty array), `is_alpha_user` (false), `gotrue_id` (same as `id`).
- **FR-003**: `GET /v1/projects/:ref/config/realtime` MUST return the persisted realtime config for the project, falling back to defaults when no row exists.
- **FR-004**: `PATCH /v1/projects/:ref/config/realtime` MUST merge the supplied fields into the existing config and persist the result.
- **FR-005**: `GET /platform/projects/:ref/config/realtime` MUST delegate to `GET /v1/projects/:ref/config/realtime` and return the result.
- **FR-006**: `PATCH /platform/projects/:ref/config/realtime` MUST delegate to `PATCH /v1/projects/:ref/config/realtime` and return the result.
- **FR-007**: `GET /v1/projects/:ref/config/database/pgbouncer` MUST return the persisted pgbouncer config, falling back to defaults when no row exists.
- **FR-008**: `PATCH /v1/projects/:ref/config/database/pooler` MUST merge the supplied fields and persist the result.
- **FR-009**: `GET /platform/projects/:ref/config/pgbouncer` MUST delegate to `GET /v1/projects/:ref/config/database/pgbouncer`.
- **FR-010**: `PATCH /platform/projects/:ref/config/pgbouncer` MUST delegate to `PATCH /v1/projects/:ref/config/database/pooler`.
- **FR-011**: All four config endpoints (realtime GET/PATCH, pgbouncer GET/PATCH) MUST enforce project ownership — only members of the project's org may access it.
- **FR-012**: All four config endpoints MUST return 404 for unknown project refs.
- **FR-013**: Config storage MUST use the existing `runtime_config` store pattern (same mechanism as `postgrest` config) — no new tables.

### Key Entities

- **RealtimeConfig**: Per-project realtime settings. Key fields: `max_concurrent_users` (integer). Stored under config key `realtime`.
- **PgBouncerConfig**: Per-project connection pooler settings. Key fields: `pool_mode` (transaction/session/statement), `default_pool_size` (integer), `ignore_startup_parameters` (string), `max_client_conn` (integer). Stored under config key `pgbouncer`.
- **Profile**: Authenticated operator identity. Real fields: `id`, `primary_email`. Augmented fields: `username`, `free_project_limit`, `disabled_features`, `gotrue_id`, `is_alpha_user`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: `GET /platform/profile` returns the operator's real email on every call — zero occurrences of hardcoded `free_project_limit: 999` logic branching on fake values.
- **SC-002**: A PATCH to realtime or pgbouncer config followed immediately by a GET returns the patched values — 100% of the time, with no data loss.
- **SC-003**: All five endpoints have contract tests that verify response shapes match upstream `platform.d.ts` / `api.d.ts` type definitions.
- **SC-004**: GET on a project with no prior config returns defaults (not 404 and not an error) — verified by test.
- **SC-005**: All existing 729 passing tests continue to pass after these changes.

## Assumptions

- The existing `runtime_config` store (used by `postgrest` config, feature 009) is the correct persistence layer for realtime and pgbouncer config — no new DB tables are needed.
- `free_project_limit` is always 999 for self-hosted deployments (no billing tier enforcement).
- `disabled_features` is always an empty array for self-hosted (all features enabled).
- PgBouncer config changes are stored only — actually applying them to the running Supavisor/pgbouncer process is out of scope for this feature (same deferred-apply pattern as postgrest config).
- Realtime config changes are stored only — actually restarting the realtime container to apply them is out of scope.
- PATCH semantics are merge-over-existing (partial update), not full replacement.
- The `username` field in profile can be derived as the email prefix (everything before `@`).
