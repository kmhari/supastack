# Feature Specification: Operator Admin Ops Console (read-only) + Setup Docs

**Feature Branch**: `116-admin-ops-console`

**Created**: 2026-06-10

**Status**: Draft

**Input**: User description: "create spec for Foundation (1), Resources(3) Queues(4) and Cert (5)"

This feature delivers the **read-only** portion of the operator console — Foundation (shared web shell + public setup docs + admin sign-in + fleet/health/logs/system), plus the Resources, Queues, and Cert/DNS observability views. The mutating "Actions" slice (pause/resume/restart/delete, job retry, trigger renew/backup, pooler controls) is **explicitly excluded** and tracked as a separate follow-up feature.

## Clarifications

### Session 2026-06-10

- Q: Should the admin console be installation-wide or org-scoped? → A: **Installation-wide** — one self-hosted operator sees every project across all organizations.
- Q: How should an admin authenticate to /admin? → A: **Reuse the existing platform dashboard session** (GoTrue) via a server-side role check; no separate admin login screen.
- Q: What should the Logs view show, and how fresh? → A: Both **per-project service logs and control-plane (api/worker) logs**, shown as the most-recent N entries (refreshed on load, not a live tail).
- Q: How should the Queues view handle sensitive data in failed-job details? → A: Show **reason, type, identifier, and timing with known secret-bearing fields redacted**; never render raw payloads.
- Q: What basis should the capacity/headroom view use? → A: Show **host used/free plus the average measured per-project footprint**; no single "N more projects" estimate.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Public setup docs (CLI + MCP) (Priority: P1)

An operator — or a developer the operator shares the platform with — needs to connect the Supabase CLI and/or an AI tool (MCP) to their self-hosted projects. They open the public docs area, choose the CLI or MCP guide, and get step-by-step instructions whose commands and config are already filled in with their platform's real address — no placeholders to edit.

**Why this priority**: It was the original request, it is independently valuable (ships with no sign-in), and it is the first thing a user needs before they can do anything with the platform.

**Independent Test**: On a configured platform, open the CLI and MCP guides; verify the displayed commands/config contain the real platform address, that every block has a one-click copy, and that the pages are reachable without signing in.

**Acceptance Scenarios**:

1. **Given** a configured platform, **When** a user opens the CLI guide, **Then** the install/connect instructions show the platform's real address (not a placeholder) and each command/config block has a one-click copy.
2. **Given** a user who is not signed in, **When** they open the docs index or the MCP guide, **Then** the pages load (public, no sign-in required).
3. **Given** a platform whose address is not yet configured, **When** a user opens a docs page, **Then** snippets render a clear placeholder plus a hint to finish setup, with no error.
4. **Given** the MCP guide, **When** the user selects their editor from the supported set, **Then** the configuration snippet for that editor is shown using the real address.

---

### User Story 2 - Admin signs in and observes the fleet (Priority: P1)

The operator signs in to the admin console (admin-only) and sees, at a glance, every project on the platform, each project's status and health, the platform's own system health, and recent logs — so they can tell what is running and whether anything is wrong, without opening a terminal.

**Why this priority**: This is the headline of the console and the read-only baseline an operator needs to monitor the platform. All later views build on this shell + sign-in.

**Independent Test**: Sign in as an admin; confirm the console lists all projects with status, a project detail shows its services/health, the system view shows control-plane health + version, and a logs view shows recent entries. Confirm a non-admin is denied.

**Acceptance Scenarios**:

1. **Given** an admin user, **When** they open the console, **Then** they see a list of every project with name, identifier, owning organization, status (running/paused/restoring/etc.), and creation date.
2. **Given** a non-admin or signed-out user, **When** they navigate to the console, **Then** access is denied (redirected to sign-in or shown "not authorized").
3. **Given** a project, **When** the admin opens its detail, **Then** they see per-service health, service versions, and database status.
4. **Given** the platform, **When** the admin opens the system view, **Then** they see the health of the platform's own control-plane components and the deployed version.
5. **Given** a selectable source, **When** the admin opens logs, **Then** they see recent log entries for that source.
6. **Given** any console view in this feature, **When** the admin uses it, **Then** no control that changes project or platform state is present (read-only).

