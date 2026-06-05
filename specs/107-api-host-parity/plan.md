# Implementation Plan: API host-parity — serve platform + Management API at `api.<apex>` (scoped CORS)

**Branch**: `107-api-host-parity` | **Date**: 2026-06-05 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `specs/107-api-host-parity/spec.md`

## Summary

Point the shared Studio's API base at a dedicated `api.<apex>` host (mirroring Supabase's `api.supabase.com`), which makes the dashboard→API calls **cross-origin**. The api already registers `@fastify/cors` but as **`{ origin: true, credentials: true }`** — wide open; this feature **replaces it with a scoped allow-list** (exact dashboard apex origin only, the specific Studio request headers incl. the custom `x-*` set, `Allow-Credentials: false`), which both enables the cross-origin dashboard *and* fixes a latent permissive-CORS posture. Add an explicit `api.<apex>` Caddy host route (boot `Caddyfile` + runtime `caddy-config.ts`) so the API host is intentional and does **not** serve the studio catch-all. Flip `NEXT_PUBLIC_API_URL → https://api.${SUPASTACK_APEX}` and rebuild Studio; keep `NEXT_PUBLIC_GOTRUE_URL` at the apex. Auth is Bearer (no cross-origin cookie); the one cookie (`sb-access-token`) is used only by the OAuth-authorize navigation flow, which stays at the apex (dual-served). No migration, no new dependency (`@fastify/cors` + `@fastify/cookie` already present).

## Technical Context

**Language/Version**: TypeScript 5.x — Node 20 Fastify (`apps/api`), React 18 Studio (vendored, env-driven), Caddy (JSON config via `caddy-config.ts` + boot `Caddyfile`)

**Primary Dependencies**: `@fastify/cors` (already registered, `server.ts:197`), `@fastify/cookie` (already, `auth.ts:73`); Caddy host routing (`caddy-config.ts`, `apps/caddy/Caddyfile`); Studio env (`NEXT_PUBLIC_API_URL`). **No new deps.**

**Storage**: N/A (no DB read/write)

**Testing**: Vitest — new CORS contract test (`apps/api/tests`), updated `caddy-config` routing test for the api-host block, the pinned `/v1` OpenAPI contract test (must stay green), `apps/api/tests/unit/platform-proxy.test.ts` checked for CORS-header assumptions

**Target Platform**: control-plane api + Caddy edge + the operator's browser (cross-origin) + non-browser CLI/MCP

**Project Type**: Web application (`apps/api` + vendored Studio) + edge (Caddy)

**Performance Goals**: preflight cached (`Access-Control-Max-Age`) to avoid an OPTIONS per request; no added latency on the hot path

**Constraints**: `Allow-Origin` MUST be exact (never `*`) for a credentialed-capable API (FR-004); the custom-header allow-list must be complete or pages silently break (FR-005); `/v1` contract unchanged (FR-009); coordinated deploy + clean rollback (FR-011)

**Scale/Scope**: ~4 edit sites — `server.ts` CORS config (→ a `cors-config.ts` single source), `caddy-config.ts` + `Caddyfile` api-host block, `docker-compose.yml` Studio env — + 2 tests + docs

## Constitution Check

*GATE: Must pass before Phase 0. Re-checked after Phase 1.*

| Principle | Applies? | Assessment |
|---|---|---|
| I. Idempotent, additive migrations | No | No DB migration. |
| II. Secrets encrypted, master key home | No | No secrets touched. |
| III. Authorize every privileged action | No (adjacent) | No new privileged endpoint or RBAC action. CORS is a transport control; **tightening** the open `origin:true` posture to an exact origin is a security *improvement* (FR-004/FR-010). |
| IV. Supabase compatibility pinned contract | **Yes** | The `/v1/*` paths + shapes are unchanged — only the **host** the dashboard targets changes (`api.<apex>/v1` already works for the CLI). The pinned OpenAPI snapshot + contract test MUST stay green (FR-009, SC-004). |
| V. Worker owns per-instance state | No | No worker job. |
| VI. Spec-driven, evidence-based | **Yes** | CORS contract test + caddy-config routing-test update + `/v1` no-drift + live cross-origin verify (FR-013, SC-006). |

**Result: PASS** — no violations; the only material gate is IV (no `/v1` contract drift), which is satisfied because nothing about the request/response shape changes.

## Project Structure

### Documentation (this feature)

```text
specs/107-api-host-parity/
├── plan.md
├── research.md          # D1–D5 + the cookie/OAuth finding + the open-CORS security note
├── data-model.md        # the CORS policy (no persistent entities)
├── quickstart.md        # cross-origin / foreign-origin / preflight / CLI-no-regress / rollback
├── contracts/
│   └── cors-policy.md    # origin allow-list, methods, headers, credentials, preflight
└── tasks.md             # /speckit-tasks output
```

### Source Code (repository root)

```text
apps/
  api/src/
    config/cors-config.ts        # NEW — single source: allowed origins (from SUPASTACK_APEX, + dev), headers, methods, credentials
    server.ts                    # L197: replace `cors {origin:true, credentials:true}` with the scoped config
    services/caddy-config.ts      # NEW explicit api.<apex> host block → /platform/* + /v1/* (+ OPTIONS) → api; not the studio catch-all
  caddy/Caddyfile                 # boot-time api.<apex> host block (cold-boot parity)
  api/tests/                      # NEW cors-policy.test.ts; UPDATE caddy-config-*.test.ts (api-host route); check platform-proxy.test.ts
infra/docker-compose.yml          # Studio NEXT_PUBLIC_API_URL → https://api.${SUPASTACK_APEX} (GOTRUE_URL unchanged)
```

**Structure Decision**: CORS lives in the **Fastify app** (not the Caddy edge) — it's already there, it's the testable place (FR-013), and the proxy already strips upstream `access-control-*` so the app is the sole CORS authority. Caddy only gains a **host route** so `api.<apex>` is explicit. The CORS allow-list is extracted to `config/cors-config.ts` as the single auditable source (FR-005).

## Complexity Tracking

None — Constitution Check passes with no violations. The dual-serve of the apex routes (FR-012) is the deliberate low-risk/reversible choice, not a complexity exception.
