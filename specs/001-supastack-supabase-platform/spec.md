# Feature Specification: Supastack — Self-Hosted Supabase Platform

**Feature Branch**: `001-supastack-supabase-platform`

**Created**: 2026-05-21

**Status**: Draft

**Input**: User description: "Supastack: self-hosted Supabase Cloud control plane for managing multiple full-stack Supabase instances with per-subdomain HTTPS, backups, lifecycle, encrypted secrets, and a web dashboard." (derived from `plan.md` in the project root)

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Provision and reach a working Supabase instance (Priority: P1)

A solo operator who already controls a server wants to stand up a fully working Supabase project — database, authentication, REST API, storage, Studio — by clicking buttons in a dashboard instead of hand-templating Docker files. After running a one-line installer and creating their super-admin account, they fill in a name in a "Create Instance" form, wait roughly a minute, and receive a working HTTPS URL plus credentials that authenticate against the new instance on the first try.

**Why this priority**: This is the entire reason the product exists. If create-an-instance-and-reach-it doesn't work, nothing else matters. This single slice is also a viable MVP — every other feature is value-add.

**Independent Test**: On a fresh server, run the installer, complete first-time setup with an email and password, register an apex domain, create an instance named "test", wait until status flips to "running", and successfully query its REST API using the displayed anonymous key. The instance's URL serves a valid HTTPS certificate without any manual certificate or DNS work beyond the apex A record.

**Acceptance Scenarios**:

1. **Given** a freshly installed Supastack with no users, **When** the operator opens the setup page and submits email, password, organization name, and apex domain, **Then** a super-admin account is created, the apex is registered, and the operator is logged into the dashboard.
2. **Given** an authenticated operator with a registered apex, **When** they create an instance named "test", **Then** within 90 seconds the dashboard shows the instance as "running" with its unique stable identifier, display name, status, and reachable URLs.
3. **Given** a newly running instance, **When** the operator visits its API URL with the displayed anonymous key as a header, **Then** the API responds successfully (no signature failures, no "instance unreachable" errors).
4. **Given** an instance was just created, **When** the first HTTPS request hits its subdomain, **Then** a valid certificate is issued automatically and subsequent requests are served over HTTPS without operator action.

---

### User Story 2 — Lifecycle management of running instances (Priority: P2)

The operator has multiple instances on the host and needs to pause idle ones to free RAM, restart misbehaving ones, upgrade outdated ones to a newer Supabase version, and permanently delete the ones they no longer need.

**Why this priority**: Day-2 operations. The product is only useful if operators can keep their instance fleet healthy without SSH'ing into the host.

**Independent Test**: With a running instance, pause it (containers stop, status flips to "paused"), confirm its volumes still exist, resume it (status returns to "running", data intact), restart it, then upgrade its Supabase version to a newer pinned version. Finally delete an unwanted instance and confirm its resources are released and its subdomain stops resolving in the platform.

**Acceptance Scenarios**:

1. **Given** a running instance, **When** the operator clicks "Pause", **Then** within 30 seconds the instance status is "paused", its containers are no longer running, and its data volumes are intact.
2. **Given** a paused instance, **When** the operator clicks "Resume", **Then** within 60 seconds the instance status is "running" and an API call with its credentials succeeds.
3. **Given** a running instance, **When** the operator clicks "Restart", **Then** the instance briefly transitions through a restarting state and returns to "running" with no data loss.
4. **Given** a running instance pinned to version A, **When** the operator selects version B and confirms upgrade, **Then** the instance is offered an optional pre-upgrade backup, then pulls the new version's images, recreates its containers, and returns to "running" on version B.
5. **Given** any instance, **When** the operator deletes it (with confirmation), **Then** its containers stop, its directory and data volumes are removed, its allocated ports are freed, its subdomain stops responding, and its row disappears from the instance list.

---

### User Story 3 — Backups (Priority: P2)

The operator wants a snapshot of their database any time they like and an automatic daily snapshot they never have to think about, with old snapshots culled to control disk usage. Snapshots are downloadable files they can restore using their own tooling.

**Why this priority**: Data safety. Without backups operators won't trust the platform with anything they care about. Restore-from-dashboard is deliberately out of scope for v1 — a downloadable artifact plus standard tooling is sufficient to claim "you can recover".