---

### User Story 3 - Admin sees resource usage & capacity (Priority: P2)

The operator wants to know how much the platform is consuming and how much headroom remains — total CPU / memory / disk, which projects are heaviest, how disk is split between project data and backups, and roughly how many more projects fit — so they can plan capacity and spot a misbehaving project before the host is overwhelmed.

**Why this priority**: High operational value (avoid the host falling over), but it requires new measurement and is not needed merely to observe status.

**Independent Test**: With sampling running, the resources view shows current host totals and per-project usage, a heaviest-projects ranking, a disk breakdown, and a headroom estimate; values change over time.

**Acceptance Scenarios**:

1. **Given** sampling has produced data, **When** the admin opens Resources, **Then** they see host totals (CPU, memory, disk used/free) and per-project consumption.
2. **Given** multiple projects, **When** the admin views Resources, **Then** projects can be ranked by consumption (heaviest first).
3. **Given** the host, **When** the admin views Resources, **Then** disk usage is broken down (project data vs backups vs other) and a capacity/headroom estimate is shown.
4. **Given** samples collected over time, **When** the admin views a project's usage, **Then** a recent trend is available, not only an instantaneous value.
5. **Given** no sample exists yet, **When** the admin opens Resources, **Then** a clear "collecting…" empty state is shown, not an error.

---

### User Story 4 - Admin sees background-job / queue health (Priority: P2)

The operator wants to see the platform's background work — provisioning, backups, restores, certificate renewals, pooler reconciliation — including anything pending, in progress, or failed, so they can tell whether an operation is stuck and which one.

**Why this priority**: Critical for diagnosing "my project won't provision/restore," and a known failure class is silently-stuck background work. It is a read-only view of work the platform already performs.

**Independent Test**: The queues view lists each background-work type with pending/active/failed counts and shows details for failed items; the counts match the actual backlog.

**Acceptance Scenarios**:

1. **Given** the platform's background-work types, **When** the admin opens Queues, **Then** each shows counts of pending, active, and failed items.
2. **Given** failed items, **When** the admin expands a failed item, **Then** they see an identifier, the failure reason, and when it failed.
3. **Given** a work type with nothing queued, **When** the admin views Queues, **Then** the zero-count type renders cleanly (not as an error).
4. **Given** the queue view, **When** the admin uses it, **Then** no retry/clear control is present (those belong to the Actions feature).

---

### User Story 5 - Admin sees certificate, DNS & backup status (Priority: P3)

The operator wants assurance that TLS and DNS are healthy and backups are current — the wildcard and per-project certificate expiries (with renewal warnings), apex/wildcard DNS readiness, and each project's last-backup time/size/outcome — so they can catch an expiring certificate or a DNS regression before users do.

**Why this priority**: Important but lower-frequency, and it mostly surfaces data the platform already tracks.

**Independent Test**: The status view shows the wildcard certificate's expiry and days remaining, per-project certificate status, apex + wildcard DNS readiness, and each project's backup recency plus total backup storage used.

**Acceptance Scenarios**:

1. **Given** the wildcard certificate, **When** the admin opens the status view, **Then** they see its expiry date, days remaining, and a warning if it is within the renewal window.
2. **Given** per-project certificates, **When** the admin views status, **Then** each project's certificate status/expiry is shown.
3. **Given** DNS, **When** the admin views status, **Then** apex and wildcard record readiness is shown.
4. **Given** backups, **When** the admin views status, **Then** each project's most recent backup time, size, and outcome are shown, plus total backup storage used.
5. **Given** the status view, **When** the admin uses it, **Then** no "renew now" / "back up now" control is present (those belong to the Actions feature).

