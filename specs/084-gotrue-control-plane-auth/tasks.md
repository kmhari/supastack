# Tasks: GoTrue Control-Plane Auth + Multi-Tenant Orgs + Cloud RBAC

**Feature**: `084-gotrue-control-plane-auth` · **Spec**: [spec.md](./spec.md) · **Plan**: [plan.md](./plan.md)

## Format: `[ID] [P?] [Story] Description`

- **[P]**: can run in parallel (different files, no dependency on an incomplete task)
- **[USn]**: the user story the task serves (story phases only)
- Every task names an exact file path.

## Path Conventions

Monorepo: `infra/`, `packages/db`, `packages/shared`, `packages/crypto`, `apps/api/src`,
`apps/worker/src`, `apps/web/src`, tests in `apps/api/tests`, `packages/*/tests`, `tests/cli-e2e`.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: stand up the GoTrue service + the routing/secret plumbing every story needs.

- [X] T001 Add the `auth` (GoTrue `supabase/gotrue:v2.186.0`) service to `infra/docker-compose.yml`: `GOTRUE_DB_DATABASE_URL` → control `db` `auth` schema, `GOTRUE_DISABLE_SIGNUP=true`, `GOTRUE_MAILER_AUTOCONFIRM=true`, `GOTRUE_SITE_URL=https://${SUPASTACK_APEX}`, `GOTRUE_JWT_SECRET` (derived, see T003), MFA + external providers off
- [X] T002 [P] Bootstrap the `supabase_auth_admin` role + `auth` schema + grants on the control `db` via an idempotent SQL init in `packages/db/migrations/` so GoTrue can run its own migrations
- [X] T003 [P] Implement the GoTrue JWT secret derivation `HKDF(masterKey,'supastack-gotrue-jwt-v1')` in `apps/api/src/services/gotrue-jwt.ts` and inject the identical value as `GOTRUE_JWT_SECRET` in `infra/docker-compose.yml`
- [X] T004 [P] Add the Caddy route `/auth/v1/*` → `auth:9999` with `strip_path_prefix /auth/v1` in `apps/api/src/services/caddy-config.ts` (dashboard subroutes, before the catch-all)
- [X] T005 Repoint Studio `NEXT_PUBLIC_GOTRUE_URL` → `https://${SUPASTACK_APEX}/auth/v1` in `infra/docker-compose.yml` (studio service)

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: schema cutover + auth/RBAC plumbing that ALL stories depend on. ⚠️ No story can start until this phase is done.

- [X] T006 Write the idempotent migration `packages/db/migrations/00NN_gotrue_orgs.sql`: create `installation` singleton (copy `apex_domain` + `backup_store_*` from `org`); create `organizations` (**`id text` 20-char ref PK**), `organization_members`, `organization_invitations`; repurpose `supabase_instances`' existing `org.id` reference into `organization_id text` → `organizations(id)`; repoint `api_tokens.user_id` → `auth.users(id)`; then `DROP TABLE IF EXISTS org_members, invites, users, org` (guarded, dependents first). Must be re-runnable (Constitution I)
- [X] T007 Update the Drizzle schema in `packages/db/src/schema/identity.ts` (add `installation`, `organizations`, `organization_members`, `organization_invitations`; remove `users`/`org`/`invites`) and `packages/db/src/schema/instances.ts` (`organization_id text` FK)
- [X] T008 Rewrite the RBAC matrix in `packages/shared/src/rbac.ts`: `ROLES = [owner, administrator, developer, read_only]`, new actions (`org.create/update/delete`, `org.members.list/invite/update-role/remove`), full role×action `MATRIX`
- [X] T009 [P] Add the role-id ↔ enum mapping (`1 owner, 2 administrator, 3 developer, 4 read_only` + names) in `packages/shared/src/rbac.ts`, used by the roles + members endpoints
- [X] T010 [P] RBAC matrix contract test (every role×action cell asserted) in `packages/shared/tests/rbac.test.ts` — happy (allowed cells) + sad (denied cells), plus the role-id mapping
- [X] T011 [P] Implement GoTrue JWT verify (HS256 sig + `exp` + non-empty `sub`) in `apps/api/src/services/gotrue-jwt.ts` + unit test `apps/api/tests/unit/gotrue-jwt.test.ts` — happy (valid) + sad (expired, tampered, missing sub)
- [X] T012 [P] Implement the `gotrue-admin` client in `apps/api/src/services/gotrue-admin.ts`: mint a `service_role` JWT + `POST /admin/users`, `POST /invite`, `POST /recover`
- [X] T013 Rewrite the preHandler in `apps/api/src/plugins/auth.ts`: one GoTrue-JWT branch (verify → `sub` → `organization_members` role) replacing the session-cookie + studio-JWT branches; PAT + OAuth branches join `auth.users` for email; remove the `fastify-session`/`sb_sid` registration
- [X] T014 Rewrite `apps/api/src/plugins/rbac.ts`: `authorize(req, action, orgId)` resolving the caller's role in `orgId` (project actions resolve project → org)
- [X] T015 Delete `apps/api/src/routes/studio-gotrue.ts`, remove `signStudioJwt`/`verifyStudioJwt` from `apps/api/src/plugins/auth.ts`, and drop the route registration in `apps/api/src/server.ts`
- [X] T016 [P] Point `apps/api/src/services/caddy-config.ts` + the backup-store loader at the `installation` singleton instead of `org` (apex_domain + backup_store_*)

