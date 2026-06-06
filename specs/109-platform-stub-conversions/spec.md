# Feature Specification: Platform Stub Conversions (Tier 1–4)

**Feature Branch**: `109-platform-stub-conversions`

**Created**: 2026-06-06

**Status**: Draft

## Overview

The platform API has ~235 stub endpoints that return hardcoded or empty responses. This feature converts the highest-value, lowest-effort stubs (Tiers 1–4 from the audit) into real implementations. Each tier groups endpoints by effort: Tier 1 reflects existing instance state, Tier 2 queries existing tables, Tier 3 delegates to already-implemented `/v1` handlers, Tier 4 runs per-instance diagnostic queries via the existing database-query pathway.

No new infrastructure is introduced. All data already exists in the control-plane database, the per-instance Postgres, or implemented `/v1` endpoints.

## User Scenarios & Testing

### User Story 1 — Project Status Surfaces Reflect Real State (Priority: P1)

A Studio dashboard user viewing a project that is paused or being restored sees accurate status indicators — pause badge, read-only indicator, upgrade banner — instead of stale hardcoded values. These indicators currently always show "active/not-pausing/not-upgrading" regardless of real state.

**Why this priority**: Incorrect status indicators are actively misleading. A paused project shown as active causes user confusion and support tickets. This is a correctness bug disguised as a stub.

**Independent Test**: Pause a project via the API, then call the three status endpoints; all must reflect the paused state.

**Acceptance Scenarios**:

1. **Given** a project with status `paused`, **When** `GET /platform/projects/:ref/pause/status` is called, **Then** the response reflects `status: 'not_pausing'` (pause completed) and `initiated_at` is populated.
2. **Given** a project with status `paused`, **When** `GET /platform/projects/:ref/readonly` is called, **Then** the response is `{enabled: true}`.
3. **Given** a project with status `running`, **When** `GET /platform/projects/:ref/readonly` is called, **Then** the response is `{enabled: false}`.
4. **Given** a project with status `restoring`, **When** `GET /platform/projects/:ref/upgrade/status` is called, **Then** the response reflects an in-progress state.
5. **Given** any authenticated user calls `DELETE /platform/projects/:ref/readonly` on a paused project, **Then** the project resumes and returns 200.
6. **Given** an unauthenticated request to any of these endpoints, **Then** 401 is returned.

---

### User Story 2 — Project Audit Log and Activity Are Queryable (Priority: P1)

An operator viewing a project's activity history in Studio sees real events (restarts, config changes, member actions) instead of an empty list. These endpoints are called by Studio's Logs → Audit and activity feed pages.

**Why this priority**: Audit and activity data already exists in the control-plane. Showing it requires only a query already proven by the `daily-stats` implementation.

**Independent Test**: Perform any admin action on a project (e.g., config change), then call the audit endpoint; the action must appear.

**Acceptance Scenarios**:

1. **Given** a project with recorded audit events, **When** `GET /platform/projects/:ref/audit` is called, **Then** results and a total count are returned.
2. **Given** a project with no audit events, **When** `GET /platform/projects/:ref/audit` is called, **Then** `{result: [], count: 0}` is returned.
3. **Given** a project with recorded events, **When** `GET /platform/projects/:ref/activity` is called, **Then** a chronological list of events is returned.
4. **Given** an unauthenticated request, **Then** 401 is returned.

---

### User Story 3 — Downloadable Backups List Is Real (Priority: P2)

A Studio user opening the Backups page sees all completed backup entries in both the restore list and the download list. Currently the download list always shows empty even though the data exists.

**Why this priority**: The restore-versions endpoint was already fixed; this is the same data in a different shape. Completing it closes the Backups page fully.

**Independent Test**: After at least one completed backup exists, call the endpoint; at least one entry must be returned.

**Acceptance Scenarios**:

1. **Given** completed backups exist, **When** `GET /platform/database/:ref/backups/downloadable-backups` is called, **Then** a `{backups: [...]}` array with numeric IDs and status is returned.
2. **Given** no completed backups, **When** the endpoint is called, **Then** `{backups: []}` is returned.
3. **Given** an unauthenticated request, **Then** 401 is returned.

---

### User Story 4 — Network Bans and Restrictions Reflect Real State (Priority: P2)

A Studio user on the Network Restrictions page can view and clear network bans, and view/apply network restriction CIDRs. These already work via the `/v1` Management API but the `/platform` surface always returns empty/disallowed.

