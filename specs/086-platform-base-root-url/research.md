# Phase 0 Research — Platform Studio base=root + legacy studio reduced to /setup

Consolidated from three read-only investigators (2026-06-04) over `apps/api`, `apps/web`, `apps/caddy`, `infra/`.

---

## R1 — API re-mount for apex `/platform/*` + `/v1/*`

**Decision**: Add a single root-level mount — `await app.register(platformMiscRoutes);` (no prefix) in `apps/api/src/server.ts` after the existing root `platformProxyRoutes` (server.ts:225). Keep the `/api/v1`-prefixed mounts (server.ts:228-229) during the transition; remove them + the shim after the Studio rebuild.

**Rationale**: Already at root today — `platformProxyRoutes` (server.ts:225), the inline Studio Management stubs (`/v1/projects/:ref/...`, server.ts:243-318), and the entire `/v1` mgmt scope (server.ts:353-400). The **only** gap is `platformMiscRoutes`, registered exclusively at `/api/v1` (server.ts:229) — so apex `/platform/profile|organizations|projects|auth/:ref/config|...` does not resolve at root today. `platformProxyRoutes` and `platformMiscRoutes` declare disjoint concrete paths, so co-registering both at root is the same safe pattern already used at `/api/v1` — no route collision.

**Alternatives considered**: Re-mount everything at root (unnecessary — most already is). Replace the `/api/v1` mounts outright (rejected — breaks back-compat during the Studio rebuild window).

---

## R2 — Caddy `/v1*` routing at the apex (the must-not-miss change)

**Decision**: Add `handle /v1* { reverse_proxy api:3001 }` (before the studio catch-all, after `/api/*`) in **both**:
1. `apps/caddy/Caddyfile` — the boot skeleton, in the `:80` and `:443` blocks.
2. `apps/api/src/services/caddy-config.ts` `dashboardSubroutes` — the **runtime, DB-state-driven config that overrides the Caddyfile in production** (the VM source of truth).

**Rationale**: Today only `/api/v1*` is routed to the API at the apex (Caddyfile:60,112; caddy-config.ts:99). There is **no `/v1*` rule**, so a bare apex `/v1/...` request falls through the catch-all to `studio:3000` (Caddyfile:84-86; caddy-config.ts:130-131). Without this rule, the server.ts change is moot — the new-base Studio's `/v1/*` calls would never reach the API. `/platform/*` and `/auth/v1/*` are already routed to the API/auth (caddy-config.ts:104-106,110-114), so only `/v1*` is missing. This is consistent with Constitution "edge routing from DB state, loaded atomically".

