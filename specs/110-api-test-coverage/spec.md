# Feature Specification: API Test Coverage — Happy & Sad Paths

**Feature Branch**: `110-api-test-coverage`

**Created**: 2026-06-06

**Status**: Draft

## Overview

Feature 108 (branch `108-platform-contract-guard`) introduced eight new or converted endpoints across the Management API and Platform surface. These endpoints currently have limited or no automated test coverage. This feature mandates full unit-test coverage for every new endpoint: one or more happy-path assertions verifying correct data shape, plus standard sad-path assertions (401 unauthenticated, 500 on DB/upstream failure, 403 where applicable).

The test convention established by `platform-quick-wins.test.ts` is the reference pattern: a `buildApp(authed)` helper, Vitest mocks via `vi.hoisted()`, and a `setErrorHandler` that surfaces `statusCode` from thrown errors.

No new endpoints are added by this feature. Every task produces test code only.

## User Scenarios & Testing

### User Story 1 — Services Endpoint Has Verifiable Behavior (Priority: P1)

A developer running the test suite can confirm that `GET /v1/projects/:ref/services` returns the correct six-service structure for a healthy project and returns 401 when the request is unauthenticated.

**Why this priority**: The services endpoint is called by Studio on every project page load. An incorrect shape would silently break the dashboard. P1 because the endpoint has zero unit tests.

**Independent Test**: Run `pnpm test` in `apps/api`; the services-related describe block passes with no failures.

**Acceptance Scenarios**:

1. **Given** an authenticated request to `GET /v1/projects/:ref/services`, **When** the project exists, **Then** the response is 200 with a JSON array of exactly 6 service objects, each having `name`, `status`, and `version` fields.
2. **Given** a project that has containers in non-running states, **When** the endpoint is called, **Then** the status field for each service reflects the actual state (e.g., `INACTIVE`, `COMING_UP`).
3. **Given** an unauthenticated request, **Then** 401 is returned.
4. **Given** the underlying data source throws an error, **Then** 500 is returned.

---

### User Story 2 — Storage Bucket CRUD Has Verifiable Behavior (Priority: P1)

A developer can confirm that the four storage bucket endpoints (create, get, update, delete) each return the correct shape on success and return standard error codes on failure. The Studio `id→name` backfill fix is covered by a regression test.

**Why this priority**: Storage bucket mutations are destructive. Without tests, a future refactor could silently break bucket creation or deletion. P1 because these are write endpoints.

**Independent Test**: Run `pnpm test` in `apps/api`; all storage-bucket describe blocks pass.

**Acceptance Scenarios**:

1. **Given** a POST to `/v1/projects/:ref/storage/buckets` with body `{name: "my-bucket"}`, **When** the bucket is created, **Then** 200 is returned with an object containing `name: "my-bucket"`.
2. **Given** a POST with body `{id: "my-bucket"}` but no `name` field, **When** the endpoint processes it, **Then** `name` is backfilled from `id` and the bucket is created successfully (Studio compatibility fix regression).
3. **Given** a GET to `/v1/projects/:ref/storage/buckets/:id` for an existing bucket, **Then** 200 is returned with the bucket's fields.
4. **Given** a GET for a non-existent bucket, **Then** 404 is returned.
5. **Given** a PATCH to `/v1/projects/:ref/storage/buckets/:id` with updated fields, **Then** 200 is returned reflecting the update.
6. **Given** a DELETE to `/v1/projects/:ref/storage/buckets/:id`, **Then** 200 is returned and the bucket is removed.
7. **Given** an unauthenticated request to any of these endpoints, **Then** 401 is returned.
8. **Given** the storage proxy throws an error, **Then** 500 is returned.

---

### User Story 3 — Platform Restore Versions Has Verifiable Behavior (Priority: P1)

A developer can confirm that `GET /platform/projects/:ref/restore/versions` returns an array of completed backup entries with the correct numeric-id shape, handles the empty case, coerces null fields, and rejects unauthenticated callers.

**Why this priority**: The existing `platform-quick-wins.test.ts` tests were introduced alongside the implementation. This story ensures those tests are complete and meet the two-path standard, with no gaps.

**Independent Test**: Run the `restore/versions` describe block; 5 tests pass (empty array, shaped entry, null coercion, 401, 500).

**Acceptance Scenarios**:

1. **Given** no completed backups exist, **When** the endpoint is called, **Then** `[]` is returned.
2. **Given** one completed backup row, **When** the endpoint is called, **Then** one entry is returned with `id` (numeric), `inserted_at`, `completed_at`, `size_bytes`, `isPhysicalBackup: true`, and `status: "COMPLETED"`.
3. **Given** a backup row with `seq: null` and `completedAt: null`, **Then** `id` is `0` and `completed_at` is `null`.
4. **Given** an unauthenticated request, **Then** 401 is returned.
5. **Given** the database throws an error, **Then** 500 is returned.

---

### User Story 4 — Daily Stats Has Verifiable Behavior (Priority: P1)

A developer can confirm that `GET /platform/projects/:ref/daily-stats` returns `{data: [...]}` wrapping the audit-log aggregate, handles both bare-array and `QueryResult` shapes from Drizzle, and covers error paths.

**Why this priority**: The `execute()` → `QueryResult` shape discrepancy is a recurring Drizzle gotcha. The test covering both shapes prevents silent breakage if the Drizzle version changes.

**Independent Test**: Run the `daily-stats` describe block; 5 tests pass.

