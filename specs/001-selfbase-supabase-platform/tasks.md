---
description: "Task list for Selfbase v1"
---

# Tasks: Selfbase — Self-Hosted Supabase Platform

**Input**: Design documents under `specs/001-selfbase-supabase-platform/`

**Prerequisites**: `plan.md`, `spec.md` (read), `research.md`, `data-model.md`, `contracts/*`, `quickstart.md` (all present).

**Tests**: Included — `plan.md` and `research.md` §19 specify Vitest unit, Vitest contract, Docker-based integration, and Playwright E2E suites as part of v1.

**Organization**: Tasks grouped by user story (US1=P1, US2=P2 lifecycle, US3=P2 backups, US4=P3 multi-user). Each story is independently testable.

## Format: `[ID] [P?] [Story?] Description`

- **[P]**: parallelizable (different files, no dependency on incomplete tasks).
- **[Story]**: which user story the task serves (US1–US4); omitted in setup/foundational/polish phases.
- File paths are exact, relative to the repo root.

## Path Conventions

Monorepo (extended web app layout from `plan.md`):
- Backend API: `apps/api/`
- Worker: `apps/worker/`
- Frontend: `apps/web/`
- Caddy config: `apps/caddy/`
- Shared packages: `packages/{db,shared,crypto,docker-control,backup-store}/`
- Infra + vendored Supabase template: `infra/supabase-template/`, `infra/studio/`, `infra/docker-compose.yml`
- Installer: `install.sh` at repo root

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Repo scaffolding, vendored dependencies, control-plane Docker stack skeleton. Everything that has to exist before any feature code is meaningful.

- [x] T001 Initialize pnpm monorepo at repo root with `package.json`, `pnpm-workspace.yaml` (workspaces: `apps/*`, `packages/*`), root `tsconfig.base.json` (strict), `.editorconfig`, `.gitignore` (node_modules, dist, .env, .venv — NOT `lib/`)
- [x] T002 [P] Add root ESLint + Prettier config (`.eslintrc.cjs`, `.prettierrc`) sharable across packages
- [x] T003 [P] Add Vitest workspace config (`vitest.workspace.ts`) and a root `pnpm test` script that runs all package suites
- [x] T004 [P] Add a `git check-ignore -v src/lib/api.ts` smoke assertion to CI to prevent the Multibase `lib/`-gitignored failure (`.github/workflows/ci.yml` or equivalent)
- [x] T005 [P] Vendor upstream `supabase/supabase` `docker/*` at a pinned commit into `infra/supabase-template/` (Compose, `.env.example`, `kong.yml`, `vector.yml`, `volumes/db/*.sql`). Record the pinned commit in `infra/supabase-template/COMMIT`.
- [x] T006 [P] Vendor theme assets (Tailwind config, design tokens, base components) from `supabase/supabase` `apps/studio/` at the same pinned commit into `apps/web/src/theme/`. Document the lift list in `apps/web/src/theme/README.md`.
- [x] T007 Write `infra/studio/Dockerfile` that builds Studio from the vendored source with `NEXT_PUBLIC_BASE_PATH=/studio` baked in. Image tag: `selfbase/studio:<pinned-commit>`.
- [x] T008 Write `apps/caddy/Caddyfile` containing only the admin `:2019` block + `on_demand_tls { ask http://api:3001/internal/tls/ask }` skeleton; instance routes are added at runtime via admin API.
- [x] T009 Write `infra/docker-compose.yml` for the control plane: postgres:16, redis:7-alpine, caddy:2 (mounts `apps/caddy/Caddyfile` and `/var/selfbase/caddy-data`), api, worker, web. Bind ports 80 + 443 (Caddy) and admin 2019 only inside the network.
- [x] T010 Write `install.sh` at repo root: detects/installs Docker, clones repo to `/opt/selfbase`, `openssl rand`-generates `MASTER_KEY` + `SESSION_SECRET` + control-DB password, writes `.env`, builds `selfbase/studio:<commit>` (one-time), runs `docker compose up -d`, waits for health, prints setup URL. Pattern off `/Users/lord/Code/superbase/install.sh`.
- [x] T011 [P] Add shared pino logger config (`packages/shared/src/logger.ts`) with level from `LOG_LEVEL` env; JSON output in production, pretty in dev.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: Schema, crypto, Docker integration, API/worker scaffolds, Caddy reload, TLS-ask. **No user-story work can begin until this phase is complete.**

