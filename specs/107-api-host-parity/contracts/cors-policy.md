# Contract — CORS policy on the API host (`api.<apex>`)

The API (`api.<apex>` and the dual-served apex) returns CORS headers from one source (`apps/api/src/config/cors-config.ts`, applied via `@fastify/cors`). This contract is what the CORS test asserts (FR-013).

## Allowed origin (FR-004, FR-010)

| Request `Origin` | `Access-Control-Allow-Origin` in response |
|---|---|
| `https://<apex>` (the dashboard) | `https://<apex>` (exact echo) |
| `http://localhost:5173` (dev, non-prod only) | echoed only when `NODE_ENV !== 'production'` |
| `https://evil.example` (foreign) | **absent** — no grant |
| (no Origin header — same-origin / non-browser) | not applicable; request proceeds normally |

Never `*`. The matched origin is echoed exactly; an unmatched origin yields **no** `Access-Control-Allow-Origin`, so the browser blocks the JS from reading the response.

## Preflight `OPTIONS` (FR-003, FR-005)

A preflight `OPTIONS` from the dashboard origin returns:

```
Access-Control-Allow-Origin: https://<apex>
Access-Control-Allow-Methods: GET, POST, PUT, PATCH, DELETE, OPTIONS
Access-Control-Allow-Headers: authorization, content-type, x-connection-encrypted, x-pg-application-name, x-request-id, …
Access-Control-Max-Age: <cached>
```
(no `Access-Control-Allow-Credentials` header, since credentials are disabled — see below). A foreign-origin preflight gets no allow headers.

## Credentials (FR-006)

`Access-Control-Allow-Credentials` is **not** set (`credentials: false`). Dashboard→API auth is Bearer (`Authorization` header), which CORS permits without credentials mode. The `sb-access-token` cookie is used only by the `/v1/oauth/authorize` top-level navigation (not a CORS XHR), anchored at the apex — unaffected.

## Header pass-through (proxy)

The platform proxy strips upstream `access-control-*` headers from Kong/pg-meta/storage responses (`platform-proxy.ts`, `platform-proxy-helpers.ts`), so the api's own CORS is the only source — no double/conflicting headers.

## Tests (FR-013)

- **CORS contract** (`apps/api/tests/.../cors-policy.test.ts`): dashboard origin → exact echo; foreign origin → no header; preflight `OPTIONS` → allowed methods + the full header allow-list incl. the custom `x-*`; no `Allow-Credentials`.
- **caddy routing** (`caddy-config-*.test.ts`): the `api.<apex>` host block routes `/platform/*` + `/v1/*` to `api:3001`, terminal, and does not emit the studio catch-all for that host.
- **No drift**: the pinned `/v1` OpenAPI contract test + `platform-proxy.test.ts` unchanged/green (Constitution IV).
