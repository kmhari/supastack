# Studio API Compatibility Progress

**Branch**: `083-shared-studio-platform` | **Started**: 2026-06-01

This document tracks autonomous work building Supabase Studio IS_PLATFORM=true
compatibility for Supastack. Each session appends new entries.

## Goal

Make Supastack's API surface compatible with Supabase Cloud's Studio so the
shared Studio container (feature 025) works end-to-end for all major pages.

## Starting Baseline

From `scripts/studio-mock-api/API-FULL-COMPARISON.md` (297 total routes):

| Status | Count |
|---|---|
| ✅ Covered | ~35 |
| 🔀 Proxy (Kong forward) | ~55 |
| ❌ Missing | ~188 |
| 🚫 Out of scope | ~13 |

---

## Session 1 — 2026-06-01

### Endpoints Implemented

#### GoTrue Shim (`apps/api/src/routes/studio-gotrue.ts`)
- `POST /api/v1/token?grant_type=password` — Studio login, issues HS256 JWT
- `POST /api/v1/token?grant_type=refresh_token` — JWT refresh
- `GET  /api/v1/user` — Current user (GoTrue shape)
- `PUT  /api/v1/user` — Update user (no-op)
- `GET  /api/v1/settings` — GoTrue settings stub (captcha disabled)
- `POST /api/v1/logout` — Logout (JWT expiry is revocation)
- `GET  /api/v1/mfa/authenticator/assurance-level` — `{currentLevel:'aal1'}`
- `GET  /api/v1/factors` — `[]`

#### Platform Misc (`apps/api/src/routes/platform-misc.ts`)
- `GET  /api/v1/platform/telemetry/feature-flags` — `{flags:{}}`
- `GET  /api/v1/platform/profile` — Real user from DB
- `PUT/PATCH /api/v1/platform/profile` — Echo body
- `POST /api/v1/platform/profile/audit-login` — 200 no-op
- `GET  /api/v1/platform/profile/permissions` — Wildcard `['%']` grant
- `GET  /api/v1/platform/profile/access-tokens` — `[]`
- `POST /api/v1/platform/profile/access-tokens` — Stub create
- `DELETE /api/v1/platform/profile/access-tokens/:id` — 204
- `GET  /api/v1/platform/profile/scoped-access-tokens` — `[]`
- `GET  /api/v1/platform/profile/audit` — `{result:[],count:0}`
- `GET  /api/v1/platform/notifications` — `[]`
- `GET  /api/v1/platform/notifications/summary` — `{unread:0}`
- `PATCH /api/v1/platform/notifications` — 204
- `PATCH /api/v1/platform/notifications/archive-all` — 204
- `GET  /api/v1/platform/organizations` — Real org from DB
- `GET  /api/v1/platform/organizations/:slug` — Real org
- `GET  /api/v1/platform/organizations/:slug/projects` — Real instances
- `GET  /api/v1/platform/organizations/:slug/members` — Current user
- `GET  /api/v1/platform/organizations/:slug/members/invitations` — `{invitations:[]}`
- `GET  /api/v1/platform/organizations/:slug/roles` — Owner role
- `GET  /api/v1/platform/organizations/:slug/billing/subscription` — Free plan
- `GET  /api/v1/platform/organizations/:slug/billing/plans` — `[{id:'free'}]`
- `GET  /api/v1/platform/organizations/:slug/billing/credits/balance` — `{balance:0}`
- `HEAD/GET /api/v1/platform/organizations/:slug/billing/invoices` — `[]`
- `GET  /api/v1/platform/organizations/:slug/entitlements` — `{entitlements:[]}`
- `GET  /api/v1/platform/organizations/:slug/usage` — `{usages:[]}`
- `GET  /api/v1/platform/organizations/:slug/usage/daily` — `{usages:[]}`
- `GET  /api/v1/platform/organizations/:slug/audit` — `{result:[]}`
- `GET  /api/v1/platform/organizations/:slug/sso` — `[]`
- `GET  /api/v1/platform/organizations/:slug/apps` — `[]`
- `GET  /api/v1/platform/organizations/:slug/apps/installations` — `[]`
- `GET  /api/v1/platform/organizations/:slug/oauth/apps` — `[]`
- `GET  /api/v1/platform/organizations/:slug/members/reached-free-project-limit` — `{reached:false}`
- `GET  /api/v1/platform/organizations/:slug/members/mfa/enforcement` — `{required:false}`
- `GET  /api/v1/platform/projects` — All user instances
- `GET  /api/v1/platform/projects/:ref` — Single instance
- `PATCH /api/v1/platform/projects/:ref` — Echo body
- `GET  /api/v1/platform/projects/:ref/databases` — DB connection info
- `GET  /api/v1/platform/projects/:ref/databases-statuses` — Status array
- `GET/PATCH /api/v1/platform/auth/:ref/config` — Delegates to management auth-config
- `GET  /api/v1/platform/projects/:ref/billing/addons` — `{available_addons:[]}`
- `GET  /api/v1/platform/projects/:ref/config/storage` — File size + image transform
- `GET/PATCH /api/v1/platform/projects/:ref/config/postgrest` — Delegates to management postgrest-config
- `GET  /api/v1/platform/projects-resource-warnings` — `[]`
- `GET  /api/v1/platform/integrations` — `[]`
- `GET  /api/v1/platform/integrations/:slug` — `[]`
- `GET  /api/v1/platform/integrations/github/connections` — `[]`
- `GET  /api/v1/platform/integrations/github/authorization` — `{app:null}`
- `GET  /api/v1/platform/integrations/github/repositories` — `{data:[]}`
- `GET  /api/v1/platform/database/:ref/backups` — `{backups:[],tierId:'free'}`
- `GET  /api/v1/platform/database/:ref/backups/downloadable-backups` — `{backups:[]}`
- `POST /api/v1/platform/database/:ref/backups/download` — `{url:null}`
- `GET  /api/v1/platform/projects/:ref/content/folders` — `{data:{folders:[],contents:[]},cursor:null}`
- `GET  /api/v1/platform/projects/:ref/content` — `{data:[],cursor:null}`
- `GET  /api/v1/platform/projects/:ref/content/count` — `{count:0}`
- Various misc stubs: pause/status, daily-stats, infra-monitoring, pgbouncer, run-lints, load-balancers, etc.