---

### Edge Cases

- A signed-in admin whose role is downgraded mid-session loses console access on the next server-side check.
- The platform address is not yet set (pre-setup): docs show a placeholder + finish-setup hint; the console still works for whatever data exists.
- A project is paused or restoring: its status is reflected and its health detail degrades gracefully (no crash, partial data with a clear state).
- Resource sampling lags or a sample fails: the last-known values are shown with their timestamp; a missing sample does not break the view.
- A log source is empty or temporarily unreachable: an empty state is shown, not an error.
- A background-work type has never run: it shows zero counts, not a missing entry.
- A failed job's payload or error contains secrets (connection string, token): the sensitive fields are redacted before display; raw payloads are never rendered.
- An admin's role is downgraded below administrator while signed in: the next server-side authorization check denies further admin data.
- Many projects (dozens): the fleet and resources views remain usable via pagination or scrolling, with no unbounded load.

## Requirements *(mandatory)*

### Functional Requirements

**Foundation — shell & public docs**

- **FR-001**: The platform MUST serve a public documentation area with an index and two setup guides (CLI and MCP), reachable by direct link without signing in.
- **FR-002**: Documentation snippets MUST be personalized with the platform's live address so users can copy commands/config without editing placeholders.
- **FR-003**: When the platform address is not yet configured, documentation MUST render a clear placeholder plus guidance, never an error.
- **FR-004**: Every command/config block in the docs MUST offer one-click copy.
- **FR-005**: The MCP guide MUST provide ready-to-paste configuration for each supported editor (Claude Code, Cursor, Windsurf, Claude Desktop).
- **FR-006**: The CLI guide MUST present a recommended quickstart and a discoverable path to the manual-setup details.
- **FR-007**: The web experience MUST share one common shell (navigation + theme) across the setup wizard, the docs, and the admin console, including a navigation entry that makes the docs discoverable.

**Admin access**

- **FR-008**: The admin console MUST require an authenticated user holding an installation-level administrator role (Owner or Administrator); every other user MUST be denied. The console MUST reuse the platform's existing dashboard session — no separate admin login is introduced.
- **FR-009**: Authorization MUST be re-evaluated on the server for every admin data request and never trusted from the client.

**Fleet, health, system & logs (US2)**

- **FR-010**: The console MUST list every project **across all organizations** (installation-wide) with name, identifier, owning organization, status, and creation date.
- **FR-011**: The console MUST show, per project, the health of its services, their versions, and database status.
- **FR-012**: The console MUST show the health of the platform's own control-plane components and the deployed version.
- **FR-013**: The console MUST show the most-recent log entries (a bounded count, refreshed on load — not a live tail) for a selectable source, covering both a project's services and the platform's own control-plane components (api/worker).
- **FR-014**: Every console view in this feature MUST be read-only; no control that changes project or platform state may be present.

**Resources & capacity (US3)**

- **FR-015**: The platform MUST periodically sample resource consumption (CPU, memory, disk) per project and for the host as a whole, and retain recent samples.
- **FR-016**: The console MUST display current host totals and per-project consumption, with projects rankable by consumption.
- **FR-017**: The console MUST present a disk-usage breakdown (project data vs backups vs other), host resources used vs free, and the average measured per-project footprint so the operator can judge headroom. It MUST NOT present a single "N more projects fit" number (which misleads when project sizes vary).
- **FR-018**: The console MUST present a recent trend for a project's consumption, not only an instantaneous value.
- **FR-019**: Before any sample exists, the resources view MUST show a "collecting" empty state, not an error.
- **FR-020**: Sampling MUST NOT meaningfully degrade the performance of running projects.

**Background-job / queue health (US4)**