**Independent Test**: Create an instance, load some test data, trigger an on-demand backup, observe the resulting artifact appear in the dashboard's backup list, download it, and successfully apply it to a fresh database using standard PostgreSQL tooling. Enable daily auto-backup with retention of three; over four days observe that exactly three backups remain at any time, with the oldest evicted as new ones arrive.

**Acceptance Scenarios**:

1. **Given** a running instance, **When** the operator clicks "Create Backup", **Then** a new backup record appears with status "running", transitions to "completed" within a reasonable time, and exposes a downloadable artifact and size.
2. **Given** an instance with daily auto-backup enabled and retention=3, **When** four daily backups have run, **Then** only the three most recent successful backups remain; older ones are removed from storage and from the dashboard list.
3. **Given** an organization configured to use remote object storage for backups, **When** any backup runs, **Then** the artifact is uploaded to that remote storage rather than local disk, and the dashboard download still resolves.
4. **Given** any completed backup file, **When** an operator restores it manually into a fresh database using standard tooling, **Then** the schema and data load successfully (no malformed dump).

---

### User Story 4 — Multi-user collaboration with role separation (Priority: P3)

The operator wants to invite a teammate to view and use instances without giving them the power to delete instances, change settings, or invite others.

**Why this priority**: Real-world deployments rarely stay solo, but the platform is usable solo on day one. This unlocks team workflows once the core is solid.

**Independent Test**: As the admin, invite a teammate by email; the teammate receives a one-time link, accepts it within the validity window, and is added as a member. They can see the instance list and use credentials, but the "Create Instance", "Delete Instance", and "Invite Member" controls are absent or disabled, and the underlying actions are rejected if attempted directly.

**Acceptance Scenarios**:

1. **Given** an admin and an unregistered invitee, **When** the admin sends an invite, **Then** a one-time link is generated and delivered (or surfaced for delivery), valid for 24 hours.
2. **Given** a member account, **When** the member opens the dashboard, **Then** they can see all instances and view their non-secret information; secrets remain hidden behind an explicit reveal action.
3. **Given** a member account, **When** they attempt a destructive action (delete an instance, remove a user, change organization settings), **Then** the action is rejected and a clear authorization error is shown.
4. **Given** an expired or already-used invite link, **When** anyone opens it, **Then** the link is refused without revealing whether an account exists at the invited address.

---

### Edge Cases

- The first-time setup endpoint is hit a second time after a super-admin already exists → the request is refused without revealing how many users exist or what their emails are.
- The apex domain's DNS does not point at the host, or has not propagated yet → HTTPS issuance fails gracefully (no infinite retry loop), the dashboard surfaces a clear "DNS not pointing here" status, and the operator is not blocked from administrative actions through the dashboard.
- The configured pool of allocatable service ports is exhausted → instance creation is refused with a specific error identifying the shortage; existing instances are unaffected.
- An on-demand backup is requested while the instance is paused → the system either skips with a recorded reason, or temporarily resumes, backs up, and re-pauses; in any case the state transition is recorded and never leaves the instance in a half-resumed state.
- An instance is deleted while a backup is in progress → the backup either completes and is preserved, or is cleanly aborted with status="failed" — never left as an orphan "running" forever.
- The master encryption secret is missing, malformed, or rotated without re-encryption → the platform refuses to start and surfaces a clear failure rather than silently falling back to plaintext or producing unreadable instances.
- The same display name is reused for two instances → allowed; the stable identifier disambiguates URLs and history.
- An operator changes the apex domain after instances exist → existing instance subdomains continue to work; new subdomains require the new apex's DNS to be configured.
- A member who has previously had their token issued is then removed from the organization → the token is invalidated; subsequent requests with it fail.

## Requirements *(mandatory)*

### Functional Requirements

**First-time setup, identity, and authentication**

- **FR-001**: System MUST allow exactly one first-time super-admin to be created via an open setup endpoint, accepting email and password.
- **FR-002**: System MUST disable the first-time setup endpoint after a super-admin has been created, refusing subsequent attempts without revealing user information.
- **FR-003**: System MUST allow the super-admin to optionally register a single apex domain during or after setup.
- **FR-004**: System MUST authenticate browser users via session cookies and programmatic clients via personal bearer tokens.
- **FR-005**: Users MUST be able to create, label, and revoke their own personal access tokens.
- **FR-006**: System MUST hash all user passwords using a modern, salted, memory-hard algorithm; system MUST never store passwords in any reversible form.

