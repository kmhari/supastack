# Phase 0 — Research & Decisions

Feature: GoTrue Control-Plane Auth + Multi-Tenant Orgs + Cloud RBAC. All "NEEDS CLARIFICATION" from
Technical Context resolved below.

## D1 — GoTrue image & database wiring

**Decision**: Run `supabase/gotrue:v2.186.0` (the exact image already used per-instance) as a new
`auth` control-plane service in `infra/docker-compose.yml`, pointed at the control `db` via
`GOTRUE_DB_DATABASE_URL` using a dedicated `supabase_auth_admin` role on its own `auth` schema. GoTrue
runs its own migrations against that schema on boot.

**Rationale**: Reusing the pinned image keeps one GoTrue version across control + data planes and
avoids a new dependency. GoTrue owns `auth.*`; Drizzle owns `public.*` in the same database, so the
api can `SELECT auth.users` for email resolution without cross-service calls.

**Alternatives considered**: A separate Postgres for auth (rejected — needless second DB on a single
VM, breaks single-transaction reads joining members↔users); building auth into the api (rejected —
that is the bespoke shim we are removing).

## D2 — JWT secret derivation & validation

**Decision**: `GOTRUE_JWT_SECRET = HKDF(masterKey, label="supastack-gotrue-jwt-v1")` (hex/base64
string GoTrue accepts). The api derives the identical value in `gotrue-jwt.ts` and verifies inbound
GoTrue HS256 JWTs: signature, `exp`, and a non-empty `sub`; it then resolves `sub` → membership/role.

**Rationale**: Constitution II — no new standalone secret; consistent with the existing
`studio-jwt`/`oauth` HKDF pattern. Symmetric HS256 lets the api validate without a JWKS fetch.

**Alternatives considered**: A standalone `GOTRUE_JWT_SECRET` env (rejected — new secret to manage +
rotate); RS256 + JWKS (rejected — GoTrue self-hosted default is HS256; asymmetric adds key plumbing
for no benefit here).

## D3 — GoTrue control-plane configuration

**Decision**:
- `GOTRUE_DISABLE_SIGNUP=true` (invite-only; first operator via admin API at `/setup`).
- `GOTRUE_MAILER_AUTOCONFIRM=true` **until** SMTP is configured, then flip to confirmation-on.
- `GOTRUE_SITE_URL = https://<apex>` (used for email links + redirect base).
- `GOTRUE_JWT_AUD=authenticated`, default `authenticated`/`service_role` roles.
- `GOTRUE_EXTERNAL_*` providers all off (no social). `GOTRUE_MFA_*` off.

**Rationale**: Matches the approved scope (invite-only, no MFA/social) and lets Phase "email" land by
configuring SMTP without re-architecting.

**Alternatives considered**: Open signup (rejected per spec FR-004).

## D4 — How Studio + the api reach GoTrue

**Decision**: Add a Caddy route on the apex/dashboard host: `/auth/v1/*` → `auth:9999` with
`strip_path_prefix /auth/v1` (mirrors the per-instance Kong mapping). Set Studio
`NEXT_PUBLIC_GOTRUE_URL=https://<apex>/auth/v1`. Studio's sign-in/token/recover/verify calls go
straight to GoTrue. The api does **not** proxy login; it only (a) validates the resulting JWT and
(b) calls GoTrue's admin API server-side for create-user / invite / reset.

**Rationale**: Direct browser→GoTrue is the standard Supabase topology; keeps the api off the login
hot path. Path-prefix routing reuses the existing `caddy-config.ts` dashboard subroutes pattern.

**Alternatives considered**: Proxy every GoTrue call through the api (rejected — re-introduces a shim
layer); a `gotrue.<apex>` subdomain (rejected — extra cert/route for no gain; same-origin is simpler
for Studio cookies/tokens).

## D5 — Admin operations (create user, invite, reset)

**Decision**: A server-side `gotrue-admin.ts` client mints a short-lived `service_role` JWT (HKDF
secret, `role=service_role`) and calls GoTrue admin endpoints: `POST /admin/users` (first operator +
invite-accept account creation), `POST /invite` / `POST /recover` (email flows). The platform
member/setup routes orchestrate these alongside the `public` membership writes in one logical flow.

**Rationale**: Keeps identity writes inside GoTrue (single source of truth) while supastack owns the
authorization records (`organization_members`).

**Alternatives considered**: Writing `auth.users` rows directly via SQL (rejected — bypasses GoTrue
password hashing/identity invariants; brittle across GoTrue versions).

## D6 — Invitations: GoTrue invite vs supastack table

**Decision**: Keep a supastack `organization_invitations` table (org_id, email, role, token,
invited_by, expires, accepted) as the **authorization** record, and use GoTrue's mailer to deliver
the email. Accept flow: verify the supastack invite token → create/locate the GoTrue user → insert
`organization_members`. The role lives in supastack (GoTrue has no concept of org roles).

**Rationale**: Roles + org scoping are supastack concerns; GoTrue only handles identity + email
transport. This mirrors the existing `invites` table, just evolved to 4 roles + email send.

**Alternatives considered**: Encode role in GoTrue `user_metadata` (rejected — role is org-scoped and
mutable; belongs in the membership row, not the global user).

## D7 — Greenfield cutover & migration ordering

**Decision**: One idempotent migration: create `installation` (singleton) + move apex/backup fields
from `org`; create `organizations`, `organization_members` (role enum: owner/administrator/developer/
read_only), `organization_invitations`; add `supabase_instances.organization_id`; repoint
`api_tokens.user_id` → `auth.users(id)`; then **drop** `users`, `org`, `invites`. The drop is guarded
(`DROP TABLE IF EXISTS`) and ordered after dependents are repointed. GoTrue's `auth` schema must
exist first (auth service boots before the migration runs, or the migration tolerates its absence for
the FK by using a soft reference).

**Rationale**: Greenfield (D-approved) — no data to preserve; a single migration keeps the cutover
atomic and re-runnable. Constitution I exception is documented in plan Complexity Tracking.

**Alternatives considered**: Dual-write/backfill (rejected — no production data; doubles surface).

**Open sequencing note**: `auth.users` is created by GoTrue, not Drizzle. To avoid a hard
cross-schema FK ordering dependency at migrate time, `organization_members.user_id` /
`api_tokens.user_id` reference `auth.users(id)` as a deferred/soft FK (or a trigger-validated
reference); finalize in data-model.md.

## D8 — PAT / OAuth re-resolution

**Decision**: The api preHandler's PAT (`sbp_*`) and OAuth-JWT branches are unchanged except their
user join targets `auth.users` (email) + `organization_members` (role, org-scoped) instead of the
dropped `users`. `api_tokens.user_id` now holds the GoTrue user id.

**Rationale**: Constitution IV — zero CLI/MCP wire change; only the identity lookup source moves.

**Alternatives considered**: Issuing PATs through GoTrue (rejected — PATs are a supastack construct
GoTrue doesn't model; out of scope).

## D9 — Org-scoped authorization shape

**Decision**: `authorize(req, action, orgId)`. For project routes, resolve `orgId` from the project's
`organization_id`; for org routes, from the path slug. The matrix is `role × action`; the resolver
looks up `req.user.id`'s role in `orgId`. Last-owner invariant enforced in the member-mutation
handlers (not the matrix).

**Rationale**: Minimal, explicit, testable; keeps the matrix pure (role×action) and contextual
resolution in the decorator.

**Alternatives considered**: Caching all memberships on `req.user` (deferred — fine for small member
counts; revisit if membership sets grow).
