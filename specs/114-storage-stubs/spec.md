# Feature Specification: Storage Platform API Stub Implementations

**Feature Branch**: `114-storage-stubs`

**Created**: 2026-06-08

**Status**: Draft

## User Scenarios & Testing

### User Story 1 — Storage Config Alias Routes (Priority: P1)

An operator opens the Storage settings page for a project. The page calls `/platform/projects/{ref}/storage/config` (GET) and saves changes via PATCH on the same path. Currently these paths are stubs and return empty/error responses. The operator expects to read and update storage configuration (file size limit, image transformation, S3 protocol toggle) without errors.

**Why this priority**: The `/storage/config` GET/PATCH pair shares the same data as the existing `/config/storage` route but uses a different URL path. Studio's S3 settings page calls both paths. Without this, the storage settings page crashes or shows stale data.

**Independent Test**: Can be tested by calling `GET /platform/projects/{ref}/storage/config` and verifying it returns a valid `StorageConfigResponse`-shaped object with `features.s3Protocol.enabled` present, then calling PATCH and verifying changes persist.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** `GET /platform/projects/{ref}/storage/config` is called, **Then** it returns a `StorageConfigResponse`-shaped object identical to `GET /platform/projects/{ref}/config/storage`.
2. **Given** an authenticated admin, **When** `PATCH /platform/projects/{ref}/storage/config` is called with a partial config body, **Then** it persists the changes and returns the merged config (same as `PATCH /platform/projects/{ref}/config/storage`).
3. **Given** an unauthenticated request, **When** either endpoint is called, **Then** it returns 401.

---

### User Story 2 — Image Transformation Config Endpoints (Priority: P2)

An operator navigates to a storage image-transformation settings page. Studio calls `GET /platform/projects/{ref}/storage/config/image-transformations` to read the current toggle state and `PATCH` to update it. Both are currently stubs.

**Why this priority**: The image transformation toggle is a sub-slice of `StorageConfigResponse.features.imageTransformation`. Exposing dedicated sub-resource endpoints follows the pattern used for auth config sub-resources.

**Independent Test**: Call `GET /platform/projects/{ref}/storage/config/image-transformations` — response must include at least `{ enabled: boolean }`. Call PATCH with `{ enabled: false }` and confirm the change is reflected in a subsequent GET of `/config/storage`.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** `GET /platform/projects/{ref}/storage/config/image-transformations` is called, **Then** it returns the `imageTransformation` slice of the storage config (`{ enabled: boolean }`).
2. **Given** an authenticated admin, **When** `PATCH /platform/projects/{ref}/storage/config/image-transformations` is called with `{ enabled: false }`, **Then** the change persists and future GETs of `/config/storage` show `features.imageTransformation.enabled = false`.
3. **Given** an invalid ref, **When** either endpoint is called, **Then** a graceful 404 or empty default is returned (project not found path handled like other config routes).

---

### User Story 3 — S3 Connection Config Endpoints (Priority: P3)

An operator wants to review or configure the external S3 connection settings for a project. Studio may call `GET /platform/projects/{ref}/storage/config/s3-connection` to read settings and `POST` to configure them. `DELETE` removes the S3 connection config. These are currently stubs.

**Why this priority**: These endpoints are cosmetic/low-traffic (⚪ in API-STUBS.md) and not in `platform.d.ts`. Supastack uses embedded MinIO rather than an external S3 backend, so these return sensible no-op responses.

**Independent Test**: Call `GET /platform/projects/{ref}/storage/config/s3-connection` — response must be a valid JSON object (empty `{}` or appropriate shape) with status 200. POST and DELETE must return 200/204 without errors.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** `GET /platform/projects/{ref}/storage/config/s3-connection` is called, **Then** it returns 200 with an empty or default S3 connection object.
2. **Given** an authenticated admin, **When** `POST /platform/projects/{ref}/storage/config/s3-connection` is called with config body, **Then** it returns 200 (no-op accepted).
3. **Given** an authenticated admin, **When** `DELETE /platform/projects/{ref}/storage/config/s3-connection` is called, **Then** it returns 204.

---

### User Story 4 — S3 Credentials Sub-Resource (Priority: P4)

Endpoints `POST /platform/projects/{ref}/storage/config/s3-connection/credentials` and `DELETE /platform/projects/{ref}/storage/config/s3-connection/credentials` manage S3 access keys scoped to the connection config. Currently stubs.

**Why this priority**: ⚪ cosmetic/low-traffic. These are distinct from the already-working `/platform/storage/{ref}/credentials` proxy (which manages S3 protocol keys, not connection-level credentials).

**Independent Test**: POST returns a 200/201 with a stub credential object. DELETE returns 204.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** `POST /platform/projects/{ref}/storage/config/s3-connection/credentials` is called, **Then** it returns 200/201 with a credential-shaped response.
2. **Given** an authenticated admin, **When** `DELETE /platform/projects/{ref}/storage/config/s3-connection/credentials` is called, **Then** it returns 204.