- [x] T012 [P] Create `packages/shared/` with `package.json`, exports for: zod schemas (REST request/response shapes from `contracts/rest-api.md`), error codes, the RBAC action set (`'instance.create'`, `'instance.delete'`, …), state-machine allowed-transitions table for `supabase_instances`
- [x] T013 [P] Create `packages/db/` with `package.json`, `drizzle.config.ts`, scripts (`db:generate`, `db:migrate`)
- [x] T014 [P] Implement `packages/crypto/src/aes-gcm.ts` (AES-256-GCM encrypt/decrypt against KEK from env, returns/accepts `iv || ct || tag` bytea)
- [x] T015 [P] Implement `packages/crypto/src/argon2.ts` (Argon2id with OWASP-recommended params: memoryCost=19456, timeCost=2, parallelism=1, hashLength=32, saltLength=16)
- [x] T016 [P] Implement `packages/crypto/src/jwt.ts` (HS256 signing with `jsonwebtoken`; helpers `signAnonKey(jwtSecret, expSec)` and `signServiceRoleKey(jwtSecret, expSec)`)
- [x] T017 [P] Implement `packages/crypto/src/passwords.ts` (`generatePassword(length)` from charset `[A-Za-z0-9]`; assertion helper `assertSafeForEnv(value)` rejecting `$`, `\``, `\\`, whitespace, quote)
- [x] T018 [P] Implement `packages/crypto/src/ref.ts` (`generateRef()` → 20 lowercase alphanumerics from CSPRNG)
- [x] T019 Vitest unit suite `packages/crypto/tests/*.test.ts` covering: AES round-trip with various plaintext sizes; Argon2 verify; JWT verify-against-secret (anti-SupaConsole regression); 1000 generated passwords contain no `$`; 1000 generated refs match `^[a-z0-9]{20}$`
- [x] T020 Write `packages/db/src/schema/identity.ts` (`org`, `users`, `org_members`, `invites`, `api_tokens`, `setup_state`) per `data-model.md`
- [x] T021 [P] Write `packages/db/src/schema/instances.ts` (`supabase_instances`, `port_allocations`) per `data-model.md`
- [x] T022 [P] Write `packages/db/src/schema/backups.ts` (`backups`) per `data-model.md`
- [x] T023 [P] Write `packages/db/src/schema/audit.ts` (`audit_log`) per `data-model.md`
- [x] T024 Generate Drizzle migrations 0000–0003 in `packages/db/migrations/`, each idempotent (`CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`)
- [x] T025 Implement `packages/db/src/migrate.ts` that calls Drizzle `migrate()` on API boot; idempotent
- [x] T026 Implement `packages/db/src/port-allocator.ts` exporting `allocatePorts(client, ref, ranges)` — transactional insert of 5 `port_allocations` rows with conflict retry up to N times
- [x] T027 [P] Vitest unit `packages/db/tests/port-allocator.test.ts` exercising concurrent allocation (no collisions) and exhaustion (error)
- [x] T028 Implement `packages/docker-control/src/compose-template.ts` — consumes `infra/supabase-template/` + typed input struct, parses `${VAR}` from compose/kong/vector/SQL, asserts completeness, emits `.env`, then shells out to `docker compose --env-file <env> config -q` for round-trip validation. Refuses on missing var, `$` in any value, or non-zero `compose config` exit.
- [x] T029 [P] Vitest unit `packages/docker-control/tests/compose-template.test.ts` covering: happy path; missing variable (e.g., simulate dropping `DOCKER_SOCKET_LOCATION` → reject); `$` in password (Multibase huntvox regression); empty-string opt-out for unused vars
- [x] T030 [P] Implement `packages/docker-control/src/dockerode.ts` (typed wrappers: `composeUp(projectName, dir)`, `composeDown(projectName, removeVolumes)`, `composePs(projectName)`, `composeExec(projectName, service, cmd)`, `containerHealth(name)`)
- [x] T031 Implement `packages/backup-store/src/index.ts` exporting `BackupStore` interface (put/get/list/delete) per `contracts/compose-env.md` shape (actually defined in `research.md` §7)
- [x] T032 [P] Implement `packages/backup-store/src/local-disk.ts` (`LocalDiskStore({ root })`) — writes/reads `<root>/<ref>/<timestamp>.dump`, supports streaming put/get
- [x] T033 [P] Implement `packages/backup-store/src/s3.ts` (`S3Store({ endpoint?, bucket, region, accessKeyId, secretAccessKey })`) using `@aws-sdk/client-s3` multipart upload + `getSignedUrl`
- [x] T034 [P] Vitest unit `packages/backup-store/tests/*.test.ts` covering both impls against a real local-disk dir and a `@aws-sdk/client-s3-mock` fake S3
- [x] T035 Scaffold `apps/api/src/server.ts` (Fastify 4, helmet, cors, pino, error-formatter); register `/api/v1` route prefix
- [x] T036 Implement `apps/api/src/plugins/auth.ts` — prehandler: bearer (SHA256 lookup in `api_tokens`, sets `req.user`) or session cookie (`@fastify/session` with Redis store); `requireAuth(req)` helper; 401 on miss
- [x] T037 Implement `apps/api/src/plugins/rbac.ts` — `app.authorize(req, action)` looks up `org_members.role` and checks against the shared RBAC action set; 403 on deny
- [x] T038 Implement `apps/api/src/services/caddy-config.ts` — builds the full Caddy JSON config from DB: apex server block + one server block per `supabase_instances` row in (`'running'`, `'paused'`)
- [x] T039 Implement `apps/api/src/services/caddy-reload.ts` — `POST http://caddy:2019/load` with the full config; surfaces non-2xx as a thrown error with status + body
- [x] T040 Implement `apps/api/src/routes/tls-ask.ts` — `GET /internal/tls/ask?domain=...` per `contracts/internal.md`; 200 for apex or admissible `<ref>.<apex>`, 404 otherwise; logs every deny at INFO; per-process LRU cache (60s TTL)
- [x] T041 [P] Contract test `apps/api/tests/contract/tls-ask.test.ts` (admissible / inadmissible / deleted-instance / non-matching apex)
- [x] T042 Scaffold `apps/worker/src/main.ts` (BullMQ Redis connection, queue registrations: `provision`, `lifecycle`, `backup`, `caddy-reload`, repeatable `backup-scheduler`)
- [x] T043 Implement `apps/worker/src/jobs/caddy-reload.ts` — debounced (200 ms) job: reads DB and triggers `caddy-reload.ts` service; coalesces churn
- [x] T044 Scaffold `apps/web/` (Vite 5, React 18, React Router 6, @tanstack/react-query 5, Tailwind with vendored theme tokens). `vite.config.ts` with `allowedHosts: true`, `host: '0.0.0.0'`, proxy `/api` + `/socket.io` to API in dev, **default `VITE_API_URL=''`** (relative paths in client bundle)
- [x] T045 Implement `apps/web/src/lib/api.ts` — axios client; `baseURL = (import.meta.env.VITE_API_URL || '') + '/api/v1'`; expose grouped APIs (`instancesApi`, `authApi`, `backupsApi`, `membersApi`, `orgApi`, `auditApi`)
- [x] T046 Pre-startup guard in `apps/api/src/server.ts`: if `MASTER_KEY` missing/invalid OR if encrypted_secrets round-trip against any existing instance fails → log clear named error and exit non-zero (SC-011)
- [x] T047 Contract test matrix `apps/api/tests/contract/rbac.test.ts` exercising every `(role × action)` cell from `packages/shared` against fixture rows

