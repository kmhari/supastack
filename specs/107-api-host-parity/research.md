# Research — API host-parity + scoped CORS (feature 107)

All decisions confirmed against the live code. No NEEDS CLARIFICATION remained from the spec; FR-006 (credentials/cookie) is resolved below.

## D1 — CORS in the Fastify app, not the Caddy edge

**Decision**: keep CORS in the app via the already-registered `@fastify/cors`, but **replace** the current `server.ts:197` `app.register(cors, { origin: true, credentials: true })` with a **scoped** configuration sourced from one place (`apps/api/src/config/cors-config.ts`).

**Why**: (1) It's already there. (2) It's the testable layer (FR-013 wants unit/contract coverage). (3) The platform proxy already strips upstream `access-control-*` headers (`platform-proxy.ts:30-33`, `platform-proxy-helpers.ts:66-69`), so the app is the single CORS authority — doing it at the edge too would double-set/conflict. (4) `@fastify/cors` answers preflight `OPTIONS` automatically for the configured methods/headers (FR-003).

**Alternatives**: Caddy edge CORS (header directives + `@cors` matchers) — rejected: verbose, lives in the runtime JSON config (less testable), and would fight the app/proxy headers.

## D2 — `Allow-Credentials: false`; the one cookie isn't a CORS XHR (FR-006 resolved)

**Decision**: scoped CORS uses `credentials: false`. Dashboard→API auth is a **Bearer JWT** in `Authorization` (`auth.ts:82-84`) — no cookie is needed for the dashboard's cross-origin XHRs.

**The cookie**: `@fastify/cookie` is registered, but the **only** read is `oauth/authorize.ts:127` (`req.cookies['sb-access-token']`) — the OAuth 2.1 **authorize** step (feature 014), a **top-level browser navigation** to `/v1/oauth/authorize`, not a cross-origin `fetch`. CORS does not govern navigations, so it's unaffected by `Allow-Credentials`. It DOES depend on the cookie being readable at the host it runs on, so that flow **stays anchored at the apex** (where the cookie is valid), which the dual-served apex `/v1/*` (FR-012) preserves — the MCP authorize URL points at the apex, independent of the dashboard's API base. So nothing about the dashboard-base move touches the cookie flow.

**Consequence**: `Allow-Credentials: false` is correct and is also *safer* than today — see the security note.

## D3 — Allow-Origin = the dashboard apex origin (exact), env-derived; dev origins gated

**Decision**: `cors-config.ts` produces an exact origin allow-list: `https://${SUPASTACK_APEX}` (the dashboard). In non-production, also allow local dev origins (e.g. `http://localhost:5173`) so the dev loop keeps working (the old `origin: true` implicitly allowed them). Never `*` (FR-004). The api host (`api.<apex>`) is the request *target*, not an Origin.

**Why**: FR-004/FR-010 — a credentialed-capable API must echo only the trusted origin. A function `corsOrigin(req.origin)` returns the matched allowed origin or nothing (so a foreign origin gets no grant). Single source so the next reviewer/Studio-bump has one place to audit (FR-005).

## D4 — Explicit `api.<apex>` Caddy host block (boot + runtime)

**Decision**: add a host-matched route for `api.<apex>` in both `caddy-config.ts` (runtime, the VM source of truth) and `apps/caddy/Caddyfile` (cold-boot), routing `/platform/*` + `/v1/*` (+ `OPTIONS`) → `api:3001`, **terminal**, and NOT serving the studio catch-all (a bare `GET api.<apex>/` should not render the dashboard). Placed alongside the per-instance `<ref>.<apex>` host blocks, before the dashboard fallback.

**Why**: today `api.<apex>` works only *incidentally* via the host-agnostic dashboard fallback (FR-008), which also means `api.<apex>/` would serve the studio — wrong for an API host. An explicit block makes the API host intentional + clean.

## D5 — Studio base flip + coordinated deploy/rollback

**Decision**: `infra/docker-compose.yml` Studio `NEXT_PUBLIC_API_URL: "https://api.${SUPASTACK_APEX}"` (was `https://${SUPASTACK_APEX}`); `NEXT_PUBLIC_GOTRUE_URL` unchanged (apex `/auth/v1`). `NEXT_PUBLIC_*` is baked at build → wipe `.next` + `--force-recreate studio`.

**Deploy order** (coordinated, like 086): build+restart **api** first (scoped CORS live at `api.<apex>` + the explicit host route), verify cross-origin with curl `-H Origin`, **then** rebuild Studio. **Rollback**: revert `NEXT_PUBLIC_API_URL` to the apex + rebuild Studio — no api/CORS change needed (apex dual-serves). The scoped-CORS change is independently safe (it only *tightens* the existing posture).

## Security note (bonus the feature delivers)

The current `{ origin: true, credentials: true }` reflects **any** origin with credentials. Today the practical exposure is limited (dashboard XHRs are Bearer, not cookie; the only cookie is the OAuth-authorize navigation), but it is a bad posture. Scoping to the exact apex origin with `credentials: false` removes it — a net security improvement, satisfying FR-004/FR-010.

## Confirmed code anchors

| What | Location |
|---|---|
| Current open CORS (to replace) | `apps/api/src/server.ts:197` |
| Bearer auth (no cookie for XHR) | `apps/api/src/plugins/auth.ts:73,82-84` |
| The only cookie read (OAuth nav) | `apps/api/src/routes/oauth/authorize.ts:127` |
| Proxy strips upstream CORS | `routes/platform-proxy.ts:30-33`, `services/platform-proxy-helpers.ts:66-69` |
| Caddy host blocks + dashboard fallback | `services/caddy-config.ts` (`dashboardSubroutes` ~L71; per-host `match:[{host}]` ~L183) |
| Studio base | `infra/docker-compose.yml:368` (+ GOTRUE L372) |
| CORS-touching test to check | `apps/api/tests/unit/platform-proxy.test.ts` |