**Acceptance Scenarios**:

1. **Given** no audit events, **When** the endpoint is called, **Then** `{data: []}` is returned.
2. **Given** audit events exist, **When** the endpoint is called, **Then** `{data: [...]}` is returned with `period_start`, `total_requests` (number), and `errors: 0` per entry.
3. **Given** Drizzle returns a `QueryResult` object `{rows: [...]}` instead of a bare array, **Then** the endpoint correctly extracts and maps the rows.
4. **Given** an unauthenticated request, **Then** 401 is returned.
5. **Given** the database throws an error, **Then** 500 is returned.

---

### User Story 5 — Available Versions Has Verifiable Behavior (Priority: P2)

A developer can confirm that `GET /platform/organizations/:slug/available-versions` returns the PostgreSQL 15 entry (not an empty array), matches the POST result, and rejects unauthenticated callers.

**Why this priority**: Lower priority because the endpoint is read-only and the fix is a static list. But P2 because a regression back to `[]` would silently break Studio's project-creation flow.

**Independent Test**: Run the `available-versions` describe block; 3 tests pass.

**Acceptance Scenarios**:

1. **Given** an authenticated GET request, **Then** 200 is returned with an array containing at least one entry with `postgres_engine: "postgres"` and `displayName: "PostgreSQL 15"`.
2. **Given** GET and POST requests by the same authenticated caller, **Then** both return identical lists.
3. **Given** an unauthenticated request, **Then** 401 is returned.

---

### Edge Cases

- What if the storage proxy returns a non-200 status for bucket operations? The error body and status code must propagate verbatim to the caller.
- What if a backup row has a null `startedAt` date? The `inserted_at` field should be `null` rather than crashing.
- What if `daily-stats` receives a `QueryResult` where `.rows` is itself undefined? Should default to `[]` without throwing.
- What if the services endpoint is called for a project not owned by the authenticated user? 403, not 500.

## Requirements

### Functional Requirements

- **FR-001**: Unit tests for `GET /v1/projects/:ref/services` MUST cover: correct 6-service array shape, non-running state, 401 unauthenticated, 500 on error.
- **FR-002**: Unit tests for `POST /v1/projects/:ref/storage/buckets` MUST cover: success with `name`, Studio `id→name` backfill, 401, 500.
- **FR-003**: Unit tests for `GET /v1/projects/:ref/storage/buckets/:id` MUST cover: 200 with shape, 404 not found, 401, 500.
- **FR-004**: Unit tests for `PATCH /v1/projects/:ref/storage/buckets/:id` MUST cover: 200 with updated shape, 401, 500.
- **FR-005**: Unit tests for `DELETE /v1/projects/:ref/storage/buckets/:id` MUST cover: 200 success, 401, 500.
- **FR-006**: Unit tests for `GET /platform/projects/:ref/restore/versions` MUST cover: empty array, shaped entry (all required fields), null coercion, 401, 500.
- **FR-007**: Unit tests for `GET /platform/projects/:ref/daily-stats` MUST cover: empty data, mapped rows with numeric totals, `QueryResult` shape handling, 401, 500.
- **FR-008**: Unit tests for `GET /platform/organizations/:slug/available-versions` MUST cover: non-empty list with correct shape, GET == POST parity, 401.
- **FR-009**: All tests MUST use the project's Vitest framework and mock external dependencies (DB, storage proxy) so tests pass without a running VM.
- **FR-010**: All tests MUST follow the `buildApp(authed = true)` helper pattern with a `setErrorHandler` that surfaces `statusCode` from thrown errors.
- **FR-011**: Happy-path tests MUST assert both HTTP status code and response body shape.
- **FR-012**: Sad-path 401 tests MUST assert status code only (body varies).
- **FR-013**: Sad-path 500 tests MUST assert status code only and be triggered by a mock that rejects with an `Error`.

### Key Entities

- **TestCase**: A single `it(...)` block with setup, request via `app.inject`, and assertions.
- **MockState**: The `vi.hoisted()` object controlling what the DB / storage proxy returns or throws.
- **AppFixture**: The `buildApp(authed)` helper that builds a Fastify instance with mocked decorators.

## Success Criteria

### Measurable Outcomes

- **SC-001**: `pnpm test` in `apps/api` passes with 0 failures for all new test files added by this feature.
- **SC-002**: Every endpoint listed in FR-001 through FR-008 has at least one happy-path test and at least one sad-path 401 test.
- **SC-003**: Total new test count is ≥ 28 (FR-001: 4, FR-002: 4, FR-003: 4, FR-004: 3, FR-005: 3, FR-006: 5, FR-007: 5, FR-008: 3, minus overlap with existing).
- **SC-004**: No production source files are modified by this feature — test files only.
- **SC-005**: All new tests run in < 10 seconds without network access.
- **SC-006**: No existing passing tests regress.

## Assumptions

- The `platform-quick-wins.test.ts` file (FR-006, FR-007, FR-008) already exists and already contains at least the 13 baseline tests. New tests in this spec extend or replace that file rather than duplicate it.
- Storage bucket tests will use the existing `storage-buckets-proxy.js` mock pattern established in `platform-quick-wins.test.ts`.
- The services endpoint (`GET /v1/projects/:ref/services`) is implemented in the Management API route file, not `platform-misc.ts`. The test will need a separate test file and route mock.
- 403 testing (wrong-org access) is a lower priority and may be deferred to a follow-up feature focused solely on RBAC regression tests.
