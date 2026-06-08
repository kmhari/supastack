# Feature Specification: Comprehensive API & Proxy Test Coverage

**Feature Branch**: `113-api-proxy-test-coverage`

**Created**: 2026-06-08

**Status**: Draft

## Overview

Supastack exposes ~170 API routes across three surfaces: platform proxy routes (`/platform/*` forwarding to per-instance Kong), management API routes (`/v1/*`), and platform-misc routes (`/platform/*` with real implementations). Proxy tests currently mock `proxyToKong` — no test verifies that rewritten paths and transformed bodies actually reach a real upstream. Three management routes (`gen-types`, `migrations`, `postgrest-config`) have zero unit tests. Over a dozen real-implementation platform-misc routes have no black-box tests at all. This feature adds four independently deliverable test layers: VM-backed E2E proxy smoke tests, fake-upstream integration tests using the `TEST_KONG_BASE_URL` seam, unit tests for untested management routes, and black-box tests for untested platform-misc routes.

## User Scenarios & Testing

### User Story 1 — VM-Backed Proxy Smoke Tests (Priority: P1)

A developer wants a single command that verifies the live proxy is routing correctly to real upstream services on the VM. They run `pnpm test:integration` (with VM credentials in env), and within 60 seconds get a pass/fail result for all five proxy surface groups (pg-meta, storage, auth admin, analytics, realtime).

**Why this priority**: These tests catch the exact class of bugs found in feature 112 (503 on failed project, 404 on storage list, body transformation 400). No amount of mock-based tests would have caught them. This is the highest-value addition.

**Independent Test**: Set `TEST_API_URL`, `TEST_TOKEN_ADMIN`, `TEST_INSTANCE_REF` to a live VM, run `pnpm test:integration` — all 5 proxy surfaces return 2xx.

**Acceptance Scenarios**:

1. **Given** a healthy project and valid admin token, **When** smoke tests run against the VM, **Then** all proxy surfaces (pg-meta GET tables, storage bucket list, auth users list, analytics logs, realtime config) return 2xx
2. **Given** a project with failed/unhealthy status, **When** the pg-meta smoke test runs, **Then** it returns 2xx not 503 (guards the `UNAVAILABLE_STATUSES` fix from feature 112)
3. **Given** `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF` are absent, **When** the suite runs, **Then** all smoke tests are skipped cleanly with `describe.skipIf`
4. **Given** a storage list request, **When** the smoke test runs, **Then** the response body is a valid JSON array (not 400 from unnormalized body)

---

### User Story 2 — Fake-Upstream Integration Tests (Priority: P2)

A developer wants to verify that proxy path rewriting, body normalization, and header injection work correctly — without needing a live VM. They run the unit test suite and within 30 seconds get pass/fail for each proxy contract. A real HTTP server in the test process records exactly what path/headers/body it received, so contract violations are caught immediately.

**Why this priority**: This fills the gap between "proxyToKong is mocked" and "full VM test". The fake upstream catches regressions in path rewriting (`/storage/v1/bucket` → correct upstream path), body normalization (list endpoint `prefix` injection), and header forwarding — all without infrastructure.

**Independent Test**: Run `pnpm test` — all fake-upstream tests pass with zero network calls to any real service.

**Acceptance Scenarios**:

1. **Given** a fake upstream HTTP server bound to a random local port, **When** a proxy request is forwarded, **Then** the server records the exact path, method, headers, and body that arrived
2. **Given** a storage `POST .../objects/list` request, **When** it is proxied, **Then** the fake upstream receives the normalized body with `prefix` field and the rewritten path
3. **Given** a pg-meta or auth-admin proxy request, **When** it is forwarded, **Then** the fake upstream receives both `apikey` and `Authorization: Bearer` headers
4. **Given** an analytics proxy request with path `/platform/projects/:ref/analytics/endpoints/logs.all`, **When** forwarded, **Then** the upstream path is not doubled (no `/logs.all/logs.all`)
5. **Given** a storage bucket-create POST, **When** forwarded, **Then** the upstream body contains the `name` field backfilled from the URL param

---

### User Story 3 — Management Route Unit Tests (Priority: P3)

A developer adds or modifies `gen-types`, `migrations`, or `postgrest-config` routes and wants test coverage for their changes. Currently these routes have zero tests — any regression ships silently.

**Why this priority**: Lower priority than US1/US2 because these routes work today (no known bugs), but they represent a coverage gap that makes refactoring risky.

**Independent Test**: Run `pnpm test` with only the new test files — all three route test files pass with 100% happy+sad path coverage.

**Acceptance Scenarios**:

