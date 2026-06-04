# Implementation Plan: Platform Studio base=root API URL + legacy studio reduced to /setup

**Branch**: `086-platform-base-root-url` | **Date**: 2026-06-04 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `specs/086-platform-base-root-url/spec.md`

## Summary

Three coupled changes, none requiring a DB migration:

1. **P1 — base=root cutover.** Point the platform studio's API base at the apex root so its calls resolve as `/platform/*` and `/v1/*` (no `/api/v1/v1/*` doubling). Concretely: add **one** server.ts mount (`platformMiscRoutes` at root), add a Caddy `/v1*` → `api:3001` rule in **two** places (`apps/caddy/Caddyfile` + the runtime `caddy-config.ts dashboardSubroutes`), flip `NEXT_PUBLIC_API_URL` to the apex root, rebuild the Studio image (NEXT_PUBLIC_* is build-baked), and drop the `/api/v1/v1/*` inject shim after the rebuild. Login is unaffected (separate `NEXT_PUBLIC_GOTRUE_URL`).
2. **P2 — legacy SPA reduced to /setup.** Trim `apps/web` to the install wizard only: delete ~24 non-setup pages + 3 page dirs, trim `lib/api.ts` to the setup-needed method groups, delete the page-bound unit tests, and remove the feature-021 Playwright e2e harness (it targets the apps/web SPA, not Studio) + its page-coverage lint.
3. **P3 — setup reuses the platform org primitive.** Extract `createOrganizationWithOwner(tx, {userId, name})` into a new `services/org-store.ts`; call it from both `POST /platform/organizations` and `setup.ts` (inside setup's existing transaction). First user is already created via GoTrue (`ensureGotrueUser`) — verify, no change needed.

`/api/v1` is **retained as the internal engine** (the platform studio's project-create/restart inject into `/api/v1/instances`; backups/audit have their only-real impls there). This feature does not delete it.

## Technical Context

**Language/Version**: TypeScript (Node 20); React 18 (apps/web Vite SPA); Supabase Studio (Next.js — env-only, no source changes).

**Primary Dependencies**: Fastify (`apps/api`), Caddy custom build (`apps/caddy` edge), Vite/React (`apps/web`), Docker Compose (`infra/`). No new dependency.

**Storage**: Postgres (control plane). **No schema change, no migration** — reuses existing `organizations`/`organization_members`/`installation`/`setup_state`/`api_tokens` tables.

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
| I. Idempotent, additive schema | ✅ PASS | No migration. No schema change. |
| II. Secrets encrypted, master key home | ✅ PASS | No new secret handling. Setup PAT mint unchanged. |
| III. Authorize every privileged action | ✅ PASS | No new privileged endpoint. `POST /platform/organizations` keeps `requireAuth` (org.create is open to any authed role by design). Setup stays the unauthenticated bootstrap gated by `setup_state`; Option A preserves this (no faked principal). |
| IV. Supabase compatibility pinned | ✅ PASS (with guard) | `/v1/*` handlers are byte-identical — only newly *routed* at the apex + root-mounted. Guarded by existing `/v1` contract tests + the CLI/MCP cli-e2e regression (US4). No OpenAPI snapshot change. |
| V. Worker owns per-instance state | ✅ PASS | No per-instance state change. Project create still flows `/platform/projects` → `/api/v1/instances` → worker. |
| VI. Spec-driven, evidence-based | ✅ PASS | speckit lifecycle; live-VM E2E + unit coverage planned. |
| Platform: installation vs tenant separation | ✅ PASS | Option A keeps the `installation` singleton write setup-specific; only the tenant org+membership is shared. |
| Platform: edge routing from DB, atomic | ✅ PASS | `/v1*` rule added to `caddy-config.ts dashboardSubroutes` (the DB-state-driven runtime config, source of truth on the VM) + the boot Caddyfile; Caddy config is loaded atomically as today. |

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
│   ├── routing.md       # apex /v1* + root /platform mount; shim removal
│   ├── setup-org.md     # createOrganizationWithOwner shared primitive
│   └── studio-build.md  # NEXT_PUBLIC_API_URL flip + rebuild procedure
├── quickstart.md        # Phase 1 — verification (clean URLs, /setup, CLI, login)
└── checklists/requirements.md
```

### Source code (affected)

```
apps/api/src/
  server.ts                       # +1 line: register platformMiscRoutes at root; later remove /api/v1/v1 shim (323-335) + /api/v1 platform mounts (228-229) post-rebuild
  routes/setup.ts                 # P3: replace inline org insert (48,67-77) with createOrganizationWithOwner(tx,…)
  routes/platform-misc.ts         # P3: POST /platform/organizations (284-297) calls createOrganizationWithOwner
  services/org-store.ts           # P3 NEW: createOrganizationWithOwner(tx,{userId,name})
  services/caddy-config.ts        # P1: add `/v1*` → api in dashboardSubroutes (before studio catch-all)

apps/caddy/Caddyfile              # P1: add `handle /v1* { reverse_proxy api:3001 }` in :80 + :443 blocks (before catch-all, after /api/*)

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

**Structure decision**: existing multi-surface web layout; no new packages/apps. One new service file (`org-store.ts`), one new root route mount, edits to Caddy + compose, and a large deletion in `apps/web`.

## Phase 0 — Research

See [research.md](./research.md). All unknowns resolved:
- **server.ts**: the only required mount is `platformMiscRoutes` at root; `/v1` scope + inline stubs already serve at root.
- **Caddy**: must add `/v1*` in BOTH `Caddyfile` and `caddy-config.ts dashboardSubroutes` (VM source of truth) — the easy-to-miss change; without it apex `/v1/*` falls through to studio.
- **Login**: safe — driven by `NEXT_PUBLIC_GOTRUE_URL` (already apex `/auth/v1`), independent of the base change.
- **SPA slim**: precise keep/delete inventory; Playwright e2e targets apps/web and must be removed/rehomed.
- **Setup org primitive**: Option A (extract `createOrganizationWithOwner`) — preserves setup atomicity + bootstrap; Option B (inject) rejected (breaks the transaction + pre-auth ordering).

## Phase 1 — Design & Contracts

See [data-model.md](./data-model.md), [contracts/](./contracts/), [quickstart.md](./quickstart.md). No external API contract changes (Constitution IV preserved); the "contracts" here are the internal routing + the shared org primitive + the build procedure.

## Phase 2 — Task planning approach

`/speckit-tasks` will generate tasks grouped by user story:
- **US1 (P1)**: server.ts root mount → Caddy `/v1*` (both files) → compose env flip → Studio rebuild procedure → shim removal (post-rebuild) → live verification (0 `/v1/v1` requests).
- **US2 (P2)**: delete non-setup pages/components/lib → trim `api.ts` → delete page-bound unit tests → trim `api.test.ts` → remove e2e harness + page-coverage lint + CI e2e job → `vite build` green.
- **US3 (P2)**: add `services/org-store.ts` + unit test → wire `POST /platform/organizations` → wire `setup.ts` (inside its tx) → verify GoTrue-only user creation.
- **US4 (P3)**: CLI/MCP regression (`tests/cli-e2e`), login smoke, `/v1` contract tests, integration suite (`/api/v1/instances|auth/tokens|backups`).

Ordering: US3 (no deploy dependency) and US2 are independent; US1 is the coordinated deploy. Recommend landing US3 + US2 first, then US1's atomic cutover.

## Complexity Tracking

*No constitutional violations — no entries.*