**Instance provisioning and reachability**

- **FR-007**: System MUST allow authorized users to create a new managed Supabase instance by supplying a display name and optional create-time configuration (signup enabled, JWT expiry, SMTP host/port/user/password).
- **FR-008**: System MUST assign each instance a stable, immutable identifier and a separately editable display name; the identifier MUST be used for URLs and the display name for human reading.
- **FR-009**: System MUST allocate non-conflicting service ports for each instance without operator input and track allocations to prevent collisions.
- **FR-010**: System MUST generate per-instance credentials (database password, signing secret, anonymous client key, service-role client key, dashboard password) that the running Supabase services accept and validate; generated credentials MUST contain only characters safe for downstream consumers (no characters that get reinterpreted as variable substitutions in configuration files).
- **FR-011**: System MUST encrypt all per-instance secrets at rest using an authenticated encryption scheme; the master encryption key MUST be supplied at runtime and never persisted to the database.
- **FR-012**: System MUST refuse to start if the master encryption key is missing, malformed, or cannot decrypt existing records, surfacing a clear failure.
- **FR-013**: Each instance MUST be reachable via a unique HTTPS subdomain under the configured apex domain; certificates MUST be issued automatically on the first request without operator-initiated certificate or DNS work beyond the apex A/CNAME.
- **FR-014**: Each instance MUST expose its Studio (table editor and database UI) at a known path on its own subdomain.

**Instance lifecycle**

- **FR-015**: Authorized users MUST be able to list instances filtered by organization and see status, identifier, display name, and quick actions.
- **FR-016**: Authorized users MUST be able to view per-instance detail including credentials behind an explicit "reveal" action that is not the default view.
- **FR-017**: Authorized users MUST be able to pause a running instance; pausing MUST stop runtime resources but preserve all data on disk.
- **FR-018**: Authorized users MUST be able to resume a paused instance, returning it to running with all data intact.
- **FR-019**: Authorized users MUST be able to restart a running instance to apply runtime changes or recover from failures.
- **FR-020**: Authorized users MUST be able to upgrade an instance to a newer pinned platform version with an optional pre-upgrade backup.
- **FR-021**: Authorized users MUST be able to permanently delete an instance; deletion MUST release runtime resources, free allocated ports, remove data volumes, and stop the subdomain from responding.

**Backups**

- **FR-022**: Authorized users MUST be able to trigger an on-demand backup of any non-deleted instance.
- **FR-023**: Authorized users MUST be able to enable or disable a daily automatic backup per instance and set a retention count.
- **FR-024**: System MUST automatically remove successful backups beyond the retention count, oldest first, after each successful new backup.
- **FR-025**: System MUST support persisting backup artifacts to local disk or to remote object storage, configurable at the organization level.
- **FR-026**: System MUST surface each backup's status (running, completed, failed), size, creation time, and a download link for completed local backups.

**Collaboration and authorization**

- **FR-027**: Admin users MUST be able to invite additional users by email; invitations MUST be valid for 24 hours and consumable exactly once.
- **FR-028**: Invited users MUST become "members" of the single organization upon accepting; the organization model MUST be single-tenant in v1 with no support for multiple organizations.
- **FR-029**: Admin users MUST have full access to create, delete, pause, resume, restart, upgrade, back up, and configure instances; Admin users MUST be able to invite and remove other users.
- **FR-030**: Member users MUST be able to view instances and reveal credentials, but MUST NOT be able to create, delete, upgrade, or invite; attempts MUST be refused with an authorization error.
- **FR-031**: Removal of a user MUST invalidate that user's sessions and personal tokens immediately.

**Operability and observability**

- **FR-032**: System MUST audit destructive and security-sensitive actions (instance delete, member remove, token revoke, secret reveal) with attribution to the acting user.
- **FR-033**: System MUST report each instance's health (running, paused, failed) based on the actual state of its underlying processes, not just on the last requested action.
- **FR-034**: System MUST surface clear, actionable error messages on provisioning failure and leave failed instance state available for inspection (not auto-clean).

### Key Entities