**Checkpoint**: Foundation ready — Phase 3 (US1) and Phase 4–6 can proceed in parallel by different developers.

---

## Phase 3: User Story 1 — Provision and reach a working Supabase instance (Priority: P1) 🎯 MVP

**Goal**: Operator runs the installer, completes setup, creates an instance via dashboard, reaches a working REST API at `https://<ref>.<apex>` with the generated `anon_key` on first try. This is the entire reason the product exists; everything else is value-add.

**Independent Test**: From a fresh VM, run `install.sh`, open `/setup`, submit credentials + apex, create instance "test", wait ≤ 90 s for status=`running`, then `curl -H "apikey: <anon_key>" https://<ref>.<apex>/rest/v1/` → 200 with the Swagger description. HTTPS cert is auto-issued within 60 s of first request.

### Tests for User Story 1

- [x] T048 [P] [US1] Contract test `apps/api/tests/contract/setup.test.ts` — `GET /setup/status` open vs gone; `POST /setup` happy path; `POST /setup` after first run → 410
- [x] T049 [P] [US1] Contract test `apps/api/tests/contract/auth.test.ts` — login, logout, me, token create/list/delete
- [x] T050 [P] [US1] Contract test `apps/api/tests/contract/instances-create.test.ts` — admin can create; member gets 403; input validation (long names, bad SMTP); 202 + ref returned
- [x] T051 [P] [US1] Contract test `apps/api/tests/contract/instances-list-get.test.ts` — member sees fewer fields than admin (port_postgres etc. hidden)
- [x] T052 [P] [US1] Contract test `apps/api/tests/contract/credentials-reveal.test.ts` — requires re-auth; member can reveal own org's; audit entry written
- [x] T053 [US1] Integration test `tests/integration/provision-instance.test.ts` — boots selfbase + control-plane Postgres + Caddy via Docker Compose, calls `/setup`, calls `/instances`, polls for status=`running` (≤ 90 s), then calls instance REST with `anon_key` → expect 200 (the SupaConsole regression check)