- **FR-021**: The console MUST list each background-work type with counts of pending, active, and failed items.
- **FR-022**: For failed items, the console MUST show an identifier, the failure reason, and the failure time, with known secret-bearing fields redacted; it MUST NOT render raw job payloads.
- **FR-023**: Work types with nothing queued MUST render cleanly (zero counts, not an error or omission).
- **FR-024**: The queue view MUST be read-only (no retry/clear controls).

**Certificate, DNS & backup status (US5)**

- **FR-025**: The console MUST show the wildcard certificate's expiry, days remaining, and a renewal warning when within the configured renewal window.
- **FR-026**: The console MUST show each project's certificate status and expiry.
- **FR-027**: The console MUST show apex and wildcard DNS record readiness.
- **FR-028**: The console MUST show each project's most recent backup time, size, and outcome, plus total backup storage used.
- **FR-029**: The certificate/DNS/backup view MUST be read-only (no renew/back-up controls).

**Cross-cutting**

- **FR-030**: Every admin view MUST degrade gracefully when a data source is empty or unavailable — showing an empty or last-known state with a timestamp rather than crashing.
- **FR-031**: The console MUST remain usable with dozens of projects (no unbounded load; pagination or scrolling as needed).

### Key Entities *(include if feature involves data)*

- **Project**: a hosted Supabase project on the platform — identifier, name, owning organization, status, creation date, public endpoints.
- **Admin user**: an authenticated operator holding an administrator-level role; the only actor permitted in the console.
- **Resource sample**: a timestamped measurement of CPU, memory, and disk for a project or for the host; retained to support recent trends.
- **Background-work item**: a unit of platform work (provision, backup, restore, certificate issuance, pooler reconciliation) with a state (pending / active / failed) and metadata (identifier, reason, timing).
- **Certificate**: the wildcard certificate or a per-project certificate, each with an expiry and renewal window.
- **DNS readiness**: whether the apex and wildcard records resolve as required.
- **Backup record**: a project's backup with a time, size, and outcome, contributing to total backup storage used.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A user can obtain a working CLI or MCP setup from the docs without editing any placeholder — verified by the displayed snippets containing the platform's real address.
- **SC-002**: Within 10 seconds of opening the console, an admin can see the status of every project and the platform's own health on one screen.
- **SC-003**: 100% of console data requests from non-admin or signed-out users are denied.
- **SC-004**: An admin can identify the single heaviest project by resource consumption from the resources view without external tooling.
- **SC-005**: An admin can determine, from the queues view, whether any background operation is failing or stuck and which type it is.
- **SC-006**: Every certificate within its renewal window is surfaced with a warning before it expires.
- **SC-007**: 100% of admin views render without error when their data source is empty or a project is paused/restoring.
- **SC-008**: The console remains responsive (fleet and resources views load and scroll without freezing) with at least 50 projects listed.

## Assumptions

- The mutating **Actions** capability (pause/resume/restart/delete, job retry/clear, trigger certificate renewal or backup, pooler controls) is **out of scope** for this feature and is a separate follow-up. This feature is strictly read-only / observability.
- The console is **installation-wide**: a single operator (installation Owner/Administrator) sees every project across all organizations. Per-org scoping is out of scope.
- Admin sign-in **reuses the platform's existing dashboard session** (no separate login UI is built); Owner and Administrator are admins, Developer and Read-only are not.
- Docs personalization reuses the existing public platform-address signal, and the docs are reachable regardless of the setup-gate state.
- Resource samples are retained for a recent window sufficient for short-term trends (default ~7 days); the exact retention is an implementation detail.
- Sampling cadence trades freshness for low overhead (default on the order of ~1 minute) — "near-real-time, not live."
- Logs surfaced in the console are the most-recent entries within a bounded window (per-project services + control-plane), not full historical search or a live tail.
- The platform targets a single-host (single-VM) deployment; multi-host aggregation is out of scope.
- The supported editors for MCP configuration are Claude Code, Cursor, Windsurf, and Claude Desktop.
- A shared web shell introduced here is intended to be reused by the future Actions feature without rework.