- **Organization**: The single tenant; owns all instances, members, apex domain, and backup-store configuration. Exactly one exists once setup is complete.
- **User**: An authenticated person belonging to the organization with role admin or member; carries personal access tokens.
- **API Token**: A personal bearer credential issued by a user, with a label, a last-used timestamp, and revocation state.
- **Instance**: A managed full-stack Supabase deployment, with stable identifier, display name, pinned platform version, status, allocated ports, encrypted secrets, create-time configuration, backup retention policy, and lifecycle history.
- **Backup**: A snapshot artifact of an instance's database with a kind (manual or automatic), storage location reference, size, status (running, completed, failed), and timing metadata.
- **Apex Domain**: The configured parent domain under which the dashboard and every per-instance subdomain are reachable; one per organization.
- **Audit Entry**: An immutable record of a destructive or security-sensitive action, attributed to a user, with timestamp and structured payload.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: A new operator can go from a freshly installed system to a working, HTTPS-reachable Supabase instance in under 5 minutes, on a stock VM with the apex DNS configured.
- **SC-002**: At least 95% of instance creation attempts on a freshly installed system reach "running" status without operator intervention.
- **SC-003**: A newly provisioned instance answers an authenticated REST request using its generated anonymous key on the first try, with no manual signing or key-rebuilding required.
- **SC-004**: A new per-instance HTTPS subdomain serves a valid, trusted certificate within 60 seconds of the first request, without operator-initiated certificate or DNS actions beyond a single apex DNS record.
- **SC-005**: Pausing an instance releases its runtime resources within 30 seconds; resuming returns it to running within 60 seconds with no data loss.
- **SC-006**: An on-demand backup of an instance containing 100 MB of data completes within 60 seconds and produces an artifact that successfully loads into a fresh database using standard tooling.
- **SC-007**: With daily backups enabled and retention=N, the platform retains exactly N successful backups at all times after the (N+1)th run completes.
- **SC-008**: A member user attempting any destructive action (instance delete, member invite/remove, settings change) is rejected with an authorization error and the action is not performed; a corresponding audit entry is recorded (with the attempt logged where applicable).
- **SC-009**: Instance credentials are not displayed in the dashboard by default — operators must take an explicit reveal action; reveal is attributed in the audit log.
- **SC-010**: Up to 15 running instances on a single 32 GB host do not noticeably degrade dashboard navigation responsiveness (perceived navigation under 1 second).
- **SC-011**: The platform refuses to start with a clear, named error if the master encryption key is missing or invalid; no silent fallback to plaintext.
- **SC-012**: A teammate accepting a fresh invitation can log in and see the instance list within 1 minute of clicking the link, without admin intervention.

## Assumptions

- **Single-host deployment**: v1 runs on one server. Multi-host scheduling and per-host agents are out of scope.
- **Single organization**: One organization per installation; multi-org isolation is out of scope.
- **DNS control**: Operators control DNS for their apex and can point an A/CNAME record at the host. No registrar integration is performed by the platform.
- **Operator competency**: Operators are technically capable of running an installer, reading clear error messages, and (rarely) using standard PostgreSQL tooling for restore.
- **Restore is manual in v1**: Backup artifacts are downloadable; restoring into an instance is performed by the operator using standard tooling. First-class restore through the dashboard is deferred.
- **No billing or quotas**: The platform is operator-administered, not customer-facing; there is no billing, no per-tier limits, no auto-pause on idle. An owner role is not needed.
- **No CLI or programmatic plugins in v1**: All operations are reachable via the dashboard and a documented HTTP API; a dedicated command-line tool and an external automation server are deferred.
- **Existing Supabase template is upstream**: The system templates instances from an upstream Supabase docker layout pinned to a known-good version; the upgrade flow uses the same template family.
- **SMTP configuration is per-instance and create-time only**: The operator supplies SMTP details during instance creation; later changes are made out-of-band and require an instance restart.
- **Auto-pause on idle is not provided**: Pausing is an explicit operator action; the platform does not detect idle instances and pause them automatically.
- **Custom per-instance domains are not provided**: Each instance is reached only at its assigned subdomain under the configured apex; bring-your-own per-instance domains are deferred.
- **Wildcard certificates are not used**: Per-subdomain certificates are issued individually on first request; no DNS-01 challenge or wildcard issuance is performed.
- **Postgres direct exposure is private**: Each instance's database is reachable only from within the host's local network in v1; public direct-DB connections (and shared region pooler hosts) are deferred.
- **English-only UI in v1**: Localization is out of scope.
