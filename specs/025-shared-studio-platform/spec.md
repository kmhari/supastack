# Feature Specification: Shared Studio (IS_PLATFORM=true)

**Feature Branch**: `083-shared-studio-platform`

**Created**: 2026-06-01

**Status**: Draft

**Input**: Replace per-project Studio containers with a single shared IS_PLATFORM=true Studio service hosted at the apex domain, backed by platform proxy routes in the Supastack API.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Access Database Editor for Any Project (Priority: P1)

An operator opens their browser, navigates to `https://<apex>/project/<ref>/editor`, and sees the Supabase Studio database editor with their project's tables, views, and data — without installing anything locally or opening a per-project port.

**Why this priority**: The table editor, SQL editor, and schema visualiser are the highest-value Studio features. If these work, the shared Studio delivers its primary value proposition and the migration is viable.

**Independent Test**: With the shared Studio running at the apex and one provisioned project, navigate to `/project/<ref>/editor`. Verify that the tables list loads, a SQL query can be executed, and results are returned — all without any per-project Studio container running.

**Acceptance Scenarios**:

1. **Given** a provisioned project with tables in its database, **When** an authenticated operator navigates to `https://<apex>/project/<ref>/editor`, **Then** the table list loads and a `SELECT 1` query returns a result row.
2. **Given** the shared Studio is the only Studio running (no per-project studio containers), **When** an operator switches between two different project refs in the URL, **Then** each project shows its own schema and data without any cross-project leakage.
3. **Given** the shared Studio is running, **When** the operator is not authenticated, **Then** they are redirected to the sign-in page.

---

### User Story 2 — Access Auth, Storage, and Edge Functions Management (Priority: P2)

An operator uses the shared Studio to manage auth users, storage buckets, and edge functions for any of their provisioned projects — the same pages they would use on Supabase Cloud.

**Why this priority**: Auth and storage management are the next most critical Studio surfaces after the database editor. A shared Studio that only serves the DB editor is incomplete.

**Independent Test**: Navigate to `/project/<ref>/auth/users`, create a test user, then navigate to `/project/<ref>/storage`, create a bucket, and upload a file. Both operations complete successfully against the real per-project services.

**Acceptance Scenarios**:

1. **Given** a project with no auth users, **When** an operator navigates to `https://<apex>/project/<ref>/auth/users` and creates a user, **Then** the user appears in the list and exists in that project's GoTrue instance.
2. **Given** a project with no storage buckets, **When** an operator navigates to `https://<apex>/project/<ref>/storage` and creates a bucket, **Then** the bucket appears and files can be uploaded to it.
3. **Given** two different projects, **When** an operator views auth users for project A then project B, **Then** each shows only that project's users — not a merged list.

---

### User Story 3 — Shared Studio Served at Apex Root (Priority: P3)

The operator's platform URL (`https://<apex>/`) shows the Supabase Studio multi-project dashboard instead of a separate Supastack web SPA. The setup wizard and admin-only pages remain accessible at `/setup*`.

**Why this priority**: Hosting Studio at the apex eliminates the need for a separate subdomain or path prefix, simplifies the URL structure, and makes the platform feel like a true Supabase Cloud equivalent.

**Independent Test**: Navigate to `https://<apex>/`. Verify the Studio project list page loads and shows all provisioned projects. Navigate to `https://<apex>/setup`. Verify the setup wizard still loads correctly.

**Acceptance Scenarios**:

1. **Given** the shared Studio is deployed, **When** an operator navigates to `https://<apex>/`, **Then** the Studio project list page loads showing all their provisioned projects.
2. **Given** the shared Studio is at the root, **When** an operator navigates to `https://<apex>/setup`, **Then** the Supastack setup wizard loads (not Studio).
3. **Given** the shared Studio is at the root, **When** Studio makes API calls to `https://<apex>/api/v1/*`, **Then** those calls reach the Supastack Fastify API correctly.

---

### Edge Cases

