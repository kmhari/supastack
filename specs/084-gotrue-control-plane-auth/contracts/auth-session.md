# Contract — Auth Session (GoTrue JWT validation)

## Routing
- Caddy dashboard host: `/auth/v1/*` → `auth:9999` (`strip_path_prefix /auth/v1`). Studio's
  `NEXT_PUBLIC_GOTRUE_URL=https://<apex>/auth/v1`.
- The api never proxies login; it validates the bearer JWT and performs admin ops server-side.

## Inbound credential (human)
`Authorization: Bearer <gotrue-access-jwt>` (HS256).

**api preHandler validation** (replaces the `sb_sid` session + studio-shim branches):
1. Verify signature with `HKDF(masterKey, "supastack-gotrue-jwt-v1")`.
2. Reject if `exp` elapsed or `sub` missing/empty → `401`.
3. Resolve `sub` (GoTrue user id) → `organization_members` for org-scoped role; resolve email via
   `auth.users`. No membership in the relevant org for a protected org/project action → `403`.

**Claims consumed**: `sub` (user id), `email`, `role` (`authenticated`), `exp`, `iss`. supastack org
role comes from `organization_members`, NOT from the JWT.

## Admin operations (api → GoTrue, server-side)
A short-lived `service_role` JWT (HKDF secret, `role: service_role`) authorizes:
- `POST /admin/users` — create the first operator (`/setup`) + invite-accept account creation.
- `POST /invite` — deliver an invitation email (transport only; role tracked in supastack).
- `POST /recover` — password-reset email.

## Success criteria mapping
- SC-001: human request authenticates via GoTrue JWT; no `sb_sid` cookie set.
- SC-006: no `sb_sid` session, no `studio-gotrue.ts`, no `users` table remain.

## Acceptance (happy + sad)
- **Happy**: valid unexpired GoTrue JWT for a member of org X → protected org-X call returns `200`.
- **Sad — expired**: expired JWT → `401`.
- **Sad — wrong org**: valid JWT, caller not a member of the project's org → `403`.
- **Sad — tampered**: signature mismatch → `401`.
