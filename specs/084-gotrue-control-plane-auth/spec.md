# Feature Specification: GoTrue Control-Plane Auth + Multi-Tenant Orgs + Cloud RBAC

**Feature Branch**: `084-gotrue-control-plane-auth`

**Created**: 2026-06-02 · **Updated**: 2026-06-02 (folded in the full platform-API surface captured
directly from the Studio fork source).

**Status**: Draft

**Input**: User description: "Migrate supastack control-plane human authentication to a real GoTrue
service, add multi-tenant organizations with Supabase-Cloud-style RBAC, organization + member
management with email invites, and email (SMTP). NO MFA, NO social/OAuth-provider login. Token model:
GoTrue tokens everywhere. Greenfield. Full Cloud model (projects belong to one org). Split the
conflated `org` singleton. Studio (IS_PLATFORM=true) provides the login + org + member UI; build the
platform API to match. PATs + OAuth 2.1 MCP stay. Then: fold in the full endpoint set and re-capture
Studio's expectations from code."

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator signs in with a real account (Priority: P1)

An operator opens the dashboard and signs in with email + password against a real auth service
(GoTrue) that owns their identity. They land authenticated; the dashboard fetches their profile,
permissions, and organizations and renders accordingly. The legacy session cookie and JWT shim are
gone.

**Why this priority**: The identity foundation; nothing else anchors without it, and it retires the
bespoke auth surface.

**Independent Test**: Recreate the operator, sign in at the apex dashboard, confirm the dashboard
loads with the operator's profile + org visible, with no legacy session cookie set.

**Acceptance Scenarios**:

1. **Given** a fresh platform, **When** the operator runs `/setup` with an admin email + password,
   **Then** an operator account is created in the auth service, a first organization is created, and
   the operator is its **Owner**.
2. **Given** an existing operator account, **When** they sign in correctly, **Then** they receive a
   session and the dashboard renders their profile, permissions, and organization list.
3. **Given** a signed-in operator, **When** a protected platform request is made, **Then** it is
   authorized by the auth-service credential with no legacy session/shim path involved.
4. **Given** open self-signup is disabled, **When** an unknown visitor self-registers, **Then** it is
   refused (accounts come only from `/setup` or an org invitation).

---

### User Story 2 — CLI and MCP keep working unchanged (Priority: P1)

A developer using the Supabase CLI (PAT) and an MCP client (OAuth) continues to work with zero
changes; their tokens authenticate, resolve to their identity, and respect their organization role.

**Why this priority**: A hard no-regression constraint co-equal with US1.

**Independent Test**: With a valid PAT, a Management API call succeeds; with a valid MCP OAuth token,
an MCP tool call succeeds — both after identity moved to the auth service.

**Acceptance Scenarios**:

1. **Given** a valid PAT, **When** presented to the Management API, **Then** it authenticates and
   resolves to the owner's identity + org role.
2. **Given** a valid MCP OAuth token, **When** presented to the MCP surface, **Then** it
   authenticates exactly as before.
3. **Given** identity moved to the auth service, **When** any machine credential is validated,
   **Then** email + role are resolved from the auth service's user records + the membership table.

---

### User Story 3 — Create, rename, and delete organizations (Priority: P2)

An operator manages multiple organizations as in Supabase Cloud: create, rename, delete. The
dashboard's organization list, detail, and settings screens are fully populated by the platform API.

**Why this priority**: The structural multi-org change that org-scoped members and projects depend on.

**Independent Test**: Create two orgs, rename one, delete an empty one; confirm the org list reflects
each change and deletion is refused when the org still owns projects.

**Acceptance Scenarios**:

1. **Given** a signed-in operator, **When** they create an organization with a name, **Then** a new
   org exists identified by a **20-character reference string** (project-ref style, not a UUID), with
   the creator as **Owner** and a self-hosted plan marker.
2. **Given** an org the operator owns/administers, **When** they rename it, **Then** the new name is
   reflected in the org list + detail.
3. **Given** an org with no projects, **When** an **Owner** deletes it, **Then** the org + its
   memberships/invitations are removed.
4. **Given** an org that still owns ≥1 project, **When** deletion is attempted, **Then** it is refused
   with a clear message.

---

### User Story 4 — Invite and manage members with Cloud roles (Priority: P2)