- What happens when a project ref in the URL does not exist? Studio shows an error page; the proxy returns 404.
- What happens when a per-project service (Kong) is down for a specific project? The proxy returns a 502/503 for that project's requests only; other projects are unaffected.
- What happens during a project's initial provisioning (services not yet up)? Studio shows the project as paused/unavailable; no crash.
- What happens when the shared Studio container restarts? In-flight browser sessions reconnect automatically; no data loss since Studio is stateless.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: The platform MUST serve Supabase Studio at `https://<apex>/` with `IS_PLATFORM=true` enabled.
- **FR-002**: The platform MUST route all `/platform/pg-meta/:ref/*` requests to the corresponding project's pg-meta service via its Kong gateway.
- **FR-003**: The platform MUST route all `/platform/storage/:ref/*` requests to the corresponding project's Storage service via its Kong gateway.
- **FR-004**: The platform MUST route all `/platform/auth/:ref/users*` and related auth admin endpoints to the corresponding project's GoTrue service via its Kong gateway.
- **FR-005**: The platform MUST route all `/platform/projects/:ref/analytics/*` requests to the corresponding project's Analytics service via its Kong gateway.
- **FR-006**: Proxy routes MUST require valid operator authentication — unauthenticated requests return 401.
- **FR-007**: The platform MUST NOT forward the `x-connection-encrypted` header to upstream services (pg-meta connects via its own internal DB URL, not the header value).
- **FR-008**: Per-project studio containers MUST be removed from the per-project compose template so that provisioning new projects no longer starts a Studio container.
- **FR-009**: The provision worker MUST stop allocating `portStudio` for new projects.
- **FR-010**: The Caddy reverse proxy MUST give `/api/v1/*` and `/setup*` path precedence over the catch-all `/*` Studio route.
- **FR-011**: Studio MUST be able to authenticate operators using the existing Supastack session mechanism (PAT / JWT issued by the platform's auth system).
- **FR-012**: Zero modifications to Supabase Studio source code are permitted.

### Key Entities

- **Shared Studio Service**: Single control-plane container running Next.js with `IS_PLATFORM=true`, backed by `NEXT_PUBLIC_API_URL` pointing at the Supastack Fastify API.
- **Platform Proxy**: New route group in the Supastack API that resolves a project `ref` to its `portKong`, then pipes the request to the appropriate per-instance service.
- **portKong**: The dynamically allocated port for a project's Kong gateway, stored in `port_allocations` and used as the single routing key for all per-project proxying.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A provisioned project's database tables, auth users, and storage buckets are all accessible via the shared Studio within 3 seconds of page load under normal conditions.
- **SC-002**: Switching between two different projects in the shared Studio requires no page reload beyond normal navigation — data for the new project loads within 3 seconds.
- **SC-003**: New project provisioning completes without starting a Studio container — provisioning time does not increase compared to the current baseline.
- **SC-004**: The shared Studio serves all projects from a single container; resource usage for the Studio tier scales as O(1) with project count rather than O(N).
- **SC-005**: The setup wizard at `/setup*` remains fully functional after the Studio catch-all route is added — zero regression in setup flow completion rate.
- **SC-006**: All proxy routes return correct responses within the same latency bounds as direct Kong access (within 50ms overhead for the additional proxy hop).

## Assumptions

- The `portKong` value in `port_allocations` is always populated and up-to-date for active projects — this is already guaranteed by the existing provision pipeline.
- The existing Supastack session/PAT authentication is sufficient for Studio login in this phase; no new auth mechanism is needed (builds on feature 011 CLI device login PAT flow).
- Studio's Next.js `NEXT_PUBLIC_*` environment variables are baked at build time — the Studio image must be built with the correct `NEXT_PUBLIC_API_URL` for the deployment's apex domain.
- The `web` SPA's setup wizard pages (`/setup*`) do not conflict with any Studio routes — Studio does not register any routes under `/setup`.
- Existing projects' `portStudio` allocations are left in the database (column is not dropped); only new provisioning stops allocating them.
- The initial ship uses the Studio dev server (`next dev`) running inside a container rather than a production-optimised build — a production build is a follow-up hardening task.
- Authentication for Studio itself uses the platform's existing GoTrue/PAT session flow; inject-session is a development-only workaround and is not part of the production implementation.
