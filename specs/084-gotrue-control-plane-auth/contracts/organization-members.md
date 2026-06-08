# Contract — Org Members, Roles & Invitations (platform API)

Shapes captured from Studio source (`apps/studio/data/organization-members/*`,
`organizations/organization-members-query.ts`). Members are addressed by **`gotrue_id`** (the auth
user id) and carry **`role_ids: number[]`** (we return one). Roles are **objects with numeric ids**,
not an enum on the wire. Authorize against the caller's role in `:slug`'s org.

## GET /platform/organizations/:slug/roles
The role list the Team screen renders + assigns from. (`organization-roles-query.ts`, `Version: 2`)
- **200**: `{ org_scoped_roles: Role[], project_scoped_roles: [] }` where
  `Role = { id: number, name: 'Owner'|'Administrator'|'Developer'|'Read-only', description,
  base_role_id: number, projects: [] }`.
- **Fixed mapping** (stable ids): `1 Owner, 2 Administrator, 3 Developer, 4 Read-only`. `base_role_id`
  = the role's own id. `project_scoped_roles` always `[]` (project-scoped roles out of scope).

## GET /platform/organizations/:slug/members
(`organization-members-query.ts`) Authorize `org.members.list` (any member).
- **200**: `Member[]`, each `{ gotrue_id, primary_email, username, role_ids: [<id>], mfa_enabled:
  false, is_sso_user: false, metadata: {} }`. `primary_email`/`username` from `auth.users`.
- Studio fetches invitations separately and merges them into this list client-side.

## PATCH /platform/organizations/:slug/members/:gotrue_id
Change role. (`organization-member-role-assign-mutation.ts`, `Version: 2`)
- Body: `{ role_id: number, role_scoped_projects?: string[] }`. `role_scoped_projects` accepted but
  ignored. Authorize `org.members.update-role` (Owner/Administrator).
- **200**: updated member. Sad: demoting the **last Owner** → **409** (FR-023); insufficient role →
  `403`; unknown `role_id` → `400`.

## DELETE /platform/organizations/:slug/members/:gotrue_id
- Authorize `org.members.remove`. **200/204**. Sad: removing the **last Owner** → `409`; else `403`.

## GET /platform/organizations/:slug/members/invitations
(`organization-members-query.ts`) → **200**: `{ invitations: [{ id, invited_email, invited_at,
role_id }] }`.

## POST /platform/organizations/:slug/members/invitations
Send invites. (`organization-invitation-create-mutation.ts`)
- Body: `{ emails: string[], role_id: number, role_scoped_projects?: string[], require_sso?: bool }`.
  Authorize `org.members.invite` (Owner/Administrator).
- **200**: `{ succeeded: string[], failed: [{ email, error }] }`. Side effects: insert one
  `organization_invitations` row per email + send each invite email.
- Sad: SMTP not configured → **409** "email unavailable" (FR-031); invalid `role_id` → `400`;
  insufficient role → `403`.

## DELETE /platform/organizations/:slug/members/invitations/:id
Cancel a pending invite. Authorize `org.members.invite`. **200/204**.

## GET /platform/organizations/:slug/members/invitations/:token
Pre-accept status check (invitee-facing). (`organization-invitation-token-query.ts`)
- **200**: `{ authorized_user: bool, email_match: bool, expired_token: bool, invite_id?: number,
  organization_name: string, sso_mismatch: false, token_does_not_exist: bool }`.

## POST /platform/organizations/:slug/members/invitations/:token
Accept (no body). (`organization-invitation-accept-mutation.ts`)
- **200**: creates the auth user if new (sets password via the auth service), inserts
  `organization_members(role from invite)`, marks consumed.
- Sad: expired/consumed/unknown token → reflected by the GET status; accept returns `400`/`410`.

## Acceptance (happy + sad)
- **Happy**: Team screen loads roles + members + pending invites; invite `["dev@x.com"]` with
  `role_id=3` → `succeeded:["dev@x.com"]`, email sent; accept → member with `role_ids:[3]`; PATCH to
  `role_id=4` → a project write then `403`.
- **Sad**: remove/demote the only `role_id=1` (Owner) → `409`; invite when SMTP unset → `409`;
  GET an expired token → `expired_token:true`; accept it → `410`.
