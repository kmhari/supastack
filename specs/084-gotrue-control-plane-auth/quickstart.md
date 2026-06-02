# Quickstart — GoTrue Control-Plane Auth + Orgs

How to bring the feature up on the test VM and verify the happy + sad paths. Greenfield: this wipes
legacy operator accounts.

## Bring-up

1. **Add the `auth` service** to `infra/docker-compose.yml` (image `supabase/gotrue:v2.186.0`,
   `GOTRUE_DB_DATABASE_URL` → control `db` `auth` schema, `GOTRUE_JWT_SECRET` = HKDF-derived value,
   `GOTRUE_DISABLE_SIGNUP=true`, `GOTRUE_MAILER_AUTOCONFIRM=true`, `GOTRUE_SITE_URL=https://<apex>`).
   Give the api the same derived secret + the GoTrue admin URL.
2. **Migrate**: run the idempotent `00NN_gotrue_orgs.sql` (creates `installation`/`organizations`/
   members/invitations, adds `supabase_instances.organization_id`, repoints `api_tokens`, drops
   `users`/`org`/`invites`). Re-run it once to confirm it is a no-op.
3. **Caddy**: add `/auth/v1/*` → `auth:9999` (strip prefix); reload (`POST /internal/caddy/reload`).
4. **Studio**: set `NEXT_PUBLIC_GOTRUE_URL=https://<apex>/auth/v1`; rebuild only if env is baked.
5. **`/setup`**: run the wizard → creates the first operator (GoTrue admin), the first organization,
   the owner membership, and the `installation` singleton.

## Verify — happy paths

- **Sign in** at `https://<apex>/dashboard` with the operator email+password → dashboard loads
  authenticated; confirm **no `sb_sid` cookie** is set (SC-001).
- **CLI** `supabase login` with a re-issued PAT → a Management API call succeeds (SC-002).
- **MCP** OAuth token → an MCP tool call succeeds (SC-002).
- **Orgs**: create a second org; it appears with `role=owner`; rename it; create a project in each
  org; confirm each org lists only its own project (SC-003).
- **Invite**: invite a teammate email as `developer` (with SMTP configured) → email arrives → accept
  → member appears as `developer` (SC-004). Change them to `read_only` → a project write returns
  `403` (SC-005).
- **Password reset**: request reset → email → set new password → sign in (SC-007).

## Verify — sad paths

- Delete an org that owns a project → `409` (SC-008); platform routing + backups unaffected.
- Remove/demote the only `owner` → `409` (FR-019).
- Expired/consumed invite token on accept → `410`.
- Invite while SMTP unset → `409` "email unavailable" (FR-027).
- Expired/tampered GoTrue JWT → `401`; valid JWT for a non-member of the target org → `403`.

## Done criteria

- Codebase contains no `studio-gotrue.ts`, no `sign/verifyStudioJwt`, no `sb_sid` session, no
  `users` table (SC-006).
- RBAC matrix contract test passes (every role×action cell defined; no role exceeds its Cloud peer).
