# Contract — Profile, Permissions & Access Tokens (platform API)

Shapes captured from Studio source (`apps/studio/data/profile/*`, `data/permissions/*`,
`data/access-tokens/*`). These bootstrap the dashboard immediately after sign-in.

## GET /platform/profile
(`profile-query.ts`, `Version: 2`)
- **200**: `{ id, gotrue_id, primary_email, username, first_name, last_name, auth0_id: null, mobile:
  null, free_project_limit: <int>, is_sso_user: false, is_alpha_user: false, disabled_features:
  string[] }`.
- **`disabled_features`** (self-hosted default) hides what we don't implement:
  `["billing:account_data","billing:credits","billing:invoices","billing:payment_methods",
  "projects:transfer"]`. We KEEP enabled: `organizations:create/delete`,
  `organization_members:create/delete`, `projects:create`, `profile:update`, `project_*:all`,
  `realtime:all`.

## PATCH /platform/profile
(`profile-update-mutation.ts`)
- Body: `{ first_name?, last_name?, username?, primary_email? }`. Maps to the auth service's user
  update for email/identity; name/username stored in the profile projection.
- **200**: the updated profile (same shape as GET).

## GET /platform/profile/permissions
(`permissions-query.ts`) The org-scoped capability list the dashboard uses for client-side gating.
- **200**: `Permission[]`, each `{ organization_id, organization_slug, project_ids: null,
  project_refs: null, resources: string[], actions: string[], condition: null, restrictive: false }`.
  `organization_id` = `organization_slug` = the org's 20-char ref (no UUIDs).
- Derived from the caller's memberships + role matrix: for each org the caller belongs to, emit
  permission entries whose `actions`/`resources` reflect that role's capabilities (Owner = broad;
  Read-only = read resources only). Must be consistent with server-side `authorize()` — the server
  remains authoritative; this array only drives UI affordances.

## Access tokens (PATs) — alias the existing store
(`data/access-tokens/*`)
- **GET /platform/profile/access-tokens** → `AccessToken[]`:
  `{ id, name, token_alias, created_at, expires_at, last_used_at, scope: 'V0' }`.
- **POST /platform/profile/access-tokens** body `{ name, scope?: 'V0', expires_at?: ISO }` →
  `{ ...token, token: '<plaintext shown once> }`.
- **DELETE /platform/profile/access-tokens/:id** → success.
- Backed by the existing `api_tokens` store (now keyed on the auth user id); behavior unchanged.

## Stubs (return safe defaults)
`GET /platform/profile/scoped-access-tokens` → `[]`; `GET /platform/profile/audit` → `[]`.

## Acceptance (happy + sad)
- **Happy**: after sign-in, GET profile returns the operator's identity + `disabled_features`; GET
  permissions returns ≥1 entry for the operator's org; PATCH profile updates the username.
- **Sad**: unauthenticated GET profile → `401`; permissions for an operator in zero orgs → `[]`.