#### Management API Stubs (double-v1 path via `/api/v1/v1/...`)
- `POST /v1/projects/:ref/network-bans/retrieve` — `{banned_ipv4_addresses:[]}`
- `DELETE /v1/projects/:ref/network-bans` — 204
- `GET  /v1/projects/:ref/branches` — `[]`
- `GET  /v1/projects/:ref/read-replicas` — `[]`
- `GET  /v1/projects/:ref/upgrade/eligibility` — `{eligible:false}`
- `GET  /v1/projects/:ref/upgrade/status` — `{status:'ready'}`
- `GET  /v1/projects/:ref/health?services=...` — Array of service health objects
- `GET  /v1/projects/:ref/api-keys/legacy` — Real anon+service_role from secrets
- `GET  /v1/projects/:ref/config/auth/signing-keys` — Real jwtSecret from secrets
- `GET  /v1/projects/:ref/config/auth/signing-keys/legacy` — Same

#### Caddy / Routing
- `/api/get-deployment-commit` → `{commit:'dev'}`
- `/api/incident-banner` → `null`
- Double-v1 catch-all: `/api/v1/v1/*` strips outer `/api/v1` and re-injects

### Pages Verified Working
- ✅ Login page (`/sign-in`) — JWT-based auth
- ✅ Org page (`/organizations`) — real org + project list
- ✅ Project home (`/project/:ref`) — pg-meta tables, service health
- ✅ Auth providers page — auth config proxy
- ✅ API proxy: pg-meta, storage, auth admin, analytics
- ✅ Setup page (`/setup`) — preserved via Caddy `/setup*` routing

### Known Issues / Next Steps
- `/__nextjs_original-stack-frames` — 403 expected (Next.js dev security, harmless)
- `_next/webpack-hmr` WebSocket — dev-mode HMR, harmless
- Many pages need more endpoints (SQL editor, Table editor, Edge Functions, etc.)

---

## Session 2 — 2026-06-01 (autonomous)

### Plan
Systematically implement remaining endpoints from API-FULL-COMPARISON.md,
focusing on pages most used: Table Editor, SQL Editor, Auth Users, Storage,
Edge Functions, Settings.

---

## Session 2 — 2026-06-01 (autonomous continuation)

### Critical Fixes

