# Quickstart: Shared Studio Platform

**Feature**: 025-shared-studio-platform | **Date**: 2026-06-01

## Overview

This feature replaces per-project Studio containers with a single shared Studio in the control plane. After implementation, Studio is served at `https://<apex>/` and all data fetches are proxied through Supastack's API to per-instance Kong gateways.

## Development Setup

### Prerequisites

- Supastack control plane running locally or on the VM (`docker compose up`)
- At least one provisioned project instance
- Node.js 20 + pnpm for running the Studio dev server

### Running Studio Against Local Supastack API

```bash
# On the VM — start the studio dev server
cd /opt/supabase-vanilla
NEXT_PUBLIC_IS_PLATFORM=true \
NEXT_PUBLIC_API_URL=http://localhost:3001/api/v1 \
NEXT_PUBLIC_GOTRUE_URL=http://localhost:3001/api/v1 \
pnpm --filter studio exec next dev -p 3000
```

### Testing Platform Proxy Routes

```bash
# Check pg-meta proxy (replace <ref> and <TOKEN>)
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3001/platform/pg-meta/<ref>/tables

# Check storage proxy
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3001/platform/storage/<ref>/buckets

# Check auth users proxy
curl -H "Authorization: Bearer <TOKEN>" \
  http://localhost:3001/platform/auth/<ref>/users
```

### Verifying Route Groups are Registered

```bash
curl http://localhost:3001/api/v1/__routes 2>/dev/null | grep platform/pg-meta
# Should show registered platform-proxy routes
```

## Deploy to VM

```bash
# Sync and rebuild api service (new proxy routes)
rsync -av apps/api ubuntu@148.113.1.164:/opt/supastack/apps/
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose build api && sudo docker compose up -d api"

# Restart caddy to pick up new routing rule
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose restart caddy"

# Start shared Studio (first time)
ssh ubuntu@148.113.1.164 "cd /opt/supastack/infra && sudo docker compose up -d studio"
```

## Verifying Correct Operation

1. Navigate to `https://<apex>/` — Studio project list should appear
2. Click a project → `https://<apex>/project/<ref>/editor`
3. Run a SQL query — results should appear from the real project database
4. Navigate to `/project/<ref>/auth/users` — user list should load
5. Navigate to `/setup` — Supastack setup wizard should still load (not Studio)

## Known Limitations (Phase 1)

- Studio runs as `next dev` — slower than production, not suitable for multi-user concurrency
- Phase 2 will replace with `next build` + standalone image