**Alternatives considered**: Routing only in the static Caddyfile (rejected — `caddy-config.ts` overrides it on the live VM, so the change wouldn't take in production).

---

## R3 — GoTrue login is unaffected (verdict: SAFE)

**Decision**: Do **not** change `NEXT_PUBLIC_GOTRUE_URL`. Only change `NEXT_PUBLIC_API_URL`.

**Rationale**: Operator login is built from `NEXT_PUBLIC_GOTRUE_URL = https://${SUPASTACK_APEX}/auth/v1` (docker-compose.yml:367-368), a **separate** variable from `NEXT_PUBLIC_API_URL`. The login token POST goes to `/auth/v1/token`, routed by Caddy `/auth/v1/*` → `auth:9999` (the real GoTrue container, caddy-config.ts:110-114) — independent of the API and of `NEXT_PUBLIC_API_URL`. Feature 084 moved login/logout off the API (`auth.ts:7-8` keeps only `/auth/me` + PAT mgmt). Changing the API base has zero effect on login.

**Alternatives considered**: none needed — verified by env + routing + code.

---

## R4 — Studio build (NEXT_PUBLIC_* is baked at build time)

**Decision**: Set `NEXT_PUBLIC_API_URL: "https://${SUPASTACK_APEX}"` (drop `/api/v1`) in `infra/docker-compose.yml`. On the VM: `rm -rf "$STUDIO_SOURCE_DIR/apps/studio/.next"` then `docker compose up -d --force-recreate studio`.

**Rationale**: All `NEXT_PUBLIC_*` are inlined at `next build`, not read at runtime (docker-compose.yml:353-362); the container only rebuilds when `.next/BUILD_ID` is absent (line 347). The feature-084 deploy note is a direct precedent (a stale `NEXT_PUBLIC_GOTRUE_URL` build 404'd sign-in). `NEXT_PUBLIC_IS_PLATFORM=true` + `NEXT_PUBLIC_BASE_PATH=/dashboard` unchanged.

---

## R5 — Legacy SPA reduced to /setup (inventory + test impact)

**Decision**: Keep only `pages/Setup.tsx` + its import chain (`CopyButton`, `ui/{button,input,label,alert}`, `lib/{api(trimmed),cli-wrapper,auth-context,utils}`, `main.tsx`, trimmed `App.tsx`, `index.css/html`). Trim `App.tsx` to `<Route path="/setup">` + catch-all `*` → `/setup`. Delete all other pages (~24 + the `auth-providers/`, `auth-url-config/`, `auth-hooks/` dirs), the page-only components/shells, and the unused libs. Trim `lib/api.ts` to `setupApi`, `apexApi`, `wildcardCertApi`, `orgApi.patch`, `authApi.me` (+ backing types).

**Test impact (decision)**: 
- Trim `apps/web/tests/unit/api.test.ts` to the kept method assertions; delete the 8 page-bound unit tests.
- **Remove (or rehome as a follow-up) the entire Playwright e2e harness** under `apps/web/tests/e2e/**` and reset `tests/e2e/expected-pages.ts` + `scripts/check-page-coverage.mjs`, and drop/adjust the `e2e` CI job. They target the **legacy apps/web SPA** (`localhost:5173`, `pnpm --filter @supastack/web dev`), not Studio, so deleting the pages breaks them.

**Rationale**: Caddy already routes only `/setup*` → `web:80`; everything else → `studio:3000`, so the non-setup SPA pages are already unreachable in production. This is dead-source removal. The cost is the feature-021 browser-test harness, which never tested the platform studio (it tested apps/web) — so the platform studio has **no** browser-level coverage today regardless.

**Alternatives considered**: Keep the pages but stop serving them (rejected — leaves dead source + a misleading test suite). Rehome the e2e harness to target the studio in this feature (deferred — larger effort; filed as follow-up).

**Open risk for implementation**: the Setup import chain was traced explicitly but not exhaustively grepped for incidental `components/ui/*` usage — validate with `vite build` after pruning (an unused import surfaces as a missing-module error).

---

## R6 — Setup reuses the platform org primitive (Option A)

**Decision**: Extract `createOrganizationWithOwner(tx, { userId, name })` into a new `apps/api/src/services/org-store.ts` (mirroring `project-store.ts`), accepting an `Inserter`/`tx` so setup can call it **inside its existing transaction**. Wire both `POST /platform/organizations` (platform-misc.ts:284-297) and `setup.ts` (replacing the inline insert at setup.ts:48,67-77) to it. First user creation is **already** GoTrue-only (`ensureGotrueUser`, setup.ts:42-46; `schema.users` = `auth.users`, identity.ts:37) — verify, no change.

**Rationale**: The org+owner-membership insert pair is duplicated byte-for-byte (setup.ts:67-77 ≡ platform-misc.ts:290-295); no shared helper exists today (`org-membership.ts` is read/invite-only). Option A is a pure 3-statement relocation that:
- **Preserves setup atomicity** — installation + first-org + setup_state + PAT stay in one transaction.
- **Preserves the bootstrap model** — setup remains the unauthenticated, `setup_state`-gated bootstrap (Constitution III: org.create is open to any authed role and the platform route keeps `requireAuth`; setup is correctly exempt).
- **Keeps installation vs tenant separation** — the `installation` write stays setup-specific; only the tenant org is shared.

**Alternatives considered — Option B (`app.inject` POST /platform/organizations with a freshly-minted PAT)**: **Rejected.** (1) No precedent — every existing `app.inject` forwards the *caller's* auth header; setup has none. (2) The PAT is minted inside setup's tx; a fresh inject request on a separate pooled connection wouldn't see the uncommitted `api_tokens` row — forcing a commit-PAT-first restructure that splits setup's atomicity. (3) The injected org commits in its own tx outside setup's — on a later setup failure you'd orphan an org. (4) Pure overhead (HTTP round-trip + re-auth) for a 2-row insert.

---

## Cross-cutting: deploy is atomic

The three P1 edits (server.ts root mount, Caddy `/v1*` in both files, `NEXT_PUBLIC_API_URL` flip + rebuild) MUST deploy together. A rebuilt root-base Studio without the Caddy `/v1*` rule would 404 every Management-compat call. Rollback = revert the Studio image (restores the `/api/v1` base, which the still-present `/api/v1` mounts + shim continue to serve) together with the API/Caddy revert. Remove the `/api/v1/v1` shim + the `/api/v1` platform mounts only *after* the rebuilt Studio is confirmed live.

---

## R7 — US5 setup-completion gate (mechanism)

**Decision**: Option (d) — DB-state-driven Caddy route. `caddy-config.ts buildCaddyConfig()` reads `setup_state.completed_at` (alongside its existing `installation` read) and, when incomplete, emits a `static_response` 302→`/setup` as the apex catch-all (after `/setup*`, before the studio catch-all). `setup.ts` `reloadCaddy()` becomes unconditional on completion (today gated on `apexDomain`, `setup.ts:111`). The boot `Caddyfile` (`:80`+`:443`) defaults its catch-all to the **gated** 302 (boot config can't read the DB). Fail-safe: a DB-read error defaults to gated.

**Rationale**: Caddy serves `/`, `/dashboard`, and project URLs **directly** to `studio:3000` via the apex catch-all (`caddy-config.ts:130-131`); the api never sees them. There is **no `forward_auth`/`handle_response` precedent** in the repo (zero hits), and a per-request gate adds latency to every dashboard request. Pre-setup there is no GoTrue operator/org, so `/platform/*` bootstrap calls 401 and the studio is a non-functional sign-in loop — exactly what the gate prevents. The reconfigure-on-completion model matches how the edge already manages DB-driven state (cert, instances), needs **zero Studio source changes**, has **no per-request cost**, and the authoritative signal is `setup_state.completed_at` (no on-disk sentinel exists or is needed).

**Alternatives considered**: (a) Caddy `forward_auth` → api gate endpoint (per-request cost, no precedent, fiddly redirect semantics — the `/internal/tls/ask` pattern is the template if ever needed); (b) route the apex catch-all through the api as a full studio reverse-proxy (huge new surface — HTML/asset/websocket streaming — rejected); (c) api redirect-only handler at `/` (same hand-back problem). Only the studio catch-all is gated — `/setup*`, `/api/*`, `/v1*`, `/platform/*`, `/auth/v1/*`, `/.well-known/*`, `/internal/*`, and per-instance `<ref>.<apex>` hosts stay reachable pre-setup.

## R8 — US6 backup-engine migration (adapter + numeric surrogate)

**Decision**: Adapter over the existing engine + a numeric-surrogate migration. The engine is complete: `backups` table (uuid id, status `running|completed|failed`), `initiateRestore()` (validates the backup, inserts a `restore_jobs` row, sets `supabase_instances.status='restoring'` in one tx), `restoreQueue` (`selfbase.restore`), and `handleRestore()` worker (`pg_restore`, sets status back to `running` on success). The platform routes become a thin adapter emitting the **vendored-Studio Cloud shape** and resolving the surrogate id back to the native uuid before reusing `initiateRestore` + the queue.

**Rationale**: Verified against the pinned studio types (commit `8cd39680ef`, `packages/api-types/types/platform.d.ts`): `BackupsResponse.backups[].id` and `project_id` are **`number`**, with `isPhysicalBackup`, UPPERCASE `status`, and `physicalBackupData` in **unix-seconds**. Native backup id is a **uuid** → returning a string where `number` is typed is type-unsafe and brittle. A numeric surrogate (`bigint` identity column on `backups`, idempotent migration) gives a stable number for the studio while the uuid stays the CLI/`/v1` contract. Restore body is `{ id:number }` → resolve `seq→uuid` → reuse `initiateRestore`. Status reuses the repo idiom `status==='running'?'ACTIVE_HEALTHY':status.toUpperCase()` (`restoring→RESTORING`). The api only enqueues; the worker owns the restore (Constitution V). `region:'local'`, `pitr_enabled:false`, `walg_enabled:false`, `project_id` = deterministic int hash of ref (display-only).

**Alternatives considered**: (1) return the uuid string as `id` (rejected — violates studio types; brittle even if JSON survives at runtime); (2) no-migration deterministic hash of the uuid → number with reverse-lookup-by-rehash (rejected — collision risk, uglier than a surrogate column). The existing `listBackupsForCli` is the **CLI** shape (snake_case/ISO) and must NOT be reused for the studio route — a new `listBackupsForPlatform` emits the Cloud shape. **Note**: the restore queue is named `selfbase.restore` (the rename didn't reach it); reuse it as-is (out of scope to rename here, but flag it).