1. **Given** a valid project ref, **When** `GET /projects/:ref/types/typescript` is called, **Then** it proxies to pg-meta and returns the response
2. **Given** an unauthenticated request to any of the three routes, **When** `requireAuth` throws, **Then** the response is 401
3. **Given** an unknown project ref, **When** any endpoint is called, **Then** the response is 404 with `code: not_found`
4. **Given** `PATCH /projects/:ref/config/database/postgrest` with an unknown field, **When** submitted, **Then** the response is 400 with `code: validation_failed`
5. **Given** `POST /projects/:ref/database/migrations` with missing required fields, **When** submitted, **Then** the response is 400

---

### User Story 4 — Platform-Misc Route Black-Box Tests (Priority: P4)

A developer modifies a platform-misc route (project detail, auth config bridge, PAT management, notifications, available versions, databases info) and wants test coverage to catch regressions. Currently these routes have zero tests — a broken response shape ships silently.

**Why this priority**: Lower than proxy/management tests because no known bugs exist here today, but the surface area is large and growing. Black-box tests via Fastify inject catch shape regressions, wrong status codes, and missing auth gates without any infrastructure.

**Independent Test**: Run `pnpm test` — all new platform-misc test files pass with zero network calls.

**Acceptance Scenarios**:

1. **Given** a valid authenticated request to `GET /platform/projects/:ref`, **When** the project exists, **Then** the response includes `ref`, `name`, and `status` fields
2. **Given** an unauthenticated request to any platform-misc route that requires auth, **When** `requireAuth` throws, **Then** the response is 401
3. **Given** a request to `GET /platform/projects/:ref` for an unknown ref, **When** the project is not found, **Then** the response is 404
4. **Given** a valid request to `GET /platform/profile/access-tokens`, **When** called, **Then** the response is an array of token objects
5. **Given** a `POST /platform/profile/access-tokens` with a valid name, **When** called, **Then** a new token is created and returned
6. **Given** a `DELETE /platform/profile/access-tokens/:id` for an existing token, **When** called, **Then** the token is deleted and the response is 200
7. **Given** a request to `GET /platform/projects/available-versions`, **When** called, **Then** the response is an array of version strings
8. **Given** a request to `GET /platform/projects/:ref/databases`, **When** called, **Then** the response includes connection info fields
9. **Given** a request to `GET /platform/notifications`, **When** called, **Then** the response is an array
10. **Given** `PATCH /platform/notifications` to mark notifications read, **When** called, **Then** the response is 200
11. **Given** a request to `GET /platform/auth/:ref/config/hooks`, **When** called, **Then** the response includes the hook config fields

---

### Edge Cases

- What happens when the VM is unreachable during smoke tests? Fail fast with a network error, not hang indefinitely
- What happens when the fake upstream returns a non-2xx response? The proxy must forward the status unchanged (not swallow or replace it)
- What happens when `DELETE /projects/:ref/database/migrations/:version` targets a non-existent version? Returns 404, not 500
- What happens when `PATCH postgrest-config` receives unknown fields? Returns 400 (strict schema enforcement)
- What happens when `TEST_FAILED_INSTANCE_REF` is absent? The failed-project smoke test is skipped, not failed
- What happens when `GET /platform/projects/:ref/databases` is called for a paused project? Returns 200 with empty or partial data, not 500
- What happens when `DELETE /platform/profile/access-tokens/:id` targets a token owned by a different user? Returns 404, not 403 (no information leakage)
- What happens when `PATCH /platform/projects/:ref` sends an empty body? Returns 200 (no-op update)

## Requirements

### Functional Requirements

