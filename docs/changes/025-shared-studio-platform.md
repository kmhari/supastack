# Feature 025: Shared Studio (IS_PLATFORM=true)

**Branch**: `083-shared-studio-platform` | **Date**: 2026-06-01

## What Changed

Replaced N per-project Supabase Studio containers with a single shared Studio service running in the control plane at `IS_PLATFORM=true`. Studio is served at the apex root (`https://<apex>/`). All project data flows through new platform-proxy routes in Supastack's Fastify API.

## Architecture

```
Browser → https://<apex>/project/<ref>/editor
  └─ Studio SPA (single container, IS_PLATFORM=true)
       └─ GET /platform/pg-meta/<ref>/tables → Supastack API
            └─ resolveKongPort(ref) → portKong
                 └─ http://host.docker.internal:<portKong>/pg-meta/v0/tables
```

**Caddy routing at apex**:
```
/api/v1/*   → Fastify API (api:3001)
/setup*     → web SPA  (web:80)  ← setup wizard preserved
/*          → Studio   (studio:3000)  ← new catch-all
```

## New Files

| File | Purpose |
|---|---|
| `apps/api/src/routes/platform-proxy.ts` | Fastify plugin — 4 route groups proxying to per-instance Kong |
| `apps/api/src/services/platform-proxy-helpers.ts` | `resolveKongPort()` + `proxyToKong()` helpers |
| `apps/api/tests/unit/platform-proxy.test.ts` | 10 unit tests (all passing) |

## Modified Files

| File | Change |
|---|---|
| `apps/api/src/server.ts` | Register `platformProxyRoutes` |
| `apps/api/src/routes/instances.ts` | `instanceUrls()` — studio URL now `https://<apex>/project/<ref>` |
| `apps/web/src/pages/ProjectGeneral.tsx` | "Open Studio" link uses `data.urls.studio` |
| `apps/caddy/Caddyfile` | Add `/setup*` handler; change catch-all to `studio:3000` |
| `infra/docker-compose.yml` | Add `studio` service (node:20-alpine, next dev) |
| `infra/supabase-template/docker-compose.yml` | Remove `studio` service + kong `depends_on` |

## Proxy Route Groups

| Studio path | Upstream (Kong) |
|---|---|
| `ANY /platform/pg-meta/:ref/*` | `/pg-meta/v0/*` |
| `ANY /platform/storage/:ref/*` | `/storage/v1/*` |
| `ANY /platform/auth/:ref/users*` | `/auth/v1/admin/users*` |
| `POST /platform/auth/:ref/invite` | `/auth/v1/admin/users` |
| `POST /platform/auth/:ref/{magiclink,otp,recover}` | `/auth/v1/admin/generate_link` |
| `GET/POST /platform/projects/:ref/analytics/*` | `/analytics/v1/*` |

Headers stripped from requests: `x-connection-encrypted`
Headers stripped from responses: `access-control-*`

## Deploy Steps

```bash
# 1. Sync source and rebuild api (new proxy routes)
rsync -av --exclude node_modules . ubuntu@148.113.1.164:/opt/supastack/
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose build api && sudo docker compose up -d api"

# 2. Restart caddy to pick up new routing rules
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose restart caddy"

# 3. Start shared Studio (ensure STUDIO_SOURCE_DIR and APEX_DOMAIN are set in .env)
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose up -d studio"

# 4. Verify
curl -s https://<apex>/api/v1/health  # → {"status":"ok"}
curl -I https://<apex>/               # → 200 from Studio next dev server
curl -I https://<apex>/setup          # → 200 from web SPA
```

## Adding More Proxy Routes

Add routes to `apps/api/src/routes/platform-proxy.ts` following the existing pattern:

```ts
app.route<{ Params: { ref: string; '*': string } }>({
  method: ['GET', 'POST'],
  url: '/platform/realtime/:ref/*',
  handler: (req, reply) =>
    handleProxy(app, req as FastifyRequest<{ Params: { ref: string } }>, reply,
      '/realtime/v1/', (req.params as { ref: string; '*': string })['*']),
});
```

## Phase 2: Production Build (Future)

The current setup runs `next dev` (single-threaded, slow). Phase 2:
1. Create `apps/studio-build/Dockerfile` with `next build` + standalone output
2. Bake `NEXT_PUBLIC_IS_PLATFORM=true` and `NEXT_PUBLIC_API_URL` at build time
3. Replace the `node:20-alpine` + volume mount with the built image

## Known Limitations (Phase 1)

- `next dev` is slow and single-threaded — not suitable for concurrent multi-user load
- `portStudio` is still allocated per project (notNull constraint) but nothing listens on it
- Playwright e2e smoke test (T019) is deferred — requires live stack boot in CI
