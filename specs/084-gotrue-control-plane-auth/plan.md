# Implementation Plan: GoTrue Control-Plane Auth + Multi-Tenant Orgs + Cloud RBAC

**Branch**: `084-gotrue-control-plane-auth` | **Date**: 2026-06-02 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/084-gotrue-control-plane-auth/spec.md`

## Summary

Replace supastack's hand-rolled human authentication (Redis `sb_sid` session + the `studio-gotrue.ts`
JWT shim + the bespoke `users` table) with a **real GoTrue service in the control plane**, and add
**multi-tenant organizations** with **Supabase-Cloud-style RBAC** (Owner / Administrator / Developer /
Read-only), **member management + email invites**, and **email (SMTP)**. GoTrue access+refresh JWTs
become the only human credential; machine credentials (PATs, OAuth 2.1 MCP) stay and re-resolve their
user against `auth.users`. Every project belongs to exactly one organization; org role governs project
access. Greenfield cutover (operators recreated, tokens re-issued). Studio (IS_PLATFORM=true) supplies
the login + org + member UI; this feature builds only the backing platform API. No MFA, no social login.

## Technical Context

**Language/Version**: TypeScript (Node 20/22, ESM) across `apps/api`, `apps/worker`, `apps/web`;
GoTrue (Go) consumed as a prebuilt container.

**Primary Dependencies**: Fastify (api), BullMQ (worker), Drizzle ORM, ioredis, React+Vite (web),
Studio (Next.js, IS_PLATFORM). **New**: `supabase/gotrue:v2.186.0` control-plane service (same image
already used per-instance).

**Storage**: PostgreSQL 16 (control `db`). New `auth` schema owned by GoTrue (its own migrations);
`public` schema (Drizzle) gains `installation`, `organizations`, `organization_members`,
`organization_invitations`, and `supabase_instances.organization_id`; drops `users`, `org`, `invites`.

**Testing**: Vitest (unit, security-sensitive: JWT verify, RBAC matrix, slug/invite token); RBAC
matrix contract test (every role×action cell); live-VM E2E shell scripts (`tests/cli-e2e/`) for the
auth/login/invite happy+sad paths; Playwright (`apps/web`) only for `/setup`.

**Target Platform**: Single Linux VM, Docker Compose control-plane stack.

**Project Type**: Web service monorepo (control plane) + a new GoTrue sidecar service.

**Performance Goals**: No new hot path. Per-request human auth = one JWT verify + one membership
lookup (same cost class as today's session/shim). Not latency-sensitive.

**Constraints**: Single VM, greenfield cutover; GoTrue JWT secret = `HKDF(master key)` (no new
secret); PAT/OAuth/CLI/MCP wire behavior unchanged; idempotent + (intentionally destructive at the
cutover) migrations; SMTP operator-provided; no MFA/social/billing.

**Scale/Scope**: Small operator count (1–dozens), a handful of organizations, tens of projects.
Control-plane auth + org/member surface only.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

| Principle | Status | How this feature complies |
|---|---|---|
| **I. Idempotent, Additive Schema Evolution** | ✅ (1 justified destructive change) | New tables/columns via `IF NOT EXISTS`; re-runnable. The cutover **drops** `users`/`org`/`invites` — an *intentional, approved* destructive change (greenfield), the explicit exception the principle allows. Recorded in Complexity Tracking. |
| **II. Secrets Stay Encrypted, Master Key Stays Home** | ✅ | `GOTRUE_JWT_SECRET` derived via HKDF from the master key (new label `supastack-gotrue-jwt-v1`); no new standalone secret. Operator SMTP credentials stored encrypted (envelope) in `installation`, injected into GoTrue at compose-up. |
| **III. Authorize Every Privileged Action** | ✅ | New 4-role matrix in `packages/shared/src/rbac.ts`; `authorize(req, action, orgId)` org-scoped; every role×action cell defined + contract-tested. |
| **IV. Supabase Compatibility Is a Pinned Contract** | ✅ | Org/member platform endpoints matched to upstream platform-API shapes (snapshot + contract test under `contracts/`). PAT/OAuth/CLI/MCP wire surface unchanged; GoTrue endpoints are GoTrue's own (inherently compatible with Studio). |
| **V. The Worker Owns Per-Instance State** | ✅ | Org-scoping threads `organization_id` through the existing provision job; no new per-instance state path. Invite/reset emails are sent by GoTrue (the service), not ad-hoc from the api. |
| **VI. Spec-Driven, Evidence-Based Delivery** | ✅ | This spec→plan→tasks→implement flow; security-sensitive logic unit-tested; auth/invite paths covered by live-VM E2E with reported evidence. |

**Result**: PASS. One justified destructive migration (the greenfield drop of legacy auth tables),
documented below. No other deviations.

## Project Structure

### Documentation (this feature)

```text
specs/084-gotrue-control-plane-auth/
├── plan.md              # This file
├── spec.md              # Feature specification
├── research.md          # Phase 0 — decisions (GoTrue wiring, JWT secret, SMTP, cutover)
├── data-model.md        # Phase 1 — tables, fields, relationships, migrations
├── quickstart.md        # Phase 1 — bring-up + happy/sad-path verification
├── contracts/           # Phase 1 — platform API + auth contracts
│   ├── auth-session.md         # GoTrue token validation in the api preHandler
│   ├── organizations.md        # /platform/organizations CRUD
│   └── organization-members.md # members list/invite/role/remove + invite-accept
└── checklists/
    └── requirements.md  # Spec quality checklist (from /speckit-specify)