---

### User Story 5 — Bucket Bulk Operations (Priority: P5)

Studio may call `DELETE /platform/projects/{ref}/storage/buckets` or `PATCH /platform/projects/{ref}/storage/buckets` for bulk bucket operations. Currently stubs.

**Why this priority**: 🔴 self-hosted-relevant per API-STUBS.md, but no Studio data layer file was found calling these paths. Safest implementation is a no-op stub returning appropriate success status until Studio call sites are confirmed.

**Independent Test**: PATCH and DELETE both return 200/204 without errors.

**Acceptance Scenarios**:

1. **Given** an authenticated admin, **When** `PATCH /platform/projects/{ref}/storage/buckets` is called, **Then** it returns 200 `{}`.
2. **Given** an authenticated admin, **When** `DELETE /platform/projects/{ref}/storage/buckets` is called, **Then** it returns 204.

---

### Edge Cases

- What happens when the project ref does not exist? → Return 404 consistent with other config endpoints.
- What happens when storage config has never been saved? → Return the `STORAGE_CONFIG_DEFAULTS` (same as existing `/config/storage` GET).
- What if PATCH body is empty `{}`? → Return current config unchanged (same as existing PATCH behaviour).

## Requirements

### Functional Requirements

- **FR-001**: `GET /platform/projects/{ref}/storage/config` MUST return the same response as `GET /platform/projects/{ref}/config/storage` — the full `StorageConfigResponse`.
- **FR-002**: `PATCH /platform/projects/{ref}/storage/config` MUST persist changes via the same storage mechanism as `PATCH /platform/projects/{ref}/config/storage`.
- **FR-003**: `GET /platform/projects/{ref}/storage/config/image-transformations` MUST return `{ enabled: boolean }` from the `features.imageTransformation` slice of stored config.
- **FR-004**: `PATCH /platform/projects/{ref}/storage/config/image-transformations` MUST update `features.imageTransformation.enabled` in stored config.
- **FR-005**: `GET /platform/projects/{ref}/storage/config/s3-connection` MUST return 200 with an empty or default S3 connection shape.
- **FR-006**: `POST /platform/projects/{ref}/storage/config/s3-connection` MUST return 200 (accepted, no-op for embedded MinIO deployments).
- **FR-007**: `DELETE /platform/projects/{ref}/storage/config/s3-connection` MUST return 204.
- **FR-008**: `POST /platform/projects/{ref}/storage/config/s3-connection/credentials` MUST return 200/201 with a stub credential object.
- **FR-009**: `DELETE /platform/projects/{ref}/storage/config/s3-connection/credentials` MUST return 204.
- **FR-010**: `PATCH /platform/projects/{ref}/storage/buckets` MUST return 200 `{}` (no-op until bulk bucket operation semantics are confirmed).
- **FR-011**: `DELETE /platform/projects/{ref}/storage/buckets` MUST return 204 (no-op until bulk bucket operation semantics are confirmed).
- **FR-012**: All 11 endpoints MUST require authentication and return 401 for unauthenticated requests.
- **FR-013**: Implementation MUST use `app.requireAuth(req)` consistent with all other `/platform/projects/*` handlers.

### Key Entities

- **StorageConfig**: Stored in `project_config_snapshots` with `surface = 'storage'`. Shape defined by `STORAGE_CONFIG_DEFAULTS` in `platform-misc.ts`. Accessed via `loadStorageConfig(ref)`.

## Success Criteria

### Measurable Outcomes

- **SC-001**: All 11 stub endpoints return non-500 responses for valid authenticated requests, eliminating the "stub" status in `API-STUBS.md`.
- **SC-002**: Storage settings pages (config, S3, image transformations) load without errors in the Studio dashboard.
- **SC-003**: `GET /platform/projects/{ref}/storage/config` returns data byte-identical to `GET /platform/projects/{ref}/config/storage` for the same project.
- **SC-004**: Unit tests cover all 11 endpoints with both happy-path and error-path cases.

## Assumptions

- These 11 paths are NOT in `platform.d.ts` — they are called by Studio but not part of the canonical OpenAPI contract. No contract test drift risk.
- The `/storage/config` aliases delegate to the same `loadStorageConfig` / `STORAGE_CONFIG_DEFAULTS` infrastructure used by `/config/storage` — no separate data store.
- S3 connection endpoints (`/config/s3-connection` and `/config/s3-connection/credentials`) are no-ops for self-hosted supastack deployments that use embedded MinIO via the storage-api service.
- Bulk bucket operations (`PATCH/DELETE /storage/buckets`) have no confirmed Studio caller — safe to implement as 200/204 no-ops pending clarification.
- The existing `STORAGE_CONFIG_DEFAULTS` and `loadStorageConfig` helpers in `apps/api/src/routes/platform-misc.ts` are reused as-is.
- Branch: `114-storage-stubs` (created by speckit-git-feature pre-hook).
