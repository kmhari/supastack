# Contract — Apex routing & root mounts (P1)

## API (`apps/api/src/server.ts`)

**Add** (after the existing root `platformProxyRoutes`, ~server.ts:225):
```
await app.register(platformMiscRoutes);   // /platform/* at root (apex base=root)
```

**Already at root (no change)**: `platformProxyRoutes` (225), inline Studio Management stubs `/v1/projects/:ref/*` (243-318), `/v1` mgmt scope (353-400).

**Remove post-rebuild only** (after the root-base Studio is confirmed live):
- `app.all('/api/v1/v1/*', …)` shim (323-335)
- `app.register(platformProxyRoutes, { prefix: '/api/v1' })` (228)
- `app.register(platformMiscRoutes, { prefix: '/api/v1' })` (229)

**Invariant**: no two handlers may declare the identical method+path at the same prefix. `platformProxyRoutes` (proxy paths) and `platformMiscRoutes` (profile/orgs/projects/...) are disjoint — safe to co-register at root.

## Edge (`apps/caddy/Caddyfile` + `apps/api/src/services/caddy-config.ts`)

Add a `/v1*` → `api:3001` route at the apex, ordered **after** `/api/*` and **before** the studio catch-all, in BOTH:

1. `apps/caddy/Caddyfile` — `:80` block and `:443`/apex block:
```
handle /v1* {
    reverse_proxy api:3001
}
```
2. `apps/api/src/services/caddy-config.ts` `dashboardSubroutes` — the runtime apex config (VM source of truth). Mirror the existing `/api/v1*` subroute entry, path `/v1*` → upstream `api:3001`.

**Apex handle ordering (must hold)**: `/.well-known/acme-challenge/*` → `/api/*` → **`/v1*` (new)** → `/platform/*` → `/auth/v1/*` → websocket → `/internal/*` → `/setup*` → catch-all(studio).

## Acceptance

- `GET https://<apex>/v1/projects/<ref>/api-keys` (operator session) → 200, identical body to the prior `/api/v1/v1/...` path.
- `GET https://<apex>/platform/profile` → 200 (was only reachable at `/api/v1/platform/profile`).
- `GET https://api.<apex>/v1/projects/<ref>/...` (CLI PAT) → unchanged.
- After shim removal: no route references `/api/v1/v1/*`; no studio request 404s.
