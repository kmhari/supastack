# Feature Specification: Cap Kong Worker Processes Per Project

**Feature Branch**: `017-kong-worker-cap`

**Created**: 2026-05-27

**Status**: Draft

**Input**: User description: "draft fix for #1 kong worker"

## Context

Each provisioned Supabase project runs its own Kong gateway container. On the production VM (`supaviser.dev`, 12 CPU cores), Kong's default `nginx_worker_processes = auto` spawns one nginx worker per host core. Each OpenResty worker loads its own LuaJIT VM with the full Kong plugin set and route table — about 120 MiB RSS per worker. With 3 active projects today, this is ~3.75 GiB of memory spent on idle gateway capacity that no realistic per-project traffic profile will ever use. As the platform scales to more projects per VM, this cost grows linearly and becomes the dominant memory consumer on the host.

The operator-facing problem is simple: per-project gateway memory is excessive relative to the actual request volume per project, which limits how many projects a single VM can host.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Operator hosts more projects per VM (Priority: P1)

As an operator running selfbase on a single VM, I want each project's gateway to consume bounded memory regardless of host CPU count, so that I can host more projects on the same hardware without provisioning a larger VM.

**Why this priority**: This is the entire point of the change. The current `auto` behavior makes per-project memory scale with host cores, which is the wrong axis — it should scale with per-project traffic. Without this fix, the platform's project density is artificially capped.

**Independent Test**: Provision a fresh project on a multi-core VM and observe that its gateway container reports ~250 MiB RSS rather than ~1.25 GiB, with no measurable change in request latency or error rate against a small load test.

**Acceptance Scenarios**:

1. **Given** a fresh selfbase VM with N ≥ 4 host cores, **When** the operator provisions a new project, **Then** the project's gateway container runs with a small, fixed number of worker processes (not N) and reports steady-state memory under 300 MiB at idle.
2. **Given** an existing VM already running projects under the old configuration, **When** the operator re-deploys the per-project gateway service via the normal compose update path, **Then** existing projects pick up the new worker cap and free the excess memory without data loss or downtime longer than a normal gateway restart.
3. **Given** a project under typical dashboard + CLI traffic, **When** comparing before and after the worker cap, **Then** request error rate and p95 latency are within normal noise (no regression attributable to fewer workers).

---

### Edge Cases

- A VM with very few host cores (1–2) must not be made *worse* off — the cap is an upper bound and must not raise the worker count above what `auto` would have chosen.
- A future high-traffic project may legitimately need more workers; the configuration must be overridable without changing platform code.
- During the migration, projects whose gateway containers are restarted will drop in-flight requests for the restart window (seconds). This is acceptable but must be communicated.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Each per-project gateway container MUST run with a bounded, configured number of nginx worker processes that does not depend on the host CPU count.
- **FR-002**: The default cap MUST be small enough that steady-state idle memory of the gateway is well under 300 MiB on the current production VM profile, but not so small that a single slow worker can stall the gateway.
- **FR-003**: The cap MUST be expressible as a single platform-level configuration value that applies to every newly provisioned project without per-project intervention.
- **FR-004**: Existing projects MUST be able to adopt the new cap by re-deploying their gateway service via the existing operator update workflow, without requiring a data-plane migration or per-project manual edits.
- **FR-005**: On hosts with fewer cores than the configured cap, behavior MUST remain correct (the cap is an upper bound, not a target).
- **FR-006**: The change MUST NOT alter externally observable API behavior of any per-project endpoint (REST, Auth, Storage, Realtime routing through the gateway).

### Non-Functional Requirements

- **NFR-001**: Per-project gateway steady-state RSS at idle SHOULD drop by at least 70% on the current production VM (12 cores).
- **NFR-002**: Request p95 latency through the gateway SHOULD NOT regress by more than 5% under representative dashboard + CLI load.

### Assumptions

- A small fixed cap (target: 2 workers per gateway) is sufficient for the per-project traffic profile of every project on the platform today. This is consistent with the observation that current gateways report near-zero CPU at idle and only brief spikes under user interaction.
- The change is delivered via the per-instance compose template, applied automatically on new provisions and on the next re-deploy of existing projects' gateway services. No worker-side migration job is required.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After the change is deployed to the production VM, per-project gateway containers report idle RSS under 300 MiB (down from ~1.25 GiB).
- **SC-002**: Total host memory used by all per-project gateways on the production VM drops by at least 2.5 GiB.
- **SC-003**: Over the 7 days following the deploy, the per-project gateway error rate (5xx originated by the gateway itself, not upstream) does not increase compared to the prior 7 days.
- **SC-004**: A newly provisioned project on the production VM, immediately after provisioning, reports a gateway container with the capped worker count and the expected reduced memory footprint — verified without any per-project manual configuration step.

## Out of Scope

- Reducing memory of the analytics (Logflare) container — tracked separately; requires upstream image changes.
- Collapsing Studio to a shared instance — tracked separately; different risk profile.
- Switching the api/worker/mcp services to compiled JS — tracked separately.
- Tuning Kong's shared-dict cache sizes, DNS cache, or plugin set.
- Per-project worker-count overrides (no project on the platform currently needs this; can be added when one does).
