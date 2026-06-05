---
description: "Task list — feature 107 API host-parity (api.<apex> + scoped CORS)"
---

# Tasks: API host-parity — serve platform + Management API at `api.<apex>` (scoped CORS)

**Input**: Design documents from `specs/107-api-host-parity/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/cors-policy.md, quickstart.md

**Tests**: INCLUDED — FR-013 + SC-006 require a CORS contract test, an updated Caddy-routing test, and `/v1` no-drift; operator preference is happy + sad path.

**Organization**: by user story (US1 dashboard-works P1; US2 origin-locked P2; US3 no-regression P3). The scoped CORS config is the shared core (Foundational) both US1 and US2 build on. No migration, no new dependency (`@fastify/cors` + `@fastify/cookie` already present). ~4 source edits + 2 tests.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: parallelizable (different files, no incomplete deps).
- Paths are repo-relative.

---

## Phase 1: Setup (baseline)

- [ ] T001 Confirm on branch `107-api-host-parity` (off `supastack-rewrite`); capture a green baseline: `pnpm exec vitest run --project @supastack/api` + `pnpm --filter @supastack/web build`. Record the current permissive CORS at `apps/api/src/server.ts:197` (`{ origin: true, credentials: true }`) so the replacement is verifiable.

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: the scoped CORS allow-list — the single source both US1 (enables cross-origin) and US2 (locks the origin) depend on. MUST complete before US1/US2.

- [ ] T002 Create `apps/api/src/config/cors-config.ts` — the single auditable CORS source (per contracts/cors-policy.md): allowed origins = `https://${SUPASTACK_APEX}` (+ dev origins like `http://localhost:5173` ONLY when `NODE_ENV !== 'production'`); allowed methods `GET,POST,PUT,PATCH,DELETE,OPTIONS`; allowed headers `authorization, content-type, x-connection-encrypted, x-pg-application-name, x-request-id` (+ standard); `credentials: false`; a sane `maxAge`. Export a `@fastify/cors` options object whose `origin` is a function returning the matched origin or rejecting (no echo for unknown origins). Read `SUPASTACK_APEX` from env.
- [ ] T003 In `apps/api/src/server.ts` (~L197) replace `app.register(cors, { origin: true, credentials: true })` with `app.register(cors, corsOptions)` imported from `config/cors-config.ts`. (Same-origin `/setup` SPA + non-browser CLI are unaffected — they send no `Origin`.)

---

## Phase 3: US1 — The dashboard works fully against the dedicated API host (Priority: P1)

**Goal**: the Studio, pointed at `api.<apex>`, works cross-origin with 0 CORS errors; the API host is explicit and doesn't serve the studio.
**Independent test**: quickstart §1 (CORS happy + preflight) + §3 (live cross-origin pages + sign-in).

- [ ] T004 [US1] Add an explicit `api.<apex>` host block to `apps/api/src/services/caddy-config.ts` (runtime, VM source of truth): `match: [{ host: ['api.<apex>'] }]`, `terminal: true`, subroutes routing `/platform/*` + `/v1/*` (+ `OPTIONS`) → `api:3001`, and a catch-all → 404 (do NOT serve the studio). Place alongside the per-instance `<ref>.<apex>` host blocks, before the dashboard fallback. Skip when no apex configured.
- [ ] T005 [P] [US1] Add the same `api.<apex>` host block to the boot `apps/caddy/Caddyfile` (cold-boot parity) — route `/platform*` + `/v1*` → `api:3001`, no studio catch-all for that host.
- [ ] T006 [US1] In `infra/docker-compose.yml`, change the Studio `NEXT_PUBLIC_API_URL` from `https://${SUPASTACK_APEX}` to `https://api.${SUPASTACK_APEX}`. Do NOT touch `NEXT_PUBLIC_GOTRUE_URL` (stays apex `/auth/v1`). Add the rebuild note (NEXT_PUBLIC_* baked at build → wipe `.next` + `--force-recreate studio`).
- [ ] T007 [P] [US1] CORS contract test `apps/api/tests/unit/cors-policy.test.ts` (happy + preflight): a request with the dashboard apex `Origin` → `Access-Control-Allow-Origin` echoes it exactly; a preflight `OPTIONS` (with `Access-Control-Request-Method: POST` + the custom headers) → returns the allowed methods + the full header allow-list incl. `authorization`/`x-connection-encrypted`/`x-pg-application-name`/`x-request-id`; no `Access-Control-Allow-Credentials`. (Register `@fastify/cors` with the `cors-config.ts` options on a bare Fastify app + `app.inject`.)
- [ ] T008 [P] [US1] Update the Caddy-routing test (`apps/api/tests/unit/caddy-config-*.test.ts`, or a new `caddy-config-api-host.test.ts`): assert `buildCaddyConfig` emits a terminal `api.<apex>` host route whose subroutes send `/platform/*` + `/v1/*` to `api:3001` and that the studio catch-all is NOT present under that host.
- [ ] T009 [US1] LIVE VERIFY (quickstart §3; deploy-gated): deploy api first → `curl -H "Origin: https://<apex>" https://api.<apex>/platform/profile` echoes the origin; preflight `OPTIONS` for the pg-meta POST returns the header allow-list; `https://api.<apex>/` → 404 (no studio). Then rebuild Studio (base=api host) → every project page loads with 0 CORS errors in console; sign-in works (apex `/auth/v1`); a pg-meta query + a mutation succeed cross-origin.

