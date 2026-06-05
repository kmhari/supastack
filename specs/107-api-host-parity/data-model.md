# Data Model — feature 107

**No persistent entities, no migration.** The only "model" is the CORS policy (a configuration value) and the host-routing rule. Both are derived from existing config (`SUPASTACK_APEX`), not stored.

## CORS policy (config, not persisted) — `apps/api/src/config/cors-config.ts`

| Field | Value | Source / rule |
|---|---|---|
| allowed origins | `https://${SUPASTACK_APEX}` (+ dev origins in non-prod) | env `SUPASTACK_APEX`; exact match, never `*` (FR-004) |
| `Access-Control-Allow-Origin` (response) | the matched request `Origin`, or absent | echo only if the request origin ∈ allowed; foreign → no header (FR-010) |
| allowed methods | `GET, POST, PUT, PATCH, DELETE, OPTIONS` | the methods the dashboard uses |
| allowed headers | `authorization, content-type, x-connection-encrypted, x-pg-application-name, x-request-id` (+ standard) | the Studio's request headers (HAR-observed) (FR-005) |
| `Allow-Credentials` | `false` | Bearer auth, no cross-origin cookie (FR-006, research D2) |
| `Max-Age` (preflight) | a sane cache (e.g. 600s) | avoid an OPTIONS per request |

State: none. The list is computed once at boot from env.

## Host route (Caddy) — `caddy-config.ts` + `Caddyfile`

| Host | Routes | Behaviour |
|---|---|---|
| `api.<apex>` | `/platform/*`, `/v1/*`, `OPTIONS *` → `api:3001`; else 404 | terminal; does NOT serve the studio catch-all |
| `<apex>` (dashboard) | unchanged (incl. dual-served `/platform/*` + `/v1/*`, FR-012) | studio catch-all stays |

No state; derived from `apex`.