### Implementation for User Story 1

- [x] T054 [US1] Implement `apps/api/src/routes/setup.ts` — `GET /api/v1/setup/status`, `POST /api/v1/setup`: Argon2 hash, transactional insert (user + org + org_members + setup_state); optional apex registration triggers Caddy reload; returns one-shot master API token
- [x] T055 [US1] Implement `apps/api/src/routes/auth.ts` — `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`, `POST /auth/tokens`, `GET /auth/tokens`, `DELETE /auth/tokens/:id`
- [x] T056 [US1] Implement `apps/api/src/routes/instances-create.ts` — `POST /api/v1/instances`: zod-validate input → generate `ref` → allocate ports → generate secrets (jwt_secret, anon, service-role, postgres, dashboard, MinIO, vault, logflare, pg-meta crypto keys) → AES-GCM-encrypt blob → insert row (status=`provisioning`) → enqueue `provision` job → return 202
- [x] T057 [P] [US1] Implement `apps/api/src/routes/instances-list.ts` — `GET /api/v1/instances` and `GET /api/v1/instances/:ref`; field-filter based on role
- [x] T058 [P] [US1] Implement `apps/api/src/routes/credentials-reveal.ts` — `POST /api/v1/instances/:ref/credentials/reveal`: re-auth check (password match) → decrypt blob → write audit entry → return cleartext
- [x] T059 [US1] Implement `apps/worker/src/jobs/provision.ts` — full pipeline: read row → decrypt secrets → mkdir `/var/selfbase/instances/<ref>/` → copy `infra/supabase-template/*` → `compose-template.ts` writes `.env` → `compose config -q` round-trip check → `compose up -d` → poll containers until healthy (3-min cap) → upsert Caddy route via `caddy-reload` → set status=`running`. On any error: set status=`failed`, store `provision_error`, leave dir for inspection.
- [x] T060 [US1] Wire `provision` job completion to enqueue `caddy-reload` (debounced) — `apps/worker/src/jobs/provision.ts`
- [x] T061 [US1] Implement `apps/web/src/pages/Setup.tsx` — calls `/setup/status` on mount; renders form (email, password, orgName, apexDomain); displays one-shot master token after success
- [x] T062 [US1] Implement `apps/web/src/pages/Login.tsx` — email + password; on success route to `/`
- [x] T063 [US1] Implement `apps/web/src/pages/Instances.tsx` — list with status pills (provisioning, running, paused, failed) + "New Instance" CTA + polling via React Query (refetch every 5 s while any row is in provisioning/deleting)
- [x] T064 [US1] Implement `apps/web/src/pages/InstancesNew.tsx` — form per `contracts/rest-api.md` `POST /instances` shape (name, optional SMTP, signup toggle, JWT expiry, backup-auto, retention)
- [x] T065 [US1] Implement `apps/web/src/pages/InstanceDetail.tsx` — ref, name, status, URLs, "Open Studio" external link to `https://<ref>.<apex>/studio/project/default`, "Reveal Credentials" button → password prompt → display cleartext with copy-to-clipboard
- [x] T066 [US1] Implement React Router setup (`apps/web/src/App.tsx`) with route guards: `/setup` open only when status=open; everything else requires auth; `/setup`-incomplete users always redirected to `/setup`

**Checkpoint**: US1 fully functional and independently testable. End-to-end demo: fresh VM → install → setup → create instance → REST call returns 200 with anon_key.

---

## Phase 4: User Story 2 — Lifecycle management (Priority: P2)

**Goal**: Pause, resume, restart, upgrade, delete instances from the dashboard. Pause preserves data; resume returns to working state.