**Checkpoint**: schema migrated + re-runnable, GoTrue validates, RBAC matrix green, shim/session/`users` gone.

---

## Phase 3: User Story 1 — Operator signs in with a real account (Priority: P1) 🎯 MVP

**Goal**: an operator created in GoTrue signs in and the dashboard bootstraps (profile + permissions + org list).

**Independent test**: run `/setup`, sign in at the apex, confirm the dashboard renders the operator's
profile/permissions and the setup-created org — with no `sb_sid` cookie.

- [X] T017 [US1] Rework `apps/api/src/routes/setup.ts`: create the first operator via `gotrue-admin` (`POST /admin/users`), insert the `installation` row, create the first organization (20-char ref via `generateRef`), insert the owner membership
- [X] T018 [P] [US1] `GET /platform/profile` in `apps/api/src/routes/platform-profile.ts` → `{id, gotrue_id, primary_email, username, first_name, last_name, free_project_limit, disabled_features:[billing:*, projects:transfer]}`
- [X] T019 [P] [US1] `PATCH /platform/profile` (first/last name, username) in `apps/api/src/routes/platform-profile.ts`
- [X] T020 [P] [US1] `GET /platform/profile/permissions` in `apps/api/src/routes/platform-profile.ts` — derive org-scoped `Permission[]` from memberships + the matrix
- [X] T021 [US1] `GET /platform/organizations` (list caller's orgs with `is_owner` + self-hosted `plan` marker) in `apps/api/src/routes/platform-organizations.ts`
- [X] T022 [P] [US1] Contract test `apps/api/tests/unit/platform-profile.test.ts` — happy (authed → profile + permissions) + sad (401 unauth, `[]` permissions for zero-org operator)
- [X] T023 [US1] Live-VM E2E `tests/cli-e2e/gotrue-signin.sh` — happy (sign in → dashboard bootstrap) + sad (expired/tampered JWT → 401, non-member → 403); assert no `sb_sid` cookie (SC-001, SC-006)
- [ ] T024 [P] [US1] Remove the bespoke `apps/web` login page + cookie usage; authed `apps/web` pages attach the GoTrue Bearer token (`apps/web/src/`)

**Checkpoint**: MVP — sign-in + dashboard bootstrap works end-to-end against real GoTrue.

---

## Phase 4: User Story 2 — CLI and MCP keep working unchanged (Priority: P1)

**Goal**: PAT + MCP OAuth credentials authenticate against the new identity source with zero wire change.

**Independent test**: `supabase login` (PAT) → Management API call succeeds; MCP OAuth tool call succeeds.

- [X] T025 [US2] Regression-guard the PAT + OAuth branches in `apps/api/src/plugins/auth.ts`: resolve email from `auth.users`, role from `organization_members`; `api_tokens.user_id` = GoTrue user id
- [X] T026 [P] [US2] Access-tokens platform alias `GET/POST/DELETE /platform/profile/access-tokens` → existing `api_tokens` store, `AccessToken` shape, in `apps/api/src/routes/platform-profile.ts`
- [X] T027 [P] [US2] Contract test `apps/api/tests/unit/access-tokens.test.ts` — happy (list/create/revoke) + sad (revoked token → 401)
- [X] T028 [US2] Live-VM E2E `tests/cli-e2e/cli-mcp-regression.sh` — `supabase login` PAT → Mgmt API call passes; MCP OAuth tool call passes (SC-002)

**Checkpoint**: no machine-credential regression.

---

## Phase 5: User Story 3 — Create, rename, and delete organizations (Priority: P2)

**Goal**: multi-org CRUD with 20-char refs.

**Independent test**: create two orgs (assert 20-char ids), rename one, delete an empty one, and have
delete refused when the org owns a project.

- [ ] T029 [P] [US3] `POST /platform/organizations` (create; `generateRef` 20-char id with clash retry; owner membership; `tier` → plan marker) in `apps/api/src/routes/platform-organizations.ts`
- [ ] T030 [P] [US3] `GET /platform/organizations/:slug` (detail, `OrganizationSlugResponse`) in `apps/api/src/routes/platform-organizations.ts`
- [ ] T031 [P] [US3] `PATCH /platform/organizations/:slug` (rename; authorize `org.update`) in `apps/api/src/routes/platform-organizations.ts`
- [ ] T032 [US3] `DELETE /platform/organizations/:slug` (authorize `org.delete`, owner-only; 409 if it owns projects) in `apps/api/src/routes/platform-organizations.ts`
- [ ] T033 [US3] Contract test `apps/api/tests/unit/platform-organizations.test.ts` — happy (create/list/rename/delete-empty; assert 20-char id) + sad (blank name 400, delete-with-projects 409, non-owner 403)
- [ ] T034 [US3] Live-VM E2E `tests/cli-e2e/orgs-crud.sh` — two orgs with 20-char ids, rename, delete-empty, delete-with-project refused (SC-008, SC-010)

**Checkpoint**: organizations are first-class + isolated from installation routing/backups.

---

## Phase 6: User Story 4 — Invite and manage members with Cloud roles (Priority: P2)

**Goal**: roles list + members + invitations, with numeric role ids + the last-owner invariant.

**Independent test**: invite an email as Developer, accept end-to-end, change to Read-only, confirm a
write is then refused; the only Owner can't be removed/demoted.

- [ ] T035 [P] [US4] `GET /platform/organizations/:slug/roles` — `{org_scoped_roles:[{id,name,description,base_role_id,projects:[]}], project_scoped_roles:[]}` (4 numeric-id roles) in `apps/api/src/routes/platform-members.ts`
- [ ] T036 [P] [US4] `GET /platform/organizations/:slug/members` (`Member[]` with `role_ids:[n]`, email/username from `auth.users`) in `apps/api/src/routes/platform-members.ts`
- [ ] T037 [US4] `PATCH /platform/organizations/:slug/members/:gotrue_id` (role by `role_id`; last-owner guard → 409) in `apps/api/src/routes/platform-members.ts`
- [ ] T038 [US4] `DELETE /platform/organizations/:slug/members/:gotrue_id` (last-owner guard → 409) in `apps/api/src/routes/platform-members.ts`
- [ ] T039 [P] [US4] `GET /platform/organizations/:slug/members/invitations` (pending list) in `apps/api/src/routes/platform-members.ts`
- [ ] T040 [US4] `POST /platform/organizations/:slug/members/invitations` (`emails[]` + `role_id`; insert rows + GoTrue mailer; `{succeeded,failed}`; 409 if SMTP unset) in `apps/api/src/routes/platform-members.ts`
- [ ] T041 [US4] `DELETE /platform/organizations/:slug/members/invitations/:id` (cancel) in `apps/api/src/routes/platform-members.ts`
- [ ] T042 [US4] `GET /platform/organizations/:slug/members/invitations/:token` (status object) in `apps/api/src/routes/platform-members.ts`
- [ ] T043 [US4] `POST /platform/organizations/:slug/members/invitations/:token` (accept: create GoTrue user if new + membership; mark consumed) in `apps/api/src/routes/platform-members.ts`
- [ ] T044 [P] [US4] Invite-token + last-owner-count helpers in `apps/api/src/services/org-membership.ts`
- [ ] T045 [US4] Contract test `apps/api/tests/unit/platform-members.test.ts` — happy (roles list; invite Developer → accept → role_ids:[3]; change to 4) + sad (last-owner 409, SMTP-unset 409, expired token 410, invalid role_id 400)
- [ ] T046 [US4] Live-VM E2E `tests/cli-e2e/members-invites.sh` — invite email → accept → role; change role → write 403 (SC-004, SC-005)

**Checkpoint**: full member/role/invitation lifecycle with Cloud-shaped responses.

---

## Phase 7: User Story 5 — Projects belong to an organization (Priority: P2)

**Goal**: org-scoped project ownership + paginated org-projects + org-scoped project authz.

**Independent test**: project in Org A + Org B; a Developer in A sees only A's project and is refused on B's.

- [ ] T047 [US5] Project create requires an org context + role ≥ developer; set `supabase_instances.organization_id` in `apps/api/src/routes/instances.ts`
- [ ] T048 [US5] Carry `organization_id` through the provision job in `apps/worker/src/jobs/provision.ts`
- [ ] T049 [P] [US5] `GET /platform/organizations/:slug/projects` (paginated `{pagination,projects[]}`; map instance → `{ref,name,status,inserted_at,region,cloud_provider,databases[]}`) in `apps/api/src/routes/platform-organizations.ts`
- [ ] T050 [US5] Org-scope the existing project read/action endpoints (resolve project → org → role) in `apps/api/src/routes/instances.ts` + `apps/api/src/plugins/rbac.ts`
- [ ] T051 [P] [US5] Contract test `apps/api/tests/unit/org-projects.test.ts` — happy (pagination count/limit/offset; search) + sad (non-member 403, offset past end → empty list correct count)
- [ ] T052 [US5] Live-VM E2E `tests/cli-e2e/org-scoped-projects.sh` — project in A + B; Developer in A refused on B (SC-003)

**Checkpoint**: every project belongs to one org; org role governs project access.

---

## Phase 8: User Story 6 — Email-driven flows (Priority: P3)

**Goal**: SMTP-backed invitations, password reset, and email confirmation.

**Independent test**: configure SMTP, trigger an invite + a reset, confirm both emails arrive and their links complete.

- [ ] T053 [US6] SMTP config section in `/setup` (store `installation.smtp_config_encrypted`, envelope-encrypted) in `apps/api/src/routes/setup.ts` + the `apps/web` setup wizard
- [ ] T054 [US6] Inject SMTP into GoTrue (`GOTRUE_SMTP_*`) + flip `GOTRUE_MAILER_AUTOCONFIRM` off once configured, via the compose-up path in `apps/api/src/services/` + `infra/docker-compose.yml`
- [ ] T055 [US6] "email unavailable" 409 guard when SMTP is unset (invitations + reset) in `apps/api/src/routes/platform-members.ts`
- [ ] T056 [US6] Live-VM E2E `tests/cli-e2e/email-flows.sh` — invite email round-trip + password-reset round-trip (SC-004, SC-007)

**Checkpoint**: transactional email works; invites are usable by real teammates.

---

## Phase 9: Polish & Cross-Cutting Concerns

- [ ] T057 [P] Update the API definitions/Scalar reference for every new `/platform/*` endpoint in `packages/shared/src/mgmt-api/` (and the snapshot under `specs/084-gotrue-control-plane-auth/contracts/`), per the repo convention "update all api to reflect in scalar"
- [ ] T058 Pin the upstream platform-API snapshot + add a contract test guarding the org/member/profile/roles shapes (Constitution IV) under `apps/api/tests/contract/`
- [ ] T059 [P] Remove cookie/session remnants + dead `apps/web` login; grep-assert no `sb_sid` / `users` table / `studio-gotrue` references remain (SC-006)
- [ ] T060 [P] Write the runbook `docs/changes/084-gotrue-control-plane-auth.md`
- [ ] T061 Run `quickstart.md` validation on the VM (all happy + sad paths)
- [ ] T062 [P] Re-run the RBAC matrix + all contract/unit suites; confirm green and update the `CLAUDE.md` "What's shipped" table

---

## Dependencies & Execution Order

- **Setup (P1)** → **Foundational (P2)** → everything else. Foundational is a hard gate.
- **US1 (P3)** is the MVP and unblocks nothing else structurally, but **US3/US4/US5 depend on the
  org schema + RBAC from Foundational**, and **US4/US5 read orgs created via US3** (or `/setup`).
- **US2 (P4)** depends only on Foundational T013 (auth preHandler) — can run alongside US1.
- **US6 (P8)** depends on US4's invitation endpoints (email is the delivery for invites) + `/setup`.
- **Polish (P9)** last.

Story order: US1 ≈ US2 (P1) → US3 → US4 → US5 (P2) → US6 (P3).

## Parallel Execution Examples

- **Foundational**: T009, T010, T011, T012, T016 are `[P]` (distinct files) once T006–T008 land.
- **US1**: T018, T019, T020 are `[P]` (same new file `platform-profile.ts` — serialize if one file, else split per handler), T022, T024 parallel with the route work.
- **US4**: T035, T036, T039 (`[P]` reads) before the mutations T037/T038/T040–T043 (shared file → serialize).
- **Across stories**: once Foundational is done, US2's T026/T027 can proceed in parallel with US1.

## Implementation Strategy

- **MVP = Phase 1 + Phase 2 + Phase 3 (US1)**: real GoTrue sign-in + dashboard bootstrap, shim/session/`users` retired. Demoable on its own.
- Then **US2** (guard CLI/MCP), then **US3 → US4 → US5** (the multi-org/RBAC/member surface), then **US6** (email).
- Each story phase ends at a checkpoint that is independently testable (happy + sad) per its E2E task.