An operator opens an org's Team screen, invites teammates by email choosing a role from the role list
(Owner / Administrator / Developer / Read-only), and sees pending invitations alongside active
members. They later change a member's role or remove them. Each role grants exactly its Cloud
capabilities.

**Why this priority**: Headline collaboration capability; depends on US1 + US3.

**Independent Test**: Invite an email with the Developer role, accept end-to-end, confirm the member
appears with Developer, change to Read-only, confirm a write action is then refused.

**Acceptance Scenarios**:

1. **Given** the Team screen, **When** the operator loads it, **Then** the role list, the member
   list (with each member's role), and the pending-invitation list are all populated.
2. **Given** member-management rights, **When** the operator invites one or more emails with a chosen
   role, **Then** invitations are recorded and invite emails are sent; the response reports which
   succeeded and which failed.
3. **Given** a pending invitation, **When** the invitee opens the invite link, **Then** the platform
   reports the invitation's validity (valid / expired / wrong-email / unknown) before they accept.
4. **Given** a valid invitation, **When** the invitee accepts and sets a password, **Then** an
   account is created (if new) and they become a member with the invited role.
5. **Given** an existing member, **When** an authorized operator changes their role (by role id),
   **Then** the new role's capabilities take effect on the member's next request.
6. **Given** an org with exactly one **Owner**, **When** removal or demotion of that last Owner is
   attempted, **Then** it is refused.
7. **Given** a member with a role, **When** they attempt an action, **Then** it is allowed/refused
   strictly per the role-capability matrix (Owner ⊇ Administrator ⊇ Developer ⊇ Read-only).

---

### User Story 5 — Projects belong to an organization (Priority: P2)

Every project belongs to exactly one organization. The org's Projects screen lists only that org's
projects (paginated, sortable, searchable). A Developer in Org A cannot see or act on Org B's
projects.

**Why this priority**: Makes RBAC meaningful for the platform's core asset; largest structural change.

**Independent Test**: Create a project in Org A and one in Org B; confirm a Developer in Org A sees
only Org A's project (in the paginated org-projects list) and is refused on Org B's project.

**Acceptance Scenarios**:

1. **Given** project-create rights in an org, **When** the operator creates a project, **Then** the
   project is owned by that org.
2. **Given** the org Projects screen, **When** it loads, **Then** it returns a paginated list (with
   count, limit, offset) of only that org's projects, supporting sort + search.
3. **Given** a project owned by an org, **When** an operator without sufficient role in that org acts
   on it, **Then** the action is refused.
4. **Given** project creation requires an org context, **When** none is supplied or the caller lacks
   the role there, **Then** creation is refused.

---

### User Story 6 — Email-driven flows (Priority: P3)

Operators receive transactional emails: org invitations, password-reset links, and (once SMTP is
configured) email-confirmation links. SMTP is configured once in setup.

**Why this priority**: Required for real-teammate invites + self-service recovery; follows the core
plumbing.

**Independent Test**: Configure SMTP, trigger an invite and a reset; confirm both emails arrive and
their links complete the intended flow.

**Acceptance Scenarios**:

1. **Given** SMTP configured, **When** an invitation is created, **Then** the invitee receives an
   email whose link begins the accept flow.
2. **Given** SMTP configured, **When** a password reset is requested, **Then** the operator receives
   an email whose link lets them set a new password and sign in.
3. **Given** SMTP not configured, **When** an email-dependent action is attempted, **Then** the
   operator is told email delivery is unavailable.

---

### Edge Cases

- **Last owner protection**: removing/demoting the only Owner is refused.
- **Deleting a non-empty org**: refused while it owns projects.
- **Removed member with an active token**: loses access to that org on the next request.
- **Invitation to an existing user**: accepting adds a membership; no duplicate account.
- **Expired / consumed / wrong-email / unknown invitation token**: the get-by-token check reports the
  precise condition; accept is refused.
- **Operator in zero orgs**: signs in but sees no orgs/projects until invited or until they create one.
- **Reference collision**: the (astronomically rare) 20-character org-reference clash is retried at
  create time until unique. Two orgs may share a display name — the reference is what's unique.
- **Greenfield cutover**: legacy operator records + tokens are discarded; operators recreated, tokens
  re-issued.
- **Unsupported-feature gating**: features the platform does not implement (billing, project transfer)
  are hidden from the dashboard via the profile's disabled-features list rather than erroring.

## Requirements *(mandatory)*

### Functional Requirements

**Identity & sessions**

- **FR-001**: The platform MUST authenticate operators via a real auth service that owns operator
  identities + passwords; its issued credential MUST be the sole human credential.
- **FR-002**: The platform MUST validate that credential on every protected request and resolve it to
  the operator's identity + the relevant organization role.
- **FR-003**: The platform MUST remove the legacy session cookie, the legacy auth shim, and the
  bespoke operator-user store; no request path may depend on them afterward.
- **FR-004**: Open self-registration MUST be disabled; accounts originate only from setup (first
  operator) or accepting an organization invitation.
- **FR-005**: Setup MUST create the first operator account, the first organization, and an Owner
  membership.

**Machine credentials (unchanged behavior)**

- **FR-006**: Personal access tokens MUST continue to authenticate and resolve to their owner's
  identity + org role from the auth service's user records.
- **FR-007**: The MCP OAuth credential MUST continue to authenticate with no protocol change.
- **FR-008**: No machine-credential change may regress existing CLI or MCP workflows.

**Profile & permissions (dashboard bootstrap)**

- **FR-009**: The platform MUST serve the operator's profile with the fields the dashboard reads —
  identity (id, auth id, email, username, first/last name), a free-project-limit marker, and a
  **disabled-features** list used to hide features the platform does not implement.
- **FR-010**: Operators MUST be able to update their own profile (name, username).
- **FR-011**: The platform MUST serve the operator's effective **permissions** as the
  organization-scoped permission list the dashboard uses for client-side gating (resources × actions,
  scoped by organization).
- **FR-012**: The platform MUST serve the operator's personal access tokens via the dashboard's
  token endpoints (list / create / revoke), backed by the existing PAT store.

**Organizations**

- **FR-013**: Operators MUST be able to list the organizations they belong to, each annotated with
  the caller's relationship (e.g. is-owner) and a self-hosted plan marker.
- **FR-014**: Operators MUST be able to create an organization (the creator becomes Owner; the org is
  assigned a **20-character reference string** in the same format as a project ref — used as both its
  API `id` and its URL/path identifier, never a UUID), read its detail, rename it (display name only;
  the reference is immutable), and (Owner only) delete it.
- **FR-015**: Deleting an organization that still owns projects MUST be refused with a clear message.
- **FR-016**: Installation-level settings (apex domain, backup destination) MUST be stored separately
  from tenant organizations so creating/deleting an org cannot affect platform routing or backups.

**Roles, members & invitations**

- **FR-017**: The platform MUST expose the four organization roles as addressable **role objects**,
  each with a stable **numeric id** and the name Owner / Administrator / Developer / Read-only, via the
  dashboard's roles endpoint — so the Team screen can list roles and assign them by numeric id (the
  dashboard models roles as objects with numeric ids, not a string enum). Members carry their role as
  a list of numeric role ids (always one). Capabilities match Supabase Cloud (Owner ⊇ Administrator ⊇
  Developer ⊇ Read-only).