**Why this priority**: The `/v1` handlers are fully implemented; the platform surface just needs to delegate to them. Zero new logic required.

**Independent Test**: Add a network ban via the `/v1` endpoint, then call the `/platform` equivalent; the ban must be visible and deletable.

**Acceptance Scenarios**:

1. **Given** existing network bans, **When** `GET /platform/projects/:ref/network-bans` is called, **Then** the ban list is returned.
2. **Given** a DELETE to `/platform/projects/:ref/network-bans`, **Then** the bans are removed and the response matches the `/v1` equivalent.
3. **Given** a GET to `/platform/projects/:ref/network-restrictions`, **Then** the current CIDR config is returned.
4. **Given** a POST to `/platform/projects/:ref/network-restrictions/apply`, **Then** the restriction is applied and the response matches the `/v1` equivalent.
5. **Given** an unauthenticated request, **Then** 401 is returned.

---

### User Story 5 — SSL Enforcement Is Readable and Writable (Priority: P2)

A Studio user on the Database Settings page can see whether SSL enforcement is enabled and toggle it. The `/platform` surface currently ignores the real value and echoes back whatever body is sent.

**Why this priority**: Same delegation pattern as network restrictions — the `/v1` handler is real; the platform surface is a thin wrapper.

**Independent Test**: Enable SSL enforcement via `/v1`, then GET via `/platform`; it must reflect the enabled state.

**Acceptance Scenarios**:

1. **Given** SSL enforcement is disabled, **When** `GET /platform/projects/:ref/ssl-enforcement` is called, **Then** `{currentConfig: {database: false}, appliedSuccessfully: true}` is returned.
2. **Given** a PUT request enabling SSL, **Then** the change is persisted and the response reflects the updated state.
3. **Given** an unauthenticated request, **Then** 401 is returned.

---

### User Story 6 — Edge Functions Secrets Use the Vault (Priority: P2)

A Studio user on the Edge Functions → Secrets page can list and add secrets via the platform surface. Currently these endpoints return empty/no-op even though the vault-backed `/v1/projects/:ref/secrets` is fully implemented and an identical delegation pattern already exists for a parallel route.

**Why this priority**: The implementation is a copy of an already-existing delegation pattern. The user-facing Secrets page is broken without it.

**Independent Test**: Add a secret via the vault API, then GET `/platform/projects/:ref/functions/secrets`; the secret must appear.

**Acceptance Scenarios**:

1. **Given** secrets exist in the vault, **When** `GET /platform/projects/:ref/functions/secrets` is called, **Then** the secret list is returned.
2. **Given** a POST with a new secret body, **Then** the secret is stored in the vault and the response matches the `/v1` equivalent.
3. **Given** an unauthenticated request, **Then** 401 is returned.

---

### User Story 7 — Database Lint Results Are Real (Priority: P3)

A Studio user on the Advisors page sees real lint results (unused indexes, duplicate indexes, tables without RLS, etc.) derived from live Postgres statistics instead of an empty list.

**Why this priority**: The per-instance Postgres is already queryable via the existing database-query pathway; lint queries are `pg_stat_*` aggregations. Tier 4 requires more implementation than the delegation stubs but is self-contained.

**Independent Test**: On a project with at least one table, call the lint endpoint; at least the RLS-not-enabled check must return a result or explicit pass.

**Acceptance Scenarios**:

1. **Given** a running project, **When** `GET /platform/projects/:ref/run-lints` is called, **Then** a JSON array of lint check results is returned (empty is valid if all pass).
2. **Given** a project with tables that have no RLS policies, **When** the lint endpoint is called, **Then** those tables appear in the results.
3. **Given** `GET /platform/projects/:ref/run-lints/:name` for a specific lint check, **Then** only results for that check are returned.
4. **Given** an unauthenticated request, **Then** 401 is returned.
5. **Given** a project that is not running, **When** the lint endpoint is called, **Then** a clear error is returned rather than a crash.

---

### Edge Cases

- What happens when a project's status changes between request and response? Single DB read is used; no atomicity guarantee needed.
- How does the system handle a project ref outside the authenticated user's org? 403, consistent with all other org-scoped endpoints.
- What if the per-instance Postgres is unreachable during lint execution? Return 503 with a clear message; do not return partial results silently.
- What if a delegated `/v1` handler returns a non-200? Propagate the status code and body verbatim to the caller.

