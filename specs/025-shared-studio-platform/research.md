# Research: Shared Studio Platform

**Feature**: 025-shared-studio-platform | **Date**: 2026-06-01

## Decision 1: HTTP Proxy Mechanism in Fastify

**Decision**: Use `@fastify/reply-from` if already present; otherwise use raw `undici.request` + pipe.

**Rationale**: `@fastify/reply-from` is the official Fastify proxy plugin — handles streaming, trailers, and header manipulation idiomatically. `undici` is already a transitive dep of Node.js 18+. Either avoids adding a new package if one is already present.

**Alternatives considered**:
- `http-proxy-middleware` (Express-style) — not idiomatic with Fastify's reply lifecycle
- `node-fetch` — no streaming pipeline, buffers entire response in memory (bad for large `pg_dump` or Storage downloads)
- Custom `http.request` — more code, same result as undici

**Action**: Check `apps/api/package.json` for `@fastify/reply-from` before choosing approach.

---

## Decision 2: Studio Image Strategy

**Decision**: Phase 1 — mount the vanilla Studio checkout inside a `node:20-alpine` container running `next dev`. Phase 2 — purpose-built standalone Next.js image.

**Rationale**: `next dev` eliminates the need to bake `NEXT_PUBLIC_*` env vars at build time (Next.js only bakes them during `next build`). In dev mode, env vars are read at server start — the container can be started with the correct `NEXT_PUBLIC_API_URL` via `environment:` in compose. Phase 1 ships faster with no Docker build pipeline.

**Alternatives considered**:
- Custom `Dockerfile` with `next build` — requires rebuilding whenever `NEXT_PUBLIC_API_URL` changes (e.g., apex domain changes); operationally heavy for Phase 1
- Upstream `supabase/studio` Docker image — baked with Supabase Cloud URLs, not configurable without source access

**Risk**: `next dev` is single-threaded and slower than production. Acceptable for Phase 1 (single-operator platform). Phase 2 must use `next build` + `next start` in standalone mode.

---

## Decision 3: Studio URL Scheme

**Decision**: Serve Studio at the apex root `https://<apex>/`. No subdomain. No path prefix.

**Rationale**: Wildcard cert already covers the apex. Caddy routes `/api/v1/*` and `/setup*` by specificity before the catch-all `/*`. No DNS change needed. Studio's own internal links (e.g., `/project/<ref>/...`) work without any base path rewrite.

**Alternatives considered**:
- `studio.<apex>` subdomain — requires explicit Caddyfile entry; slightly cleaner isolation but unnecessary complexity
- `<apex>/studio/*` path prefix — would require Next.js `basePath` config, which IS a Studio source change (rejected)

---

## Decision 4: Studio Authentication Flow

**Decision**: Reuse the existing Supastack platform auth (GoTrue + PAT session from feature 011).

**Rationale**: Studio in `IS_PLATFORM=true` mode calls `NEXT_PUBLIC_GOTRUE_URL` for its own sign-in, which we point at the Supastack API. The Supastack API already has a full GoTrue-compatible auth surface (feature 011 device-code login, PAT minting). No new auth system needed.

**Alternatives considered**:
- Inject-session (browser console hack) — dev-only workaround, not suitable for production
- Separate GoTrue instance for Studio — unnecessary duplication

---

## Decision 5: IS_PLATFORM=true Data Fetch Routing (Verified)

**Finding**: All Studio data fetching in `IS_PLATFORM=true` mode goes directly to `NEXT_PUBLIC_API_URL`. The Next.js server-side API routes at `/pages/api/platform/...` are only reached when `IS_PLATFORM=false` (self-hosted/CLI mode where `API_URL = /api`).

**Evidence**:
- `apps/studio/data/fetchers.ts`: `baseUrl: API_URL.replace('/platform', '')` where `API_URL = NEXT_PUBLIC_API_URL` in platform mode
- `apps/studio/lib/constants/index.ts`: `API_URL = IS_PLATFORM ? NEXT_PUBLIC_API_URL : /api`
- All `data/storage/*.ts`, `data/auth/*.ts`, `data/database/*.ts` call `get('/platform/{resource}/{ref}/...')` via the openapi client

**Implication**: Zero Studio source changes needed. The Next.js API routes (`/pages/api/platform/[ref]/...`) that use hardcoded `STUDIO_PG_META_URL` / `SUPABASE_URL` are never called in platform mode.
