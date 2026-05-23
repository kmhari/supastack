# Feature Specification: Postgres Public Endpoint via SNI Routing

**Feature Branch**: `005-postgres-public-endpoint`

**Created**: 2026-05-23

**Status**: Draft

**Input**: GitHub issue [kmhari/selfbase#3](https://github.com/kmhari/selfbase/issues/3)

## Clarifications

### Session 2026-05-23

- Q: Should the spec mandate an automated E2E shell test for `supabase db push` without `--db-url`? → A: Yes — create a dedicated `tests/cli-e2e/db-push.sh` script covering all database CLI commands (`db push`, `db pull`, `db diff`, `migration list`, `inspect db`). Separate from the existing `deploy-hello.sh` to keep database command testing isolated and runnable independently.

**Cross-refs**:
- Depends on: [kmhari/selfbase#2](https://github.com/kmhari/selfbase/issues/2) (wildcard cert, feature 004 — **complete**)
- Unblocks: `supabase db push/pull/diff/migration/inspect` without `--db-url`
- Unblocks: correct Studio "Direct connection" string display

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Connect supabase CLI database commands without a custom DB URL (Priority: P1)

A developer has linked their supabase CLI to a selfbase project and wants to run database operations — push migrations, pull the schema, run diffs, or inspect the database — the same way they do against Supabase Cloud. Today selfbase's per-instance Postgres is only reachable on a host-allocated high port (`<vm-ip>:<portPostgres>`, typically 30000+), which the upstream CLI doesn't know about. The CLI computes the target host as `db.<ref>.<apex>:5432` from the project profile and times out connecting.

After this feature: when the operator connects their CLI (`supabase link` or `supabase login --profile`), `supabase db push`, `supabase db pull`, `supabase db diff`, `supabase migration list`, and every `supabase inspect *` sub-command all work at `db.<ref>.<apex>:5432` without any extra flags.

**Why this priority**: The database commands are the most common daily workflow for backend developers. Without this, selfbase is not a usable self-hosted Supabase drop-in for any project that runs migrations.

**Independent Test**: Run `tests/cli-e2e/db-push.sh` (a dedicated E2E script, separate from the existing `deploy-hello.sh`) with `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, and `SELFBASE_DB_PASSWORD` set. The script creates a throwaway migration, runs `supabase db push --project-ref <ref>` without `--db-url`, asserts exit 0, and rolls back. The connection target resolved by the CLI (`db.<ref>.<apex>:5432`) must be reachable with a valid TLS certificate (the wildcard `*.<apex>` cert).

**Acceptance Scenarios**:

1. **Given** a selfbase deployment with a wildcard TLS certificate and at least one provisioned project, **When** a developer runs `supabase db push --project-ref <ref>` (no `--db-url` flag), **Then** the CLI connects to `db.<ref>.<apex>:5432` over TLS and applies pending migrations successfully.
2. **Given** the same deployment, **When** a developer runs `supabase db pull`, `supabase db diff`, `supabase migration list`, or `supabase inspect *`, **Then** each command connects without the `--db-url` flag and returns correct output.
3. **Given** a project that was provisioned before this feature shipped, **When** the operator reloads selfbase (Caddy config reloads automatically), **Then** `db.<ref>.<apex>:5432` starts working for that project immediately — no per-project migration or restart required.
4. **Given** a developer with a direct connection URL using the old `<vm-ip>:<portPostgres>` form, **When** this feature ships, **Then** that existing URL continues to work — the per-instance high port is still exposed and functional.

---

### User Story 2 — Studio shows a correct "Direct connection" string (Priority: P1)

Per-instance Studio currently shows `127.0.0.1:5432` in the "Direct connection" panel — an internal placeholder that means nothing to the developer. This is because selfbase has no public-facing canonical Postgres host to provide to Studio at provisioning time.

After this feature: Studio shows `db.<ref>.<apex>:5432` with a `[YOUR-PASSWORD]` placeholder for the Postgres password — matching the Supabase Cloud display format and giving the developer a real, copy-pastable connection string.

**Why this priority**: The "Direct connection" panel is a first-stop for developers integrating ORMs, migration tools, or direct SQL clients. A broken/placeholder value erodes trust in the platform and forces developers to go hunting for the correct host:port.

**Independent Test**: After provisioning a new instance and loading its Studio UI, the "Direct connection" panel shows `db.<ref>.<apex>:5432` (not `127.0.0.1:5432` or `db:5432`) alongside the correct database name and `[YOUR-PASSWORD]` placeholder.

**Acceptance Scenarios**:

1. **Given** a new project provisioned after this feature ships, **When** the operator opens Studio for that project, **Then** the "Direct connection" panel displays `db.<ref>.<apex>:5432` as the host:port.
2. **Given** an existing project provisioned before this feature shipped, **When** the operator triggers a Caddy config reload (e.g. by provisioning any new project, or via the dashboard restart action), **Then** Studio for the existing project is updated to show the correct host at next startup.
3. **Given** a deployment where no apex domain is configured, **When** Studio loads for a project, **Then** it falls back gracefully (shows the internal host or a message indicating the apex must be configured) without breaking the Studio UI.

---

### Edge Cases

- A project ref contains characters that are invalid in a hostname: selfbase already enforces `^[a-z]{20}$` on refs, so `db.<ref>.<apex>` is always a valid DNS label — no edge case here.
- The wildcard cert has expired or been disabled: TLS termination at `:5432` fails with a cert error; the developer sees a TLS handshake failure rather than a clean Postgres error. The operator must renew/re-enable the wildcard cert first. This is the expected degraded-mode behavior and requires no special handling.
- Two projects provisioned simultaneously and the Caddy config is rebuilding: Caddy's atomic config reload ensures no connections are dropped mid-stream; the new projects appear in routing once the reload completes.
- A developer connects via psql using `sslmode=disable`: Caddy's L4 SNI routing requires a TLS ClientHello to read the server name. Connections without TLS negotiation can't be SNI-routed and are dropped. The requirement is TLS — `sslmode=require` (the default for `supabase db push` and `psql` with the CLI's computed URL).
- Caddy has not yet loaded the wildcard cert (fresh boot before wizard completes): the `:5432` listener is active but TLS handshakes fail. This is acceptable — the feature docs state the wildcard cert is a prerequisite.
- Many instances (100+) making the layer4 routing table large: each instance adds one routing entry; the routing lookup is O(n) but n is bounded by the instance count. No degradation at realistic scale.

## Requirements *(mandatory)*

### Functional Requirements

#### Postgres TLS/SNI Routing

- **FR-001**: The selfbase deployment MUST accept TCP connections on port 5432 at the public-facing IP/hostname. When a TLS ClientHello arrives, the deployment MUST inspect the SNI field and route the connection to the matching per-instance Postgres without terminating TLS at the router (pass-through TLS is acceptable) or by terminating TLS at the router with the wildcard cert and proxying in plaintext to the per-instance Postgres (TLS offload). Either mode is valid as long as the Postgres client sees a valid TLS session.
- **FR-002**: Routing MUST be driven by the SNI hostname pattern `db.<ref>.<apex>`. Each `<ref>` MUST map to that instance's Postgres port. Connections with an unknown `<ref>` or no SNI MUST be rejected cleanly (TCP RST or TLS alert) without revealing information about other instances.
- **FR-003**: The routing table MUST be regenerated automatically when instances are provisioned or deprovisioned, with no manual intervention required by the operator. Specifically, the same mechanism that updates Caddy's HTTP routing (currently `reloadCaddy()` after instance lifecycle events) MUST also update the port-5432 routing table.
- **FR-004**: Routing MUST cover all provisioned, non-deleted instances. A project provisioned before this feature shipped MUST work immediately after the first Caddy config reload — no per-instance migration required.

#### Studio Connection String

- **FR-005**: When selfbase provisions a new Supabase instance, it MUST pass `db.<ref>.<apex>` as the public-facing Postgres hostname to the Studio container's environment (`POSTGRES_HOST` or equivalent). If no apex domain is configured, Studio MUST receive a fallback value that avoids showing an internal placeholder.
- **FR-006**: Studio's "Direct connection" string MUST display `db.<ref>.<apex>:5432` alongside `[YOUR-PASSWORD]` as the password placeholder, matching the Supabase Cloud display convention, once an apex domain is configured.

#### Backward Compatibility

- **FR-007**: The existing per-instance Postgres high port (`<vm-ip>:<portPostgres>`) MUST remain reachable. Any existing `--db-url` connections or direct psql sessions using the old form continue working unchanged.
- **FR-008**: Instances running before this feature ships MUST be automatically reachable at `db.<ref>.<apex>:5432` after the first Caddy config reload — no operator-side per-project action required.

#### Infrastructure

- **FR-009**: Port 5432 MUST be published from the Caddy container to the host's network interface. This makes `db.<ref>.<apex>:5432` reachable from external clients (developers' machines, CI pipelines, etc.).
- **FR-010**: The Postgres traffic MUST be protected by the same wildcard TLS certificate that covers `*.<apex>`. No separate certificate or CA is required. The wildcard cert (issued in feature 004) is the authoritative certificate for all subdomains including `db.*.<apex>`.

### Key Entities

- **L4 Route Entry**: A mapping from SNI pattern (`db.<ref>.<apex>`) to a Postgres upstream (`host.docker.internal:<portPostgres>`). One entry per active instance. The complete set of entries is rebuilt on every Caddy config reload.
- **Studio Postgres Host**: The externally-reachable hostname for a given instance's Postgres. Previously an internal Docker hostname (`db`), now `db.<ref>.<apex>`. Stored in the per-instance Docker Compose environment and regenerated on Caddy reload (or at instance creation time if the apex is already set).
- **db-push E2E Test Script** (`tests/cli-e2e/db-push.sh`): A dedicated shell script that validates all database CLI commands against a live selfbase deployment. Env vars: `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, `SELFBASE_DB_PASSWORD`. Separate from the functions-deploy script (`deploy-hello.sh`) so database tests can be run independently.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase db push` with no `--db-url` flag exits 0 and applies pending migrations on a selfbase project. Verified by running `tests/cli-e2e/db-push.sh` against a live deployment with `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF`, and `SELFBASE_DB_PASSWORD` set.
- **SC-002**: Every supabase CLI database sub-command covered in `tests/cli-e2e/db-push.sh` — `db push`, `db pull`, `db diff`, `migration list`, `inspect db` — exits 0 or returns expected output with no `--db-url` flag, verified by the same script.
- **SC-003**: A project provisioned before this feature shipped becomes reachable at `db.<ref>.<apex>:5432` within 60 seconds of the first Caddy config reload — with no per-project restart or operator action.
- **SC-004**: The "Direct connection" panel in Studio shows `db.<ref>.<apex>:5432` for newly provisioned instances. Measured by opening the Studio UI for a project created after this feature is deployed.
- **SC-005**: An existing `--db-url postgresql://postgres:<pwd>@<vm-ip>:<portPostgres>/postgres` connection string remains functional — confirmed by connecting with psql and running a query.
- **SC-006**: The documentation change removes the "db push requires --db-url" caveat from `docs/supabase-cli.md`, and the updated instructions work end-to-end.

## Assumptions

- The wildcard TLS certificate (feature 004, spec `specs/004-wildcard-cert-dns01/`) is issued and active before this feature is deployed. The `db.<ref>.<apex>` hostname is covered by `*.<apex>`.
- Selfbase uses Caddy as the sole public TLS/TCP gateway. No other component listens on port 5432 of the host machine.
- The supabase CLI uses `sslmode=require` (or equivalent) when connecting to `db.<ref>.<apex>:5432`. Connections without TLS negotiation cannot be SNI-routed and are not a supported path.
- Each per-instance Postgres listens on a unique host port (`portPostgres` column in `supabase_instances`), allocated from the existing port pool. No port re-allocation or schema change is needed.
- The Caddy layer4 routing module (or equivalent SNI proxy capability) must be included in the selfbase Caddy build. This requires a custom Caddy Dockerfile (already anticipated in issue #3 and not incompatible with the stock Caddy image used by feature 004).
- Studio's "Direct connection" display is driven by an environment variable (`POSTGRES_HOST` or similar) injected at container start time. Changing this value for existing instances requires a container restart — this is an acceptable one-time disruption per the backward-compat migration story in issue #3.
- The Postgres password for any instance is never exposed via the Studio UI or any selfbase endpoint. Only the `[YOUR-PASSWORD]` placeholder is shown, consistent with Supabase Cloud's display convention.
