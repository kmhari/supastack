# Feature Specification: Postgres Public Endpoint via Top-Level Pooler

**Feature Branch**: `005-postgres-public-endpoint`

**Created**: 2026-05-23

**Status**: Updated — architecture pivoted from Caddy L4 to top-level pooler

**Input**: GitHub issue [kmhari/selfbase#3](https://github.com/kmhari/selfbase/issues/3)

**Cross-refs**:
- Depends on: [kmhari/selfbase#2](https://github.com/kmhari/selfbase/issues/2) (wildcard cert, feature 004 — **complete**)
- Unblocks: `supabase db push/pull/diff/migration/inspect` without `--db-url`
- Unblocks: correct Studio "Direct connection" string display

## Clarifications

### Session 2026-05-23

- Q: Should the spec mandate an automated E2E shell test for `supabase db push` without `--db-url`? → A: Yes — create a dedicated `tests/cli-e2e/db-push.sh` script covering all database CLI commands (`db push`, `db pull`, `db diff`, `migration list`, `inspect db`). Separate from the existing `deploy-hello.sh`.
- Q: How is the Postgres traffic routed from `db.<ref>.<apex>:5432` to the right per-instance Postgres? → A: A **top-level multi-tenant pooler** (a single selfbase control-plane service) handles TLS termination using the wildcard cert, extracts the tenant ref from the SNI hostname, and proxies to the matching per-instance Postgres. Initial attempt to do this in Caddy via SNI routing was abandoned because the upstream caddy-l4 module's Postgres matcher cannot complete the Postgres STARTTLS handshake (no `'S'` response). The top-level pooler approach matches Supabase Cloud's architecture and adds free connection pooling.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Connect supabase CLI database commands without a custom DB URL (Priority: P1)

A developer has linked their supabase CLI to a selfbase project and wants to run database operations — push migrations, pull the schema, run diffs, or inspect the database — the same way they do against Supabase Cloud. The upstream CLI computes the target host as `db.<ref>.<apex>:5432` from the project profile. Today selfbase has no public Postgres endpoint at that hostname, so every command times out.

After this feature: every supabase CLI database sub-command works at `db.<ref>.<apex>:5432` without any extra flags. The same connection string also works for psql, pg-dump, every Postgres ORM, and every third-party tool that speaks the standard Postgres protocol.

**Why this priority**: Database commands are the most common daily workflow for backend developers. Without this, selfbase is not a usable self-hosted Supabase drop-in for any project that runs migrations.

**Independent Test**: Run `tests/cli-e2e/db-push.sh` (a dedicated E2E script) with `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, and `SELFBASE_DB_PASSWORD` set. The script creates a throwaway migration, runs `supabase db push --project-ref <ref>` without `--db-url`, asserts exit 0, and rolls back. The connection target resolved by the CLI (`db.<ref>.<apex>:5432`) must be reachable with a valid TLS certificate (the wildcard `*.<apex>` cert).

**Acceptance Scenarios**:

1. **Given** a selfbase deployment with a wildcard TLS certificate and at least one provisioned project, **When** a developer runs `supabase db push --project-ref <ref>` (no `--db-url` flag), **Then** the CLI connects to `db.<ref>.<apex>:5432` over TLS and applies pending migrations successfully.
2. **Given** the same deployment, **When** a developer runs `supabase db pull`, `supabase db diff`, `supabase migration list`, or `supabase inspect *`, **Then** each command connects without the `--db-url` flag and returns correct output.
3. **Given** a project that was provisioned before this feature shipped, **When** the operator deploys this feature and the migration runs, **Then** `db.<ref>.<apex>:5432` starts working for that project immediately — no per-project restart or operator action required.
4. **Given** a developer with a direct connection URL using the old `<vm-ip>:<portPostgres>` form, **When** this feature ships, **Then** that existing URL continues to work — the per-instance high port is still exposed and functional.
5. **Given** 50 concurrent client connections to the same project's Postgres endpoint, **When** load is sustained for 5 minutes, **Then** the connection pooler maintains a bounded number of upstream Postgres connections (not 50) and end-to-end latency stays under typical Postgres direct-connect benchmarks.

---

### User Story 2 — Studio shows a correct "Direct connection" string (Priority: P1)

Per-instance Studio currently shows `127.0.0.1:5432` or `db:5432` in the "Direct connection" panel — an internal placeholder that means nothing to the developer. This is because selfbase has no public-facing canonical Postgres host to provide to Studio at provisioning time.

After this feature: Studio shows `db.<ref>.<apex>:5432` with a `[YOUR-PASSWORD]` placeholder, matching Supabase Cloud's display format and giving the developer a real, copy-pastable connection string.

**Why this priority**: The "Direct connection" panel is a first-stop for developers integrating ORMs, migration tools, or direct SQL clients. A broken placeholder erodes trust and forces developers to go hunting for the correct host:port.

**Independent Test**: After provisioning a new instance and loading its Studio UI, the "Direct connection" panel shows `db.<ref>.<apex>:5432` (not `127.0.0.1:5432` or `db:5432`) alongside the correct database name and `[YOUR-PASSWORD]` placeholder.

**Acceptance Scenarios**:

1. **Given** a new project provisioned after this feature ships, **When** the operator opens Studio for that project, **Then** the "Direct connection" panel displays `db.<ref>.<apex>:5432` as the host:port.
2. **Given** an existing project provisioned before this feature shipped, **When** the operator triggers a per-instance container restart (or after the next provisioning event causes a Caddy reload), **Then** Studio for the existing project is updated to show the correct host at next startup.
3. **Given** a deployment where no apex domain is configured, **When** Studio loads for a project, **Then** it falls back gracefully (shows the internal host or a message indicating the apex must be configured) without breaking the Studio UI.

---

### User Story 3 — Operator sees pooler health and per-project connection metrics (Priority: P2)

The top-level pooler concentrates traffic for every project's Postgres. If it goes down, every project loses external DB access simultaneously. The operator needs visibility into pooler health and per-project connection counts to detect saturation, runaway clients, or pool exhaustion.

**Why this priority**: This is correctness/operability rather than feature parity. Lower priority than US1/US2 but essential for production deployments. P2 because the pooler exposes its own metrics and operators can use those directly even before selfbase wires them into the dashboard.

**Independent Test**: From the dashboard's TLS/Database section, an operator can see: pooler service status (running / down), current connection count per project, pool size limits per project, and the timestamp of the last successful health check.

**Acceptance Scenarios**:

1. **Given** the pooler is running, **When** the operator opens the dashboard Database health panel, **Then** they see "Pooler: healthy" with the connection count and pool size displayed.
2. **Given** the pooler has crashed, **When** the operator opens the same panel, **Then** they see "Pooler: down" with a timestamp of the last successful health check and instructions to check container logs.
3. **Given** a project hits its pool size limit, **When** new connections arrive, **Then** they queue without dropping (the standard pooler behavior) and the dashboard shows the saturation warning for that project.

---

### Edge Cases

- A project is created but the tenant registration with the top-level pooler fails (e.g., transient DB error): the project creation MUST fail atomically with a clear error rather than leaving the project in a half-registered state. The api retries the registration on the next provisioning step or via an explicit "re-register" dashboard action.
- A project is deleted but the tenant row in the pooler isn't cleaned up: the orphan tenant points at a non-existent backend; connections to it MUST fail fast with a clean error, not hang. A periodic reconciler removes orphan tenants on a daily schedule.
- The pooler is upgraded or restarted: in-flight connections are dropped but the pooler comes back within seconds. The operator-facing impact is brief; clients reconnect automatically (standard Postgres client behavior).
- A client connects with `sslmode=disable`: the pooler MAY reject (since the wildcard cert is the security boundary) or MAY accept depending on policy. Default behavior: reject (require TLS) for parity with Supabase Cloud.
- A client uses the `postgres.<ref>` username format (the supavisor multi-tenant convention) instead of relying on SNI: BOTH paths MUST work, with SNI taking precedence when both are present.
- The wildcard cert is rotated (renewed): the pooler MUST pick up the new cert without a restart (file watch or reload signal), so clients don't see a stale cert during the rollover window.
- The pooler exhausts its global connection limit across all tenants: subsequent connections receive a clear "pool exhausted" error rather than hanging. The operator can raise the limit via a single config change.

## Requirements *(mandatory)*

### Functional Requirements

#### External Postgres Endpoint

- **FR-001**: Selfbase MUST accept TCP connections on port 5432 at the deployment's public IP/hostname. Connections destined for `db.<ref>.<apex>:5432` MUST be terminated with the wildcard TLS certificate, demultiplexed by tenant ref extracted from the SNI hostname, and proxied to the per-instance Postgres backend.
- **FR-002**: A SINGLE top-level pooler service MUST handle ALL external Postgres traffic for the deployment. There MUST NOT be one pooler per project at the external-facing edge.
- **FR-003**: The pooler MUST support per-tenant connection pooling. Each project gets a configurable pool size (default 20 connections) shared across all its external clients. Pool size MUST be tunable per project from the dashboard.
- **FR-004**: The pooler MUST respond correctly to the Postgres STARTTLS handshake (SSLRequest → 'S' → TLS ClientHello → certificate negotiation). Standard Postgres clients (psql, libpq, `supabase` CLI, every supabase-js variant, every Postgres ORM) MUST be able to connect without any client-side workaround or non-standard flags.

#### Tenant Registration Lifecycle

- **FR-005**: When a project is provisioned, the platform MUST register the project as a tenant in the top-level pooler. The registration includes: tenant key (the 20-char ref), upstream Postgres host:port (internal), database name, the per-instance Postgres password.
- **FR-006**: When a project is deleted, the platform MUST remove the corresponding tenant from the pooler within the same transaction. Orphan tenants (no matching project) MUST be detected and cleaned up by a periodic reconciler running at least daily.
- **FR-007**: For projects that exist BEFORE this feature ships, a one-time migration MUST backfill tenant rows in the pooler so those projects work via the new external endpoint immediately upon upgrade. No per-project operator action required.
- **FR-008**: If tenant registration fails during project provisioning, the project creation MUST roll back cleanly so the operator does not end up with a "half-created" project. The error message MUST identify the registration step as the failure point.

#### Studio Connection String

- **FR-009**: When selfbase provisions a new Supabase instance, it MUST configure the per-instance Studio container so its "Direct connection" panel displays `db.<ref>.<apex>:5432` as the host:port, alongside a `[YOUR-PASSWORD]` placeholder.
- **FR-010**: For an instance provisioned before this feature shipped, the next container restart MUST pick up the corrected display value.

#### Backward Compatibility

- **FR-011**: The existing per-instance Postgres direct host port (`<vm-ip>:<portPostgres>`) MUST remain reachable. Any existing `--db-url` connections or direct psql sessions using the old form continue working unchanged.
- **FR-012**: Adding the top-level pooler MUST NOT require any change to the per-instance Postgres containers themselves (Postgres images, configs, ports stay the same internally). Only the external-facing endpoint changes.

#### Operator Visibility & Recovery

- **FR-013**: The dashboard MUST show the pooler's health status (running, degraded, down) and per-project connection counts. The data source is the pooler's own metrics endpoint.
- **FR-014**: When the pooler is unhealthy, the dashboard MUST display an actionable banner with a one-click link to recovery steps (restart pooler, check logs).
- **FR-015**: Every tenant registration, removal, and pooler restart MUST be recorded in the existing audit log.

### Key Entities

- **Top-Level Pooler**: A single multi-tenant Postgres connection pooler running in the selfbase control plane. Terminates TLS using the wildcard cert. Maintains a tenant registry and per-tenant connection pools. Exposes port 5432 externally; metrics endpoint internally.
- **Pooler Tenant**: One row per project. Stores the project ref (used as the SNI subdomain), upstream Postgres host:port (internal Docker hostname for the per-instance db), database name, encrypted Postgres password. Lifecycle bound to the project (create on provision, delete on destroy).
- **db-push E2E Test Script** (`tests/cli-e2e/db-push.sh`): A dedicated shell script that validates all database CLI commands against a live selfbase deployment. Env vars: `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, `SELFBASE_DB_PASSWORD`. Separate from the functions-deploy script.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase db push` with no `--db-url` flag exits 0 and applies pending migrations on a selfbase project. Verified by running `tests/cli-e2e/db-push.sh` against a live deployment.
- **SC-002**: Every supabase CLI database sub-command covered in `tests/cli-e2e/db-push.sh` — `db push`, `db pull`, `db diff`, `migration list`, `inspect db` — exits 0 or returns expected output with no `--db-url` flag.
- **SC-003**: Across a deployment with 10 active instances, all 10 are reachable via `db.<ref>.<apex>:5432` from a single test runner within 60 seconds of the pooler starting up. No per-project setup needed.
- **SC-004**: The "Direct connection" panel in Studio shows `db.<ref>.<apex>:5432` for newly provisioned instances.
- **SC-005**: An existing `--db-url postgresql://postgres:<pwd>@<vm-ip>:<portPostgres>/postgres` connection string remains functional — confirmed by connecting with psql and running a query.
- **SC-006**: 50 concurrent client connections to one project's pooler-fronted Postgres endpoint result in fewer than 25 actual upstream Postgres connections (pooling effective). End-to-end latency for `SELECT 1` stays under 50ms p95.
- **SC-007**: After a pooler crash + restart cycle, all clients can reconnect successfully within 10 seconds. No project requires manual intervention to recover.
- **SC-008**: A project provisioned before this feature shipped becomes reachable at `db.<ref>.<apex>:5432` immediately after the feature deploy finishes (backfill migration runs as part of deploy). No per-project restart or operator action.

## Assumptions

- The wildcard TLS certificate (feature 004) is issued and active before this feature is deployed. The `db.<ref>.<apex>` hostname is covered by `*.<apex>`.
- The top-level pooler used is **Supabase Supavisor** (the same multi-tenant pooler used by Supabase Cloud). It natively supports SNI-based tenant routing, the Postgres STARTTLS handshake, TLS termination, per-tenant connection pooling, and a tenant metadata schema in a Postgres database. This is the same software image already used (per-instance) in selfbase's compose stack, so it is a known-good dependency.
- Supavisor's tenant metadata is stored in the selfbase control-plane Postgres (the `db` service in `infra/docker-compose.yml`) using a dedicated schema. No new database is required.
- Per-instance Postgres containers remain on the per-instance Docker network and accept connections from the top-level pooler via a Docker network bridge OR via host port mappings. The exact networking topology is a planning concern, not a spec concern.
- The supabase CLI uses `sslmode=require` (or higher) when connecting to `db.<ref>.<apex>:5432`. SSL is mandatory; plaintext connections are rejected. This matches Supabase Cloud's policy.
- Connection pooling defaults (pool size 20, max client connections 100, transaction-mode pooling) match Supabase Cloud defaults. Operators can tune per-project from the dashboard.
- The platform's existing master-key encryption mechanism is appropriate for protecting tenant passwords stored in the pooler's metadata. No new key management infrastructure required.
- "Existing instance" backfill is implemented as part of the feature deploy script: for each row in `supabase_instances`, decrypt the postgres password from `encrypted_secrets`, INSERT a tenant row into the pooler metadata. Idempotent — safe to re-run.
- The pooler's metrics endpoint exposes Prometheus-format metrics that the dashboard can scrape and display.
- The earlier attempt to do SNI routing in Caddy via `caddy-l4` is now considered out of scope and reverted. The L4 block in `caddy-config.ts` and the custom `apps/caddy/Dockerfile` (xcaddy + caddy-l4) are no longer required for THIS feature. They may be kept for unrelated future use (e.g., raw TCP forwarding to other services) but contribute nothing here.