- **FR-018**: Authorization MUST be organization-scoped: a request is permitted only if the caller's
  role *in the relevant organization* grants the action; project actions inherit the project's org.
- **FR-019**: Operators MUST be able to list an org's members (each with identity + assigned role)
  and the org's pending invitations.
- **FR-020**: Operators with member-management rights MUST be able to invite one or more emails with
  a chosen role (by role id); the result MUST report per-email success/failure and send invite emails.
- **FR-021**: The platform MUST let an invitee fetch an invitation by token and learn its precise
  status (valid / expired / email-mismatch / unknown) before accepting, and MUST let them accept it
  (creating the account if new and adding the membership with the invited role).
- **FR-022**: Operators with member-management rights MUST be able to change a member's role (by role
  id) and cancel a pending invitation and remove a member.
- **FR-023**: An organization MUST always retain at least one Owner; removing/demoting the last Owner
  MUST be refused.
- **FR-024**: The role-capability matrix MUST be the single authoritative source for every permission
  decision and MUST be exhaustively verifiable (every role × action cell defined).

**Projects (org-scoped)**

- **FR-025**: Every project MUST belong to exactly one organization, recorded at creation.
- **FR-026**: Creating a project MUST require an organization context and a role of at least Developer
  in that org.
- **FR-027**: The platform MUST serve an organization's projects as a **paginated** list (count +
  limit + offset) supporting sort + search, returning only that org's projects.