- **FR-001**: System MUST have a proxy smoke test suite under `tests/integration/` covering all five proxy groups: pg-meta, storage (bucket list + object list), auth admin, analytics logs, realtime config
- **FR-002**: Smoke tests MUST skip automatically when `TEST_API_URL`, `TEST_TOKEN_ADMIN`, or `TEST_INSTANCE_REF` env vars are absent
- **FR-003**: Smoke suite MUST include a failed-status project test asserting 2xx response (guards `UNAVAILABLE_STATUSES` fix from feature 112)
- **FR-004**: System MUST have a fake-upstream integration test suite under `apps/api/tests/unit/` using `TEST_KONG_BASE_URL` seam, covering all 5 proxy groups
- **FR-005**: Fake-upstream tests MUST assert the exact upstream path for each proxy group
- **FR-006**: Fake-upstream tests MUST assert that storage list body is normalized (`prefix` injected) and bucket-create `name` is backfilled
- **FR-007**: Fake-upstream tests MUST assert that `apikey` and `Authorization: Bearer` headers are injected for pg-meta and auth-admin groups
- **FR-008**: Fake-upstream tests MUST assert that analytics path is not doubled
- **FR-009**: `gen-types` unit tests MUST cover: 200 happy path, 404 (project not found), 401 (unauthenticated)
- **FR-010**: `migrations` unit tests MUST cover: GET list 200, POST 201, DELETE 204, 400 validation, 404 not found, 401 unauthenticated
- **FR-011**: `postgrest-config` unit tests MUST cover: GET defaults 200, GET with stored config 200, PATCH valid 200, PATCH invalid fields 400, 404, 401
- **FR-012**: All fake-upstream and management unit tests MUST complete in under 30 seconds with zero network calls
- **FR-013**: `TEST_FAILED_INSTANCE_REF` MUST gate the failed-project smoke test — if absent, test is skipped
- **FR-014**: Black-box tests MUST cover `GET /platform/projects/:ref` — happy path (200 with shape), 404 (project not found), 401 (unauthenticated)
- **FR-015**: Black-box tests MUST cover `PATCH /platform/projects/:ref` — happy path (200), empty body no-op (200), 404, 401
- **FR-016**: Black-box tests MUST cover `GET /platform/projects/:ref/databases` — happy path (200 with connection info shape), 404, 401
- **FR-017**: Black-box tests MUST cover `GET /platform/profile/access-tokens` — happy path (200 array), 401
- **FR-018**: Black-box tests MUST cover `POST /platform/profile/access-tokens` — happy path (200 with token), missing name (400), 401
- **FR-019**: Black-box tests MUST cover `DELETE /platform/profile/access-tokens/:id` — happy path (200), not found (404), 401
- **FR-020**: Black-box tests MUST cover `GET /platform/projects/available-versions` — happy path (200 array), 401
- **FR-021**: Black-box tests MUST cover `GET /platform/notifications` — happy path (200 array), 401
- **FR-022**: Black-box tests MUST cover `PATCH /platform/notifications` — happy path (200), 401
- **FR-023**: Black-box tests MUST cover `GET /platform/auth/:ref/config/hooks` — happy path (200 with hook fields), 404, 401
- **FR-024**: All platform-misc black-box tests MUST complete in under 30 seconds with zero network calls

### Key Entities

- **Proxy route group**: One of five sets of routes (pg-meta, storage, auth admin, analytics, realtime) that forward to per-instance Kong
- **Fake upstream**: In-process HTTP server bound to a random port, records received requests, used to assert proxy contract without infrastructure
- **VM smoke environment**: Set of env vars (`TEST_API_URL`, `TEST_TOKEN_ADMIN`, `TEST_INSTANCE_REF`, `TEST_FAILED_INSTANCE_REF`) that gate live-VM tests
- **Healthy project ref**: A real project ref on the VM that is running and accessible
- **Failed project ref**: A real project ref on the VM that is in a failed/crashed state (used to guard the 503→2xx fix)
- **Platform-misc route**: A `/platform/*` route in `platform-misc.ts` with a real implementation (not a stub returning 501) — project detail, PAT CRUD, notifications, available versions, databases, auth hooks config

## Success Criteria

### Measurable Outcomes

- **SC-001**: Every proxy route group has at least one fake-upstream test that would fail if the path rewriting logic broke
- **SC-002**: Unit test suite (fake-upstream + management route tests) completes in under 30 seconds with no network dependencies
- **SC-003**: VM smoke tests complete in under 60 seconds when run against the live VM
- **SC-004**: All three previously untested management routes (`gen-types`, `migrations`, `postgrest-config`) reach 100% happy+sad path coverage
- **SC-005**: Any change to proxy path rewriting or body transformation logic causes at least one fake-upstream test to fail before it ships
- **SC-006**: All untested real-implementation platform-misc routes (project detail, PAT CRUD, notifications, databases, available-versions, auth hooks config) have at least happy + auth-failure coverage

## Assumptions

- The VM has at least one active/healthy project available for read-only smoke tests
- The `TEST_KONG_BASE_URL` env var seam already exists in `proxyToKong` (implemented in feature 112)
- Fake-upstream tests run in the `apps/api/tests/unit/` vitest workspace (existing vitest project)
- VM smoke tests run in the `tests/integration/` vitest workspace, gated by env vars
- `postgrest-config` route uses `runtime-config-store` for get/patch (same pattern as pgbouncer-config)
- `gen-types` route uses `proxyToKong` directly — can be tested by mocking the module
- `migrations` route uses a service layer that can be mocked
- All smoke test operations are read-only and safe to run repeatedly on the live VM
- The fake upstream binds to a random available port to avoid port conflicts in CI
- Platform-misc black-box tests mock the service/store layer (same Fastify inject pattern as existing `platform-profile.test.ts`, `platform-organizations.test.ts`)
- Stub routes (returning 501 or static shapes) are out of scope — only real-implementation routes are covered by US4
- `GET /platform/projects/:ref/status`, `GET /platform/projects/available-regions`, and `GET/PATCH /platform/projects/:ref/config/postgrest` are excluded from US4 — the first two are already covered by existing tests or are trivial passthroughs; the third delegates to `/v1/projects/:ref/postgrest` covered by US3