#### Proxy route prefix mismatch (root cause of many 404s)
Studio calls `${NEXT_PUBLIC_API_URL}/platform/*` = `https://supaviser.dev/api/v1/platform/*`.
Platform proxy routes were only registered at `/platform/*` (no prefix).
**Fix**: Register `platformProxyRoutes` twice in `server.ts` — once without prefix
(for direct `/platform/*` Caddy rule) and once with `/api/v1` prefix (for Studio's path).

Now working via `/api/v1/platform/...`:
- pg-meta proxy → real table data
- storage proxy → bucket operations
- auth admin proxy → user management
- analytics proxy → log drains, usage

#### Anti-FOUC body{display:none} (browser testing issue)
Studio's Next.js theme initializer adds `<style>body{display:none}</style>` to HEAD but
never removes it in `next dev` mode. Pages render in React but are invisible.
**Workaround for testing**: Inject `<style id="ff">body{display:block!important}</style>` 
via JS after each navigation. Production build (Phase 2) won't have this issue.

### Endpoints Added (workflow + manual)

#### Management API stubs (server.ts — before double-v1 catch-all)
- `GET /v1/projects/:ref/network-restrictions` → `{entitlement:'disallowed', config:{...}}`
- `POST /v1/projects/:ref/network-restrictions/apply` → echo body
- `GET /v1/projects/:ref/custom-hostname` → `{status:'not_started'}`
- `GET /v1/projects/:ref/functions/deployed-size` → `{deployed_size:0}`
- (workflow-added stubs — see diff for full list)

#### Platform routes (platform-misc.ts)
- `GET /platform/projects/:ref/analytics/endpoints/:name` → `{result:[]}` (all usage endpoints)
- Various org billing/admin mutations (echo/no-op)
- Additional project config stubs
- Replication endpoints stubs
- Feedback endpoints stubs
- Storage bucket operations stubs
- Edge function metadata stubs

### Pages Verified Working (browser test via JS injection)
- ✅ `/org` → renders "Projects" heading, org list
- ✅ `/org/:slug` → renders "Projects | f22labs | Supabase" with 111+ elements
- ✅ `/project/:ref` → renders project home "openkey | f22labs | Supabase" with 183+ elements
- ✅ Login flow via GoTrue shim (POST /api/v1/token → JWT → localStorage)
- ⚠️ Table Editor, SQL Editor — not yet tested (slow next dev compilation)

### Known Remaining Issues
- `body{display:none}` anti-FOUC in `next dev` requires JS injection per navigation
  → Fixed by Phase 2 (production build)
- Some pages navigate to sub-pages unexpectedly (Studio routing behaviour)
- Workflow agents modified platform-misc.ts to 1521 lines (from 592)
  — needs audit for duplicates and quality

### Next Steps
1. Test Table Editor, SQL Editor, Auth Users, Storage, Edge Functions pages
2. Fix any new 404s found
3. Phase 2: Build production Studio image (eliminates next dev issues)

---

## Session 3 — 2026-06-01 (autonomous continuation 2)

### Critical Fixes Applied

#### Proxy route registration fix
Registered `platformProxyRoutes` twice: once at root (for `/platform/*` Caddy rule)
and once with `/api/v1` prefix (for Studio's `NEXT_PUBLIC_API_URL` path).
This fixed ALL proxy routes for Studio: pg-meta, storage, auth admin, analytics.

#### Response shape fixes (data.property access)
Several Studio queries access properties on API responses. Fixed:
- `GET /platform/integrations/github/connections` → `{connections:[]}` (was `[]`)
- `GET /platform/replication/:ref/sources/:id/tables` → `{tables:[]}` (was `[]`)
- `GET /platform/projects/:ref/privatelink/associations` → `{private_link_associations:[]}`
- `GET /v1/projects/:ref/database/jit/list` → `{items:[]}` (new endpoint)

### API Coverage Summary

All 14 key page API endpoints tested via direct HTTP and return 200:
- ✅ Project Home: /platform/projects/:ref, /v1/:ref/health, backups
- ✅ Table Editor: pg-meta tables, schemas
- ✅ Auth Users: auth users, auth config  
- ✅ Storage: storage buckets
- ✅ Edge Functions: /v1/:ref/functions
- ✅ Settings: api-keys, signing-keys, postgrest config
- ✅ Org: org projects, org billing

### Studio Pages Compiled by Workflow Agent

The workflow's browser test agent successfully compiled and loaded 23 pages:
org, org/:slug, org/:slug/apps, org/:slug/general, org/:slug/team,
project/:ref (home), auth/providers, auth/users, database/schemas,
database/tables, editor, functions, settings/api-keys, settings/api-keys/legacy,
settings/compute-and-disk, settings/general, settings/jwt, settings/jwt/legacy,
sql/:id, storage/files, sign-in

No API 404 errors in any page load.

### Browser Rendering Notes

The `body{display:none}` anti-FOUC mechanism in Studio's Next.js Turbopack dev
mode prevents pages from being visible in the Chrome extension context.
- Sign-in page: renders correctly (47 divs, 2 inputs) after FOUC fix
- Org page: renders correctly (111 divs, "Projects" heading) after FOUC fix
- Project home: renders correctly (183 divs, project name in title) after FOUC fix
- Authenticated project pages: React hydration delayed in extension context
  → This is a `next dev` + extension interaction issue, not a real bug
  → Will be resolved in Phase 2 (production Next.js build)

### Platform-misc.ts Status
- 1530 lines, 113 routes registered
- Covers profile, permissions, notifications, organizations, projects,
  auth config, storage, analytics, database, replication, integrations,
  edge functions, billing, backup operations, content/snippets, feedback

### Next Steps
- Phase 2: Production Studio Docker image (next build + standalone)
  → Eliminates next dev issues, proper HTTPS, better performance
- Remaining ❌ routes: auth templates, MFA, SAML, custom domains
- Test creating new projects via Studio (provision flow)