```

### Source Code (repository root)

```text
infra/
├── docker-compose.yml                 # + `auth` (GoTrue) control-plane service; api gets GOTRUE_* env
└── supabase-template/                  # (unchanged here)

packages/
├── db/
│   ├── src/schema/identity.ts          # + installation, organizations, organization_members,
│   │                                   #   organization_invitations; drop users/org/invites
│   ├── src/schema/instances.ts         # + organization_id on supabase_instances
│   └── migrations/00NN_gotrue_orgs.sql # idempotent additive + the cutover drop (guarded)
├── shared/
│   └── src/rbac.ts                     # ROLES → 4 Cloud roles; matrix role×action; org-scoped
└── crypto/                             # reuse HKDF + envelope (no change)

apps/
├── api/
│   ├── src/plugins/auth.ts             # preHandler: GoTrue-JWT branch replaces session+shim
│   ├── src/plugins/rbac.ts             # authorize(req, action, orgId)
│   ├── src/services/gotrue-admin.ts    # (new) GoTrue admin API client (create user, invite, reset)
│   ├── src/services/gotrue-jwt.ts      # (new) HKDF secret + GoTrue JWT verify
│   ├── src/services/caddy-config.ts    # read installation (not org) for apex
│   ├── src/routes/platform-organizations.ts  # (new) org CRUD
│   ├── src/routes/platform-members.ts        # (new) members + invitations + accept
│   ├── src/routes/setup.ts             # first operator via GoTrue admin + first org + owner
│   ├── src/routes/org.ts, members.ts   # fold into platform-* / installation settings
│   └── (delete) src/routes/studio-gotrue.ts; remove sign/verifyStudioJwt + sb_sid session
├── worker/
│   └── src/jobs/provision.ts           # carry organization_id
└── web/
    └── src/ (setup wizard + remaining authed pages → GoTrue Bearer)
```

**Structure Decision**: Standard supastack monorepo. The feature adds one control-plane service
(GoTrue), evolves `packages/db` + `packages/shared/rbac.ts`, rewrites the api auth/rbac plugins,
adds two new platform route files, and reworks `/setup`. Studio is untouched (it already speaks
GoTrue + platform API). `apps/web` shrinks to `/setup` + Bearer-authed remnants.

## Complexity Tracking

| Violation | Why Needed | Simpler Alternative Rejected Because |
|---|---|---|
| Cutover migration **drops** `users`, `org`, `invites` (destructive, vs Principle I's additive default) | Greenfield migration was explicitly approved; identity moves to GoTrue's `auth.users` and the singleton `org` is split into `installation` + `organizations`. Keeping the legacy tables would leave two competing identity sources + the conflated singleton. | A non-destructive "additive + dual-write" path was rejected: it doubles the identity surface, keeps the bespoke `users`/session code the feature exists to retire, and has no value on a test-only VM with no production data to preserve. |
| New control-plane **service** (GoTrue) | Drivers require real signup/invites/reset/email + retiring bespoke crypto — only a real auth service delivers them. | The existing hand-rolled shim was rejected: it cannot do invites/reset/email and is exactly the surface to remove. |