## Requirements

### Functional Requirements

- **FR-001**: `GET /platform/projects/:ref/pause/status` MUST return a response derived from the real instance status, reflecting whether the project is paused.
- **FR-002**: `GET /platform/projects/:ref/readonly` MUST return `{enabled: true}` when the project is paused and `{enabled: false}` otherwise.
- **FR-003**: `DELETE /platform/projects/:ref/readonly` MUST trigger the existing un-pause workflow and return a success response.
- **FR-004**: `GET /platform/projects/:ref/upgrade/status` MUST reflect the real instance state (restoring → in-progress, running → not-upgrading).
- **FR-005**: `GET /platform/projects/:ref/audit` MUST return real audit-log events for the project with a total count.
- **FR-006**: `GET /platform/projects/:ref/activity` MUST return a chronological list of audit-log events for the project.
- **FR-007**: `GET /platform/database/:ref/backups/downloadable-backups` MUST return completed backup entries from the backups table, using the same data source as `restore/versions`.
- **FR-008**: `GET /platform/projects/:ref/network-bans` and `DELETE /platform/projects/:ref/network-bans` MUST delegate to the corresponding `/v1` handlers and return their responses verbatim.
- **FR-009**: `GET /platform/projects/:ref/network-restrictions` and `POST /platform/projects/:ref/network-restrictions/apply` MUST delegate to the corresponding `/v1` handlers.
- **FR-010**: `GET /platform/projects/:ref/ssl-enforcement` and `PUT /platform/projects/:ref/ssl-enforcement` MUST delegate to the corresponding `/v1` handlers.
- **FR-011**: `GET /platform/projects/:ref/functions/secrets` and `POST /platform/projects/:ref/functions/secrets` MUST delegate to the vault-backed `/v1/projects/:ref/secrets` handlers using the existing `app.inject` delegation pattern.
- **FR-012**: `GET /platform/projects/:ref/run-lints` MUST execute a set of standard advisory lint queries against the per-instance Postgres and return structured results.
- **FR-013**: `GET /platform/projects/:ref/run-lints/:name` MUST filter results to a single named lint check.
- **FR-014**: All endpoints MUST return 401 for unauthenticated requests.
- **FR-015**: All endpoints MUST return 403 when the authenticated user does not belong to the project's organization.
- **FR-016**: Delegation endpoints MUST propagate non-200 status codes from upstream handlers verbatim.

### Key Entities

- **LintResult**: A single lint check outcome — check name, level (WARNING/ERROR/INFO), description, affected object names.
- **AuditEvent**: An audit log entry — action, actor, target, timestamp, payload.
- **BackupEntry**: A completed backup — numeric id, inserted_at, status, size_bytes, isPhysicalBackup flag.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All 20 Tier 1–4 endpoints return real data on a live project, verified by the CLI e2e suite with 0 failures.
- **SC-002**: Status endpoints (pause/status, readonly, upgrade/status) agree with the project's real state within a single request — no staleness window.
- **SC-003**: Delegation endpoints (network-bans, network-restrictions, ssl-enforcement, functions/secrets) return identical responses to their `/v1` counterparts for the same input.
- **SC-004**: Lint endpoint returns results within 5 seconds on a project with up to 100 tables.
- **SC-005**: All endpoints return 401 for unauthenticated requests and 403 for requests outside the user's org scope.
- **SC-006**: No existing passing tests regress after this change.

## Assumptions

- The existing `app.inject` delegation pattern is the correct mechanism for Tier 3 endpoints and requires no architectural change.
- Lint queries will use the same per-instance Postgres pathway established by `POST /v1/projects/:ref/database/query` with `read_only: true`.
- Standard advisory lint checks cover: tables without RLS, duplicate indexes, unused indexes, bloated tables/indexes, sequences near exhaustion. The exact query set will be confirmed during planning.
- The `pause/status` response shape matches Cloud's contract: `{initiated_at: string|null, status: 'not_pausing'|'pausing'}`.
- Tier 5+ stubs (replication, branches, billing, Vercel, GitHub, PrivateLink) are explicitly out of scope.
- No new database migrations are required for Tiers 1–4.
- The `manage-access` and `members/permissions` stubs are already correct for self-hosted and are excluded.
- `telemetry/feature-flags` and `/platform/flags` will return a static self-hosted defaults object (no env-var feature-flag system exists yet).