**Independent Test**: With one running instance from US1, click Pause → containers stop within 30 s, volumes intact. Click Resume → status=`running` within 60 s, same anon_key works. Click Restart → restarts cleanly. Upgrade to a different pinned version (with optional pre-upgrade backup) → instance runs on new version. Delete → resources released, subdomain stops responding.

### Tests for User Story 2

- [ ] T067 [P] [US2] Contract test `apps/api/tests/contract/instances-lifecycle.test.ts` — pause/resume/restart/upgrade/delete admin-only; correct status transitions; invalid transitions rejected (e.g., pause a `provisioning` instance)
- [ ] T068 [P] [US2] Integration test `tests/integration/lifecycle.test.ts` — provision instance → pause (verify `docker compose ps` shows exited) → resume (verify REST works) → delete (verify ports freed, volume removed)

### Implementation for User Story 2

- [ ] T069 [P] [US2] Implement `apps/api/src/routes/instances-lifecycle.ts` — `POST /instances/:ref/pause`, `/resume`, `/restart`, `/upgrade`, `DELETE /instances/:ref`. All return 202 + enqueue corresponding job; validate transition against `packages/shared` allowed-transitions table; admin only.
- [ ] T070 [P] [US2] Implement `apps/api/src/routes/instances-patch.ts` — `PATCH /instances/:ref` for editable fields (`name`, `backupAutoEnabled`, `backupRetain`)
- [ ] T071 [US2] Implement `apps/worker/src/jobs/lifecycle.ts` — handlers for: `pause` (`compose stop`, status=`paused`), `resume` (`compose start`, wait healthy, status=`running`), `restart` (`compose restart`, wait healthy), `upgrade` (optional pre-backup → `compose pull` → `compose up -d --force-recreate` → wait healthy → update `supabase_version`), `delete` (status=`deleting` → `compose down -v` → `rm -rf /var/selfbase/instances/<ref>` → delete `port_allocations` rows → delete `supabase_instances` row → enqueue Caddy reload)
- [ ] T072 [US2] Implement `apps/web/src/components/InstanceActions.tsx` — Pause / Resume / Restart / Upgrade / Delete buttons with confirmation dialogs; surfaces ineligible actions based on current status
- [ ] T073 [US2] Implement `apps/web/src/pages/InstanceUpgrade.tsx` (or modal) — version picker (lists pinned versions known to selfbase) + "Backup first" checkbox
- [ ] T074 [US2] Wire delete cleanup to also write an `audit_log` entry attributed to the actor

**Checkpoint**: US2 functional alongside US1.

---

## Phase 5: User Story 3 — Backups (Priority: P2)

**Goal**: On-demand and daily automatic backups per instance with configurable retention. Local-disk and S3 backup stores. No in-dashboard restore — `.dump` files are downloadable and restored manually.

**Independent Test**: On a running instance, trigger on-demand backup → file appears, downloadable. Validate offline with `pg_restore --list`. Enable daily auto with retention=3, run 4 backups → only 3 remain. Configure S3 store at org level → next backup lands in S3.

### Tests for User Story 3

- [ ] T075 [P] [US3] Contract test `apps/api/tests/contract/backups.test.ts` — create + list + download endpoints; admin-only create; member can list + download
- [ ] T076 [P] [US3] Contract test `apps/api/tests/contract/org-backup-store.test.ts` — `PUT /org/backup-store` admin-only; secrets stored encrypted (verify by re-reading raw row)
- [ ] T077 [P] [US3] Integration test `tests/integration/backup.test.ts` — provision instance → seed ~100 MB of data via the instance's REST/SQL → trigger backup while measuring elapsed wall-clock time → assert (a) file appears, (b) elapsed time < 60 s (SC-006), (c) `pg_restore --list <file>` lists `public` schema
- [ ] T078 [P] [US3] Integration test `tests/integration/backup-retention.test.ts` — enable auto with retention=3 → run 4 manual backups → assert only 3 remain in BackupStore and `backups` table

### Implementation for User Story 3