- **FR-028**: Project read/actions MUST be authorized by the caller's role in the project's org.

**Email**

- **FR-029**: Operators MUST be able to configure SMTP credentials during setup.
- **FR-030**: With SMTP configured, the platform MUST send organization-invitation, password-reset,
  and email-confirmation emails.
- **FR-031**: With SMTP not configured, email-dependent actions MUST surface a clear "email
  unavailable" condition rather than silently failing.

**UI surface**

- **FR-032**: The dashboard sign-in, profile, organization, role, member, invitation, and
  org-projects screens MUST be served by the existing Studio dashboard with no Studio source changes;
  the platform API MUST match the request/response shapes captured from Studio's source (see Platform
  API Surface).

### Key Entities *(include if feature involves data)*

- **Installation**: the single platform record — apex domain + backup destination (+ SMTP config).
  One per deployment; never a tenant.
- **Organization**: a tenant container identified by a **20-character reference string** (project-ref
  style — the same format as a project ref, lowercase alphanumeric; used as both its API `id` and its
  URL/path identifier, never a UUID), plus an editable display name and a self-hosted plan marker.
  Owns projects; has members.
- **Operator Account**: an operator's identity (email + password), owned by the auth service. Belongs
  to zero or more organizations; addressed by its auth id (a UUID assigned by the auth service).
- **Organization Role**: one of four fixed role objects (stable **numeric id** + name: 1 Owner,
  2 Administrator, 3 Developer, 4 Read-only), exposed via the roles endpoint and assigned to members
  by numeric id.
- **Organization Member**: the link of an operator account to an organization carrying one role
  (exposed as a single-element role-id list for dashboard compatibility).
- **Organization Invitation**: a pending invite (email + role) into an org, email-delivered,
  single-use, expiring; carries a token for the accept flow.
- **Permission**: the org-scoped capability record (resources × actions, scoped by org) the dashboard
  reads to gate UI.
- **Project**: a provisioned Supabase project owned by exactly one organization; listed per-org with
  pagination.
- **Access Token**: a machine credential (CLI/MCP) owned by an operator account; unchanged behavior.

## Platform API Surface

The dashboard (Studio, IS_PLATFORM=true) calls the paths below. Shapes were **captured from the
Studio fork source** (`apps/studio/data/**`), not approximated. Field-level shapes are pinned in
`contracts/`; the upstream platform API remains the source of truth where it and the capture agree.

**A. Built by this feature (platform-level logic):**

| Method | Path | Purpose |
|---|---|---|
| GET | `/platform/profile` | profile (incl. `disabled_features`) |
| PATCH | `/platform/profile` | update profile |
| GET | `/platform/profile/permissions` | org-scoped permission list |
| GET / POST / DELETE | `/platform/profile/access-tokens[/:id]` | PAT list/create/revoke (existing store) |
| GET / POST | `/platform/organizations` | list / create |
| GET / PATCH / DELETE | `/platform/organizations/:slug` | read / rename / delete |
| GET | `/platform/organizations/:slug/roles` | the four role objects |
| GET | `/platform/organizations/:slug/members` | list members |
| PATCH | `/platform/organizations/:slug/members/:gotrue_id` | change role (by `role_id`) |
| DELETE | `/platform/organizations/:slug/members/:gotrue_id` | remove member |
| GET / POST | `/platform/organizations/:slug/members/invitations` | list / send (`emails[]` + `role_id`) |
| DELETE | `/platform/organizations/:slug/members/invitations/:id` | cancel |
| GET / POST | `/platform/organizations/:slug/members/invitations/:token` | status / accept |
| GET | `/platform/organizations/:slug/projects` | paginated org projects |

**B. Served natively by the real auth service (no platform endpoint code):** `POST /token`,
`POST /logout`, `GET/PUT /user`, `GET /settings`, `POST /otp`, `POST /recover`, `POST /verify`,
`GET /health` — reached by the dashboard directly at the auth-service base URL.