**Checkpoint**: dashboard fully functional cross-origin; API host explicit + clean.

---

## Phase 4: US2 — Cross-origin access is locked to the dashboard origin only (Priority: P2)

**Goal**: only the dashboard apex origin gets a CORS grant; never `*`; foreign origins are refused.
**Independent test**: quickstart §1 (foreign-reject unit) + §3a (live foreign-origin refused).

- [ ] T010 [US2] Extend `apps/api/tests/unit/cors-policy.test.ts` with the security cases (depends on T007 — same file): a foreign `Origin: https://evil.example` → response has **no** `Access-Control-Allow-Origin`; the allow-origin is never `*`; a dev origin is allowed ONLY when `NODE_ENV !== 'production'` (assert it is rejected when production).
- [ ] T011 [US2] LIVE VERIFY (quickstart §3a; deploy-gated): `curl -D- -H "Origin: https://evil.example" https://api.<apex>/platform/profile` → no `access-control-allow-origin` header for that origin.

**Checkpoint**: the credentialed API only serves CORS to the dashboard origin (the prior `origin:true` posture is gone).

---

## Phase 5: US3 — No regression to CLI, MCP, login, or the `/v1` contract (Priority: P3)

**Goal**: existing surfaces unchanged.
**Independent test**: quickstart §2 (no drift) + §4 (CLI/login live).

- [ ] T012 [US3] No-drift gate: `pnpm exec vitest run management-api contract` green (the pinned `/v1` OpenAPI contract — Constitution IV); check `apps/api/tests/unit/platform-proxy.test.ts` for any assertion that relied on the old open CORS and update it; run the full `--project @supastack/api` suite green.
- [ ] T013 [US3] LIVE VERIFY (quickstart §4; deploy-gated): the `supabase` CLI against `api.<apex>/v1` (list / migration list / gen-types) succeeds identically; a login round-trip at the apex works (same-origin, no CORS). MCP unaffected.

**Checkpoint**: CLI/MCP/login/`/v1` all unchanged.

---

## Phase 6: Polish & Cross-Cutting

- [ ] T014 [P] Runbook `docs/changes/107-api-host-parity.md` (the latent open-CORS finding + the scoped allow-list, the `api.<apex>` host block, the cookie/OAuth-navigation note, coordinated deploy + rollback) and flip the `CLAUDE.md` active-feature status → implemented once green.
- [ ] T015 Final gate: full `@supastack/api` suite + the `/v1` contract test + the caddy-config tests + `pnpm --filter @supastack/web build` + `pnpm lint` all green; quickstart §1–§2 pass.

---

## Dependencies & parallelism

- **Foundational** (T002 → T003) blocks US1 + US2 (the scoped CORS config is the shared core).
- **US1**: T004/T005 (Caddy ×2) ∥ T006 (compose) ∥ T007 (CORS test) ∥ T008 (caddy test) — different files. T009 live (after the api deploy).
- **US2**: T010 depends on T007 (same test file); T011 live.
- **US3**: T012 after T003 (CORS swapped); T013 live.
- **MVP = US1** (the user-facing cross-origin dashboard). US2 hardens it (security); US3 guards regressions. All three deploy together (coordinated: api → Studio).

### Parallel example (after Foundational T002+T003)
```
T004 (caddy-config api host) ┐
T005 (Caddyfile)        [P]  ├─ parallel ─┐
T006 (compose base)     [P]  │            │
T007 (CORS test)        [P]  ┘            │
T008 (caddy test)       [P] ──────────────┘
# then US2: T010 → T011 ; US3: T012 → T013 ; Polish: T014 [P], T015
```

**Total: 15 tasks** — Setup 1, Foundational 2, US1 6 (incl. 2 tests + 1 live), US2 2, US3 2, Polish 2.