- [ ] T079 [P] [US3] Implement `apps/api/src/routes/backups.ts` — `POST /instances/:ref/backups` (admin, enqueue), `GET /instances/:ref/backups` (any), `GET /instances/:ref/backups/:id/download` (any; local → stream with `Content-Disposition`, s3 → 307 to signed URL)
- [ ] T080 [P] [US3] Implement `apps/api/src/routes/org-backup-store.ts` — `PUT /api/v1/org/backup-store`: validate config, encrypt secrets (S3 credentials), update `org.backup_store_kind` + `org.backup_store_config_encrypted`; admin-only
- [ ] T081 [US3] Implement `apps/worker/src/jobs/backup.ts` — insert `backups` row (status=`running`) → resolve BackupStore from `org.backup_store_kind` + decrypted config → `docker exec selfbase-<ref>-db pg_dump -U postgres -Fc postgres` streamed into `BackupStore.put()` → update row to `completed` with `size_bytes` and `store_key` → on failure, status=`failed` with `error`. Updates `supabase_instances.last_backup_at` on success.
- [ ] T082 [US3] Implement retention sweep — after every successful backup, query `backups` rows for this `instance_ref` ordered by `started_at DESC`, delete all beyond `backup_retain` from both the BackupStore and the `backups` table (`apps/worker/src/jobs/backup.ts` or a helper)
- [ ] T083 [US3] Implement `apps/worker/src/jobs/backup-scheduler.ts` — BullMQ repeatable job, fires hourly: SELECT instances with `backup_auto_enabled = true` AND (`last_backup_at IS NULL` OR `last_backup_at < now() - interval '24 hours'`); enqueue a `backup` job for each
- [ ] T084 [US3] Sign short-lived download URLs for local-store backups — `apps/api/src/services/download-tokens.ts`: HMAC-sign `{ backupId, exp }` with `SESSION_SECRET`, validate in the download handler
- [ ] T085 [US3] Implement `apps/web/src/pages/InstanceBackups.tsx` — list (with status, size, time), "Create Backup" button, "Download" links, retention input (auto-saves), auto toggle
- [ ] T086 [US3] Implement `apps/web/src/pages/SettingsOrg.tsx` (extending settings page from US4 if it lands first) — backup-store config form: kind picker → `local` (no fields) or `s3` (endpoint, bucket, region, accessKeyId, secretAccessKey). Submit calls `PUT /api/v1/org/backup-store`.

**Checkpoint**: US3 functional alongside US1 + US2.

---

## Phase 6: User Story 4 — Multi-user collaboration (Priority: P3)

**Goal**: Admin can invite teammates as Members via one-time link (24 h validity). Members can view and use instances but cannot delete/upgrade/invite/configure.

**Independent Test**: Admin invites teammate → link generated → teammate accepts in incognito with new password → teammate sees instance list, cannot click destructive buttons; direct API call as member to a destructive endpoint → 403. Remove member → their tokens + sessions invalidated.

### Tests for User Story 4

- [ ] T087 [P] [US4] Contract test `apps/api/tests/contract/invites.test.ts` — create/list/revoke admin-only; accept open (validates token, single-use, expiry); 410 on consumed or expired token
- [ ] T088 [P] [US4] Contract test `apps/api/tests/contract/members.test.ts` — list any; delete admin-only; member self-delete forbidden in v1
- [ ] T089 [P] [US4] Contract test `apps/api/tests/contract/member-removal-cascade.test.ts` — deleting a member with active tokens + sessions invalidates both atomically
- [ ] T090 [P] [US4] E2E Playwright `apps/web/tests/e2e/invite-flow.spec.ts` — admin invites → record `t0 = Date.now()` at the moment the invitee clicks the link in a second browser context → on dashboard render, assert `Date.now() - t0 < 60_000` (SC-012) → member sees list but Delete button hidden; API call as member to DELETE → 403

### Implementation for User Story 4

- [ ] T091 [P] [US4] Implement `apps/api/src/routes/members.ts` — `GET /members`, `POST /members/invites`, `GET /members/invites`, `DELETE /members/invites/:id`, `POST /members/invites/accept`, `DELETE /members/:userId`
- [ ] T092 [US4] Implement invite token mechanics — generate raw token (32 bytes hex), store SHA-256 in `invites.token_sha256`, return raw once in API response (`link` field); accept handler reverses the hash lookup
- [ ] T093 [US4] Implement member-removal cascade in `apps/api/src/routes/members.ts` DELETE handler — delete `api_tokens` rows for user, destroy sessions in Redis store, delete `org_members` row (CASCADE removes the user row), write `audit_log` entry
- [ ] T094 [US4] Implement invite email delivery — `apps/api/src/services/invite-mail.ts`: if `org.smtp_*` configured (future field, optional in v1) send via nodemailer; otherwise log link to pino at INFO and surface in API response (acceptable in v1 per Assumptions)
- [ ] T095 [US4] Implement `apps/web/src/pages/SettingsMembers.tsx` — list members + roles + remove buttons (admin only); "Invite Member" modal with email + role picker; lists open invites with revoke button; copy-link for non-SMTP setups
- [ ] T096 [US4] Implement `apps/web/src/pages/AcceptInvite.tsx` — route `/accept-invite?token=...`; renders password form; on submit calls `POST /members/invites/accept`; success → log in + redirect to `/`
- [ ] T097 [US4] Hide admin-only buttons in `apps/web` for member role — `useAuth()` exposes role; reuse in `InstanceActions`, `Instances` page (no New Instance), `InstanceDetail` (no Pause/Delete/etc.)

