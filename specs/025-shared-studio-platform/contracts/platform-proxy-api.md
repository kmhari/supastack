# Contract: Platform Proxy API

**Feature**: 025-shared-studio-platform | **Date**: 2026-06-01

These routes are added to Supastack's Fastify API (`apps/api`) and consumed by Supabase Studio running with `IS_PLATFORM=true`. All routes require a valid operator session (PAT or JWT).

## Authentication

All proxy routes require the `Authorization: Bearer <token>` header. Unauthenticated requests return:

```json
HTTP 401
{ "error": "Unauthorized" }
```

## Error Responses

| Condition | Status | Body |
|---|---|---|
| `ref` not found in `port_allocations` | 404 | `{ "error": "Project not found" }` |
| Instance is PAUSED | 503 | `{ "error": "Project is paused" }` |
| Upstream Kong unreachable | 502 | `{ "error": "Upstream unavailable" }` |

## Route Groups

### pg-meta Proxy

```
ANY /platform/pg-meta/:ref/*
```

Forwards to `http://localhost:<portKong>/pg-meta/v0/*` with:
- `x-connection-encrypted` header **stripped** (pg-meta connects via its own DB URL)
- All query parameters forwarded as-is
- Request body forwarded as-is
- Upstream `access-control-*` headers **stripped** (Fastify CORS plugin handles them)

Example:
```
GET /platform/pg-meta/abc123/tables?limit=10
→ GET http://localhost:54321/pg-meta/v0/tables?limit=10
```

### Storage Proxy

```
ANY /platform/storage/:ref/*
```

Forwards to `http://localhost:<portKong>/storage/v1/*`. Full REST passthrough including multipart uploads and streaming downloads.

Example:
```
GET /platform/storage/abc123/buckets
→ GET http://localhost:54321/storage/v1/buckets
```

### Auth Admin Proxy

```
ANY /platform/auth/:ref/users*
POST /platform/auth/:ref/invite
POST /platform/auth/:ref/magiclink
POST /platform/auth/:ref/otp
POST /platform/auth/:ref/recover
```

| Studio path | Kong upstream |
|---|---|
| `/platform/auth/:ref/users` | `/auth/v1/admin/users` |
| `/platform/auth/:ref/users/:id` | `/auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id/factors` | `/auth/v1/admin/users/:id/factors` |
| `/platform/auth/:ref/invite` | `/auth/v1/admin/users` (POST with type=invite) |
| `/platform/auth/:ref/magiclink` | `/auth/v1/admin/generate_link` |
| `/platform/auth/:ref/otp` | `/auth/v1/admin/generate_link` |
| `/platform/auth/:ref/recover` | `/auth/v1/admin/generate_link` |

Kong adds the `apikey` header for GoTrue auth — the proxy forwards the operator's `Authorization` header through.

### Analytics Proxy

```
ANY /platform/projects/:ref/analytics/*
```

Forwards to `http://localhost:<portKong>/analytics/v1/*`.

Example:
```
GET /platform/projects/abc123/analytics/endpoints/logs.all
→ GET http://localhost:54321/analytics/v1/endpoints/logs.all
```

## Headers Forwarded

- `Authorization` — forwarded as-is
- `Content-Type` — forwarded as-is
- `Accept` — forwarded as-is
- All custom `x-*` headers **except** `x-connection-encrypted` — stripped

## Headers Stripped from Upstream Response

- `access-control-allow-origin`
- `access-control-allow-credentials`
- `access-control-allow-methods`
- `access-control-allow-headers`
- `access-control-max-age`

(Fastify's CORS plugin on the Supastack API manages these for the browser.)