**C. Stubbed (safe defaults so the dashboard doesn't error; not real features here):**
org `usage` / `usage/daily` / `entitlements` / `available-versions`, `profile/scoped-access-tokens`,
`members/reached-free-project-limit`, `profile/audit`.

**D. Out of scope (left unimplemented, hidden via `disabled_features` where applicable):** MFA
(`/mfa/*`, `/factors`, `members/mfa/enforcement`), social login (`/authorize`), billing
(`organizations/:slug/billing/*`, plan tiers beyond a self-hosted marker), SSO
(`organizations/:slug/sso`), project-scoped + custom roles (`role_scoped_projects`,
`project_scoped_roles` returned empty), cross-org project transfer, marketplace org creation
(`organizations/cloud-marketplace`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator signs in and the dashboard renders their profile + permissions + org list,
  with no legacy session cookie present.
- **SC-002**: 100% of CLI + MCP credential workflows that passed before the migration pass after it.
- **SC-003**: An operator creates two orgs and a Developer in one is refused on the other's project;
  each org's Projects screen lists only its own projects.
- **SC-004**: An operator invites a teammate by email and the teammate joins end-to-end (email →
  status check → accept → set password → appears with the assigned role) without further operator
  action.
- **SC-005**: Every role × action decision matches the authoritative matrix, verified exhaustively;
  the Team screen lists the four roles and assignment-by-id takes effect.
- **SC-006**: After migration, the codebase contains no legacy operator-user store, session cookie,
  or auth shim.
- **SC-007**: A password-reset email round-trips (request → email → new password → sign in).
- **SC-008**: Deleting an org is refused while it owns projects, and creating/deleting any org never
  disrupts platform routing or backups.
- **SC-009**: Every dashboard screen in scope (sign-in, profile, organizations, roles, members,
  invitations, org-projects) loads without a client error against the platform API.
- **SC-010**: An organization's URL/path identifier is a 20-character reference (e.g. `…/org/<20-char>`),
  the same format as a project ref — never a UUID; and the roles endpoint returns objects with numeric
  ids that the Team screen can assign by id.

## Assumptions

- **Greenfield cutover**: legacy accounts + tokens discarded; operators recreated, tokens re-issued.
- **Invite-only membership**: no open public signup; first operator via setup, others via invitation.
- **Auto-confirm without SMTP**: until SMTP is set, directly created accounts are usable without an
  email round-trip; confirmation applies once SMTP is in place. Invitations always require SMTP.
- **Organization identifier**: an organization is identified by a **20-character reference string**
  generated the same way as a project ref (lowercase alphanumeric, via the shared ref generator), not
  a UUID. It is immutable and serves as both the API `id` and the URL/path identifier (so org URLs
  read `…/org/<20-char>`, matching the project-ref format already used for project URLs). The display
  name is editable and is not the identifier.
- **Role model**: the four roles are served as fixed role objects with stable **numeric** ids (1 Owner,
  2 Administrator, 3 Developer, 4 Read-only) mapping 1:1 to the internal role enum; members carry
  exactly one role (returned as a single-element numeric role-id list); `role_scoped_projects` /
  `project_scoped_roles` are accepted-but-ignored / returned empty.
- **Plan/billing fields** in organization responses are filled with a constant self-hosted marker
  (no billing); billing-related profile features are hidden via `disabled_features`.
- **Installation scope**: apex domain + backup destination remain installation-level (one per
  deployment), not per-organization.
- **Studio provides the UI**: dashboard, profile, org, role, member, invitation, and org-projects
  screens come from the existing Studio dashboard; this feature builds only the backing API to match
  the shapes captured from Studio source.
- **Captured shapes are pinned**: the request/response field shapes live in `contracts/` and are
  guarded by a contract test against the captured surface.

## Out of Scope

- Multi-factor authentication (TOTP/MFA), including per-org MFA enforcement.
- Social / third-party identity-provider login for operators.
- Billing, plans, usage metering, entitlements, marketplace org creation.
- SSO configuration.
- Project-scoped roles, custom roles, and cross-org project transfer.
- Per-organization apex domains or backup destinations (these stay installation-level).
- Any change to the Supabase CLI or MCP wire protocols.