**Checkpoint**: All four user stories functional.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T098 [P] Implement `apps/api/src/routes/audit.ts` — `GET /api/v1/audit` (admin) with `action`, `actor`, `since`, `until`, `limit`, `cursor` filters; returns paginated entries with actor email joined
- [ ] T099 [P] Implement `apps/web/src/pages/SettingsAudit.tsx` — paginated audit log table; copy-to-clipboard for payload
- [ ] T100 [P] Implement `apps/web/src/pages/SettingsTokens.tsx` — list/create/revoke personal API tokens; new-token modal shows raw value once with copy
- [ ] T101 [P] Implement `apps/api/src/routes/health.ts` — `GET /api/v1/health`: probes DB (`SELECT 1`), Redis (`PING`), Caddy admin (`GET /config/`); 200 if all OK else 503
- [ ] T102 [P] Write `UPGRADING.md` at repo root — documents how to bump `infra/supabase-template/COMMIT` and what to validate
- [ ] T103 [P] Write top-of-file contract comments in `install.sh` — what it does, what env vars it accepts (`INSTALL_DIR`, `STUDIO_PORT`, `PUBLIC_URL`), what it produces
- [ ] T104 [P] E2E Playwright golden path `apps/web/tests/e2e/golden-path.spec.ts` — setup → create instance → poll for running → open studio → reveal credentials → create backup → pause → resume → delete (SC-005, SC-006, SC-009 coverage)
- [ ] T105 [P] Add JSDoc/README to each `packages/*/README.md` describing the package's surface and how it's tested
- [ ] T106 Write project root `README.md` — what selfbase is, quickstart link, capability list, license (MIT or whichever the operator picks)
- [ ] T107 Verify `specs/001-selfbase-supabase-platform/quickstart.md` end-to-end on the existing VM `148.113.1.164` after Multibase wipe (SC-001 demonstration); update quickstart if any step diverges from reality
- [ ] T108 [P] Tighten Caddy reload — debounce window already 200 ms; add a metric counter for reload-rate to surface churn (`apps/worker/src/jobs/caddy-reload.ts`)
- [ ] T109 [P] Confirm SC-010 — load 15 dummy instance rows (status=`paused`, no containers) and verify dashboard navigation < 1 s perceived
- [ ] T110 Implement instance health reconciler in `apps/worker/src/jobs/health-reconciler.ts` — BullMQ repeatable job (30 s tick) that calls `composePs(selfbase-<ref>)` for every non-deleted instance and updates `supabase_instances.status` if the observed container set diverges (e.g., running → stopped on OOM-kill). Honors FR-033 ("based on the actual state of its underlying processes, not just on the last requested action"). RECOMMENDED to land in Phase 2 before US1 ships, even though listed in Polish for diff hygiene.

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: T001 (monorepo init) blocks all others. T002–T004 [P] after T001. T005–T007 [P]. T008–T011 [P] after T005/T006 land. ~1–2 days.
- **Foundational (Phase 2)**: blocked by Phase 1 complete. T012–T019 [P] (independent packages). T020–T027 (db) then T028–T030 (docker-control) then T031–T034 (backup-store). T035–T047 sequentially mostly; T041, T047 are contract tests in parallel. ~4–6 days.
- **User Story phases (3–6)**: blocked by Phase 2 complete. Can proceed in parallel by different developers.
- **Polish (Phase 7)**: after at least US1 complete; some items (T106, T107) want all four stories done.

### User Story Dependencies

- **US1 (P1)**: depends only on Phase 2.
- **US2 (P2)**: depends on Phase 2; reuses US1's `provision` to have something to lifecycle, but contract tests can mock provision. Strictly: T067–T068 want US1's provision to exist for integration; T069–T072 are independent of US1 code.
- **US3 (P2)**: depends on Phase 2; integration test (T077) needs US1's provision to exist.
- **US4 (P3)**: depends on Phase 2 only. No US1/2/3 dependency.

