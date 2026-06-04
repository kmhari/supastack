# Implementation Plan: Platform Studio base=root API URL + legacy studio reduced to /setup

**Branch**: `086-platform-base-root-url` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/086-platform-base-root-url/spec.md`

## Summary

Five coupled changes — only US6 needs a DB migration (an idempotent, additive surrogate column):

1. **P1 (US1) — base=root cutover.** Point the platform studio's API base at the apex root so its calls resolve as `/platform/*` and `/v1/*` (no `/api/v1/v1/*` doubling). Concretely: add **one** server.ts mount (`platformMiscRoutes` at root), add a Caddy `/v1*` → `api:3001` rule in **two** places (`apps/caddy/Caddyfile` + the runtime `caddy-config.ts dashboardSubroutes`), flip `NEXT_PUBLIC_API_URL` to the apex root, rebuild the Studio image (NEXT_PUBLIC_* is build-baked), and drop the `/api/v1/v1/*` inject shim after the rebuild. Login is unaffected (separate `NEXT_PUBLIC_GOTRUE_URL`). **[planned — NOT yet implemented]**
2. **P2 (US2) — legacy SPA reduced to /setup.** Trim `apps/web` to the install wizard only: delete ~24 non-setup pages + 3 page dirs, trim `lib/api.ts`, delete page-bound unit tests, remove the feature-021 Playwright e2e harness + its page-coverage lint. **[implemented + committed]**
3. **P3 (US3) — setup reuses the platform org primitive.** Extract `createOrganizationWithOwner(tx, {userId, name})` into `services/org-store.ts`; call it from both `POST /platform/organizations` and `setup.ts`. First user via GoTrue. **[implemented + committed]**
4. **P4 (US5) — setup-completion gate.** Until first-time setup completes, the edge redirects every dashboard route (`/`, `/dashboard`, project URLs) to `/setup`; after, `/` serves the platform studio. Mechanism (research Option d): `caddy-config.ts` reads `setup_state.completed_at` and, when incomplete, emits a `static_response` 302→`/setup` as the catch-all (after `/setup*`, before the studio catch-all); `setup.ts` `reloadCaddy()` becomes **unconditional** so completion drops the gate; the boot `Caddyfile` defaults to the **gated** catch-all (it can't read the DB). Fail-safe: a DB-read error defaults to gated. **Zero Studio source changes; no per-request cost.**
5. **P5 (US6) — migrate the real backup engine.** Wire the stubbed `/platform/database/:ref/backups` (list) + `/restore-physical` to the existing engine (`initiateRestore` → `selfbase.restore` queue → `handleRestore` worker; status `running↔restoring`), and add `GET /platform/projects/:ref/status` (`running→ACTIVE_HEALTHY`, `restoring→RESTORING`). Emit the **vendored-Studio Cloud shape** (`backups[].id:number`, `project_id:number`, `isPhysicalBackup`, UPPERCASE `status`, `physicalBackupData` unix-seconds). Native backup id is a UUID but Studio types require a **number** → add an **idempotent migration** giving `backups` a `bigint` numeric surrogate, resolved back to uuid on restore. The `/v1` CLI backup contract stays uuid-based (Constitution IV).

`/api/v1` is **retained as the internal engine** (project-create/restart inject into `/api/v1/instances`; the backup/restore engine behind `/api/v1/instances/:ref/backups` is now **reused** by US6, not retired). This feature does not delete it.

## Technical Context

**Language/Version**: TypeScript (Node 20); React 18 (apps/web Vite SPA); Supabase Studio (Next.js — env-only, no source changes).

**Primary Dependencies**: Fastify (`apps/api`), Caddy custom build (`apps/caddy` edge), Vite/React (`apps/web`), Docker Compose (`infra/`). No new dependency.

**Storage**: Postgres (control plane). US1–US5 need no schema change; **US6 adds one idempotent + additive migration** — a numeric surrogate column on `backups` (Studio requires a numeric backup id; native is uuid). Otherwise reuses existing tables (`organizations`/`organization_members`/`installation`/`setup_state`/`api_tokens`/`backups`/`restore_jobs`/`supabase_instances`).

**Testing**: vitest (unit + contract + node-env integration), Playwright (apps/web e2e — being removed/rehomed), bash `tests/cli-e2e/*.sh` (live VM). New: unit test for `createOrganizationWithOwner`; updated `apps/web/tests/unit/api.test.ts`.

**Target Platform**: Single Linux VM (`ubuntu@148.113.1.164`, apex `supaviser.dev`); modern browsers.

**Project Type**: Web — multi-surface (Fastify API + Caddy edge + Vite SPA + Next.js Studio + Docker Compose).

**Performance Goals**: No perf target; the cutover *removes* one `app.inject` re-dispatch hop (the shim) per Management-compat call.

**Constraints**:
- **Constitution IV (hard)**: the `/v1/*` Management contract (paths, shapes, error envelope) MUST NOT change — we only add apex routing + a root mount of already-existing handlers. CLI/MCP regression coverage required.
- `/setup` MUST keep working over plain HTTP before DNS/TLS.
- The deploy is **atomic/coordinated**: Studio image rebuild + Caddy `/v1*` rule + `NEXT_PUBLIC_API_URL` flip must land together (a new-base Studio without the Caddy `/v1*` route would 404 its management calls).

**Scale/Scope**: 1 operator VM; ~158 `/platform/*` routes (one new root mount), ~49 `/api/v1` routes (retained), 1 SPA reduced to a single page, 1 Studio image rebuild.

## Constitution Check

*Gate evaluated against `.specify/memory/constitution.md` v1.0.0.*

| Principle | Status | Notes |
|---|---|---|
| I. Idempotent, additive schema | ✅ PASS | US1–US5: no schema change. **US6 adds one idempotent + additive migration** — a `bigint` numeric surrogate on `backups` via `ADD COLUMN IF NOT EXISTS` (identity sequence backfills existing rows); re-runnable. |
| II. Secrets encrypted, master key home | ✅ PASS | No new secret handling. Setup PAT mint unchanged; US6 reuses the existing store/encryption. |
| III. Authorize every privileged action | ✅ PASS | `POST /platform/organizations` keeps `requireAuth`. Setup stays the unauthenticated bootstrap gated by `setup_state`. **US6** backup routes gate on the existing `backup.list`/`backup.restore` RBAC actions; **US5's** gate is an unauthenticated edge redirect (no privileged action). |
| IV. Supabase compatibility pinned | ✅ PASS (with guard) | `/v1/*` handlers byte-identical — only newly *routed* at the apex + root-mounted (US1). **US6's `/platform/*` backup routes match the vendored Studio types (commit `8cd39680ef`); the `/v1` CLI backup contract stays uuid-based and untouched** — the numeric surrogate lives only at the `/platform` edge. Guarded by `/v1` contract tests + cli-e2e (US4). |
| V. Worker owns per-instance state | ✅ PASS | Project create flows `/platform/projects` → `/api/v1/instances` → worker. **US6 restore reuses the existing worker** (`initiateRestore` → `selfbase.restore` queue → `handleRestore`); restore stays a worker job, the api only enqueues. |
| VI. Spec-driven, evidence-based | ✅ PASS | speckit lifecycle; live-VM E2E + unit coverage planned (gate-config emission, backup surrogate mapping, status map). |
| Platform: installation vs tenant separation | ✅ PASS | Option A keeps the `installation` singleton write setup-specific; only the tenant org+membership is shared. |
| Platform: edge routing from DB, atomic | ✅ PASS | `/v1*` rule (US1) + the **US5 gate** both via `caddy-config.ts` reading DB state (`setup_state`) and reloading atomically; `reloadCaddy()` on setup-completion swaps the 302→/setup catch-all for the studio catch-all. |

**No violations → Complexity Tracking is empty.**

## Project Structure

### Documentation (this feature)

```
specs/086-platform-base-root-url/
├── spec.md
├── plan.md              # this file
├── research.md          # Phase 0 — consolidated findings (3 investigators)
├── data-model.md        # Phase 1 — entities / surfaces / file-set (no DB schema)
├── contracts/
│   ├── routing.md       # apex /v1* + root /platform mount; shim removal (US1)
│   ├── setup-org.md     # createOrganizationWithOwner shared primitive (US3)
│   ├── studio-build.md  # NEXT_PUBLIC_API_URL flip + rebuild procedure (US1)
│   ├── setup-gate.md    # US5 — DB-state-driven Caddy 302→/setup gate
│   └── backups.md       # US6 — Cloud-shaped list/restore/status + numeric surrogate
├── quickstart.md        # Phase 1 — verification (clean URLs, /setup, gate, backups, CLI, login)
└── checklists/requirements.md
```

### Source code (affected)

```
apps/api/src/
  server.ts                       # P1: register platformMiscRoutes at root; later remove /api/v1/v1 shim (323-335) + /api/v1 platform mounts (228-229) post-rebuild
  routes/setup.ts                 # P3 (done): org primitive. P4: make reloadCaddy() unconditional on completion (currently gated on apexDomain at setup.ts:111)
  routes/platform-misc.ts         # P3 (done): org primitive. P5: wire /platform/database/:ref/backups list (650-653) + /restore-physical (1946-1949) to the real engine; add GET /platform/projects/:ref/status (model on :ref detail 378-397)
  services/org-store.ts           # P3 NEW (done): createOrganizationWithOwner(tx,{userId,name})
  services/backups-mgmt-service.ts # P5: add listBackupsForPlatform (Studio Cloud shape) + numeric-seq↔uuid resolve; restore reuses initiateRestore + restoreQueue
  services/caddy-config.ts        # P1: /v1* rule. P4: read setup_state.completed_at → emit 302→/setup catch-all when incomplete (fail-safe gated on read error)

packages/db/migrations/00NN_backup_seq.sql  # P5 NEW: idempotent `ADD COLUMN IF NOT EXISTS` bigint identity surrogate on `backups` (numeric Studio id)

apps/caddy/Caddyfile              # P1: `/v1*` rule (:80+:443). P4: boot catch-all defaults to 302→/setup (gated — boot config can't read the DB; runtime /load swaps in studio post-setup)

infra/docker-compose.yml          # P1: NEXT_PUBLIC_API_URL → https://${SUPASTACK_APEX} (drop /api/v1)

apps/web/src/
  App.tsx                         # P2: trim to <Route path="/setup"> + catch-all → /setup
  pages/*.tsx                     # P2: delete all except Setup.tsx (+ dirs auth-providers/, auth-url-config/, auth-hooks/)
  components/*                    # P2: delete page-only shells (ProjectShell, SettingsLayout, Shell, …); keep CopyButton + 4 ui/ primitives
  lib/api.ts                      # P2: keep setupApi/apexApi/wildcardCertApi/orgApi.patch/authApi.me; delete the rest
  lib/{safe-next,health-poll,use-reveal-credentials}.ts  # P2: delete (setup doesn't import)

apps/web/tests/
  unit/api.test.ts                # P2: trim to setup-needed method assertions
  unit/{Instances,Login,MorePages,ProjectAuth*,ProjectSecrets,provider-registry,redirect-url-helpers}.test.* # P2: delete
  e2e/**                          # P2: remove (targets apps/web SPA, not Studio) OR rehome (follow-up)
apps/web/scripts/check-page-coverage.mjs + tests/e2e/expected-pages.ts  # P2: reset/remove (apps/web-page-driven)
.github/workflows/ci.yml          # P2: drop/adjust the e2e job that boots apps/web + runs Playwright
```

**Structure decision**: existing multi-surface web layout; no new packages/apps. US1–US3 done. US5 adds a gate branch in `caddy-config.ts` + a boot-Caddyfile default + an unconditional `reloadCaddy()`. US6 adds a backup adapter in `platform-misc.ts`/`backups-mgmt-service.ts`, a new `/platform/projects/:ref/status` route, and **one idempotent migration** (the numeric-surrogate column). No new dependency.

## Phase 0 — Research

See [research.md](./research.md). All unknowns resolved:
- **server.ts**: the only required mount is `platformMiscRoutes` at root; `/v1` scope + inline stubs already serve at root.
- **Caddy**: must add `/v1*` in BOTH `Caddyfile` and `caddy-config.ts dashboardSubroutes` (VM source of truth) — the easy-to-miss change; without it apex `/v1/*` falls through to studio.
- **Login**: safe — driven by `NEXT_PUBLIC_GOTRUE_URL` (already apex `/auth/v1`), independent of the base change.
- **SPA slim**: precise keep/delete inventory; Playwright e2e targets apps/web and must be removed/rehomed.
- **Setup org primitive**: Option A (extract `createOrganizationWithOwner`) — preserves setup atomicity + bootstrap; Option B (inject) rejected (breaks the transaction + pre-auth ordering).
- **US5 setup-gate**: Option (d) — DB-state-driven Caddy route. `caddy-config.ts` already reads `installation`; add a `setup_state.completed_at` read and emit a `static_response` 302→/setup catch-all when incomplete. No `forward_auth` precedent in the repo (and it adds per-request cost); the reconfigure-on-completion model matches the existing edge-state pattern, needs zero Studio changes, and fails safe (read error → gated; boot Caddyfile defaults gated). Only the studio catch-all is gated — `/setup*`, `/api/*`, `/v1*`, `/platform/*`, `/auth/v1/*`, `/.well-known/*`, per-instance `<ref>.<apex>` hosts stay reachable. `setup.ts` `reloadCaddy()` must become unconditional (today only fires when an apex was set).
- **US6 backups**: the engine fully exists — `initiateRestore` (sets `supabase_instances.status='restoring'` in-tx) → `selfbase.restore` queue → `handleRestore` worker (restores via `pg_restore`, sets status back to `running`). Adapter emits the **vendored-Studio shape** (verified against the pinned studio types: `backups[].id:number`, `project_id:number`, `isPhysicalBackup`, UPPERCASE `status`, `physicalBackupData` unix-seconds). **Confirmed risk**: Studio types require numeric `id`/`project_id` but native backup id is a UUID → add a numeric surrogate column (idempotent migration), emit it as `id`, resolve number→uuid on restore; `project_id` = deterministic int hash of ref (display-only). Status route: `running→ACTIVE_HEALTHY` else `status.toUpperCase()` (existing repo idiom). The `/v1` CLI backup contract (uuid) is untouched.

## Phase 1 — Design & Contracts

See [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md). No `/v1` external contract changes (Constitution IV preserved). US6's `/platform/*` backup routes are a new internal contract matched to the vendored Studio types; US5's gate is internal edge routing.

## Phase 2 — Task planning approach

`/speckit-tasks` will regenerate the breakdown. **US1–US3 are already implemented + committed** (their tasks stay marked done); the new work is US5 + US6 (+ re-running US4 to cover them):
- **US1 (P1) [done]**: server.ts root mount → Caddy `/v1*` (both files) → compose flip → Studio rebuild → shim removal → live verify (0 `/v1/v1`). (Deploy still pending.)
- **US2 (P2) [done]**: SPA reduced to /setup; e2e harness removed; build green.
- **US3 (P2) [done]**: `org-store.ts` + wire both callers; GoTrue-only user.
- **US5 (P2) [new]**: `caddy-config.ts` read `setup_state` → emit 302→/setup catch-all when incomplete (fail-safe) → boot `Caddyfile` gated default → `setup.ts` unconditional `reloadCaddy()` → unit test the config emission (gated vs studio catch-all by setup-state) → live verify (pre-setup `/`→/setup; post-setup `/`→studio).
- **US6 (P2) [new]**: idempotent migration (numeric surrogate on `backups`) → `listBackupsForPlatform` (Studio shape, seq id) in `backups-mgmt-service.ts` → replace the `/platform/database/:ref/backups` list stub → wire `/restore-physical` (number→uuid resolve → `initiateRestore` + enqueue → 201) → add `GET /platform/projects/:ref/status` → unit tests (surrogate mapping, status map, restore resolve) → live verify (list real backups, restore runs, status RESTORING→ACTIVE_HEALTHY).
- **US4 (P3)**: CLI/MCP regression, login smoke, `/v1` contract tests (incl. the uuid backup contract unchanged), integration suite — now also covering the US6 migration + the gate.

Ordering: US5 and US6 are independent of each other and of the (already-landed) US2/US3. US6 has a migration (runs at api boot) — land it before the US1 deploy or alongside it. US1 remains the coordinated cutover; the US5 gate ships with it (both touch `caddy-config.ts`).

## Complexity Tracking

*No constitutional violations — no entries.*