### Parallel Opportunities

- Phase 1: T002, T003, T004, T005, T006 (T011 too) run in parallel after T001.
- Phase 2: T012–T018 run in parallel (different packages). T020–T023 ([P]). T029, T032, T033, T034 ([P]). T041, T047 ([P]).
- Phase 3 (US1): T048–T052 contract tests in parallel. T057, T058 implementations in parallel after route file structure exists.
- Phase 4 (US2): T067, T068 in parallel. T069, T070 in parallel.
- Phase 5 (US3): T075, T076, T077, T078 in parallel. T079, T080 in parallel.
- Phase 6 (US4): T087, T088, T089, T090 in parallel. T091 single file but covers many routes.
- Phase 7: T098, T099, T100, T101, T102, T103, T104, T105, T108, T109 all parallel.

---

## Parallel Example: User Story 1

```bash
# Contract tests first (write together, watch them fail)
Task: "Setup endpoint contract test apps/api/tests/contract/setup.test.ts"
Task: "Auth endpoints contract test apps/api/tests/contract/auth.test.ts"
Task: "Instances create contract test apps/api/tests/contract/instances-create.test.ts"
Task: "Instances list contract test apps/api/tests/contract/instances-list-get.test.ts"
Task: "Credentials reveal contract test apps/api/tests/contract/credentials-reveal.test.ts"

# Then implementation in parallel where files differ
Task: "Implement instances list/get routes apps/api/src/routes/instances-list.ts"
Task: "Implement credentials reveal route apps/api/src/routes/credentials-reveal.ts"
```

---

## Implementation Strategy

### MVP First (User Story 1 only)

1. Complete Phase 1: Setup (~1–2 days).
2. Complete Phase 2: Foundational (~4–6 days).
3. Complete Phase 3: US1 (~3–5 days).
4. **STOP and VALIDATE**: run `tests/integration/provision-instance.test.ts` on the VM. Confirm SC-001, SC-002, SC-003, SC-004.
5. Demo: invite a stakeholder, create + reach an instance live.

This MVP is shippable: a single-operator self-hosted Supabase Cloud that lets you spin up working projects. Everything beyond is operational polish.

### Incremental Delivery

1. Phase 1 + 2 → foundation ready.
2. Add US1 → MVP demo (~Week 2).
3. Add US3 (backups) **before** US2 (lifecycle) if your priority is data safety — they're both P2 and US3 lifts the worst-case risk of US1.
4. Add US2 → lifecycle parity with Cloud.
5. Add US4 → multi-user.
6. Polish.

### Parallel Team Strategy

After Phase 2 lands, three developers can split:

- Developer A: US1 (must finish first, others depend on the provision pipeline existing for integration tests).
- Developer B: US2 lifecycle (against a mocked provision until A lands).
- Developer C: US3 backups (against a mocked provision) + US4 (independent).

Polish (Phase 7) is whoever finishes their story first.

---

## Notes

- [P] = different files, no dependency on incomplete tasks.
- [Story] label maps a task to its user story for traceability.
- Contract tests in Phase 2/3/4/5/6 are written before implementation (TDD-style); they should fail at first.
- The integration tests (T053, T068, T077, T078) need real Docker — they run against a per-test Docker Compose stack.
- E2E tests (T090, T104) use Playwright against the running dashboard.
- After each task or logical group: commit. Each story phase finishes with a `Checkpoint` — a natural validate-and-demo gate.
- Avoid: same-file conflicts inside one [P] group, cross-story dependencies that break a story's independent testability.
- Anti-regression watchlist (from root `plan.md` "Bugs Explicitly Not To Repeat"):
  - JWT signatures: real HS256 only; assert in T019 + T044.
  - Port allocation: DB-tracked, never timestamp math; assert in T027.
  - `.env` completeness: every upstream var present; assert in T029.
  - Password charset: alphanumeric only; assert in T019.
  - `DOCKER_SOCKET_LOCATION`: always set; assert in T029.
  - Hardcoded dev-home paths: none anywhere; enforce in code review.
  - `lib/` in `.gitignore`: not allowed; assert in T004.
  - Vite `allowedHosts`: `true` or env-driven, never hardcoded hostnames; in T044.
  - `VITE_API_URL`: empty default in v1; in T044.
  - Two control planes: API is the single writer; never mutate from CLI/MCP later without going through `/api/v1/`.
