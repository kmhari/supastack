# Implementation Plan: OAuth Authorize Flow

**Branch**: `115-oauth-authorize-flow` | **Date**: 2026-06-08 | **Spec**: [spec.md](spec.md)

## Summary

Replace the current inline-HTML OAuth consent form with a proper server-side session redirect that feeds the Supabase Studio's existing consent page. The Studio already ships `/dashboard/authorize` (at `pages/authorize.tsx`) and calls three platform API endpoints to drive the consent flow. Supastack must implement those endpoints and change `GET /v1/oauth/authorize` to store OAuth params in Redis and redirect to `https://<apex>/dashboard/authorize?auth_id=<UUID>` instead of rendering HTML inline.

**Frontend**: zero changes — Studio already has the consent page.
**Backend**: 4 changed/new API endpoints + 1 new service + 2 new RBAC actions.

## Technical Context

**Language/Version**: TypeScript 5.x / Node 20 (existing codebase)

**Primary Dependencies**: Fastify (API), Drizzle + PostgreSQL (oauth_clients, oauth_codes), ioredis (auth session storage), `@supastack/db`, `@supastack/shared`

**Storage**: Redis (new `oauth:auth_session:<UUID>` key, TTL 600s) — no DB migrations needed

**Testing**: Vitest, existing `apps/api/tests/` pattern

**Target Platform**: Single-VM Docker Compose, `api` container (port 3001)

**Performance Goals**: Session creation < 10ms (Redis SET); GET/POST endpoints < 50ms p95

**Constraints**: `GETDEL` requires Redis 6.2+; project uses Redis 7 (satisfied). No DB migration means no downtime risk.

**Scale/Scope**: 2 new service functions, 3 new platform routes (GET/POST/DELETE), 1 modified OAuth authorize handler, 2 new RBAC actions

## Constitution Check

| Principle | Status | Notes |
|-----------|--------|-------|
| **I. Idempotent migrations** | ✅ PASS | No DB migrations. Redis sessions have TTL-based expiry, no cleanup needed. |
| **II. Secrets encrypted** | ✅ PASS | `code_challenge` is public; `state` is opaque; no secrets stored in the session blob. OAuth params are not secret. |
| **III. RBAC** | ✅ PASS | Two new actions added: `oauth.consent.read` + `oauth.consent.approve`. Both endpoints call `app.authorize()` or `app.authorizeOrg()`. |
| **IV. Supabase compat** | ✅ PASS | `GET /v1/oauth/authorize` stays at same path; `POST /v1/oauth/authorize` removal is a supastack-internal form (not a Supabase Cloud compat endpoint). New `/platform/*` routes match Studio's exact expected shapes (confirmed via HAR + Studio source). |
| **V. Worker owns per-instance state** | ✅ PASS | No per-instance work; consent is control-plane only. |
| **VI. Spec-driven delivery** | ✅ PASS | Spec, research, data-model, contracts all complete. |

## Project Structure

### Documentation (this feature)
```text
specs/115-oauth-authorize-flow/
├── plan.md              # This file
├── spec.md
├── research.md
├── data-model.md
├── quickstart.md
├── contracts/
│   └── oauth-authorize-endpoint.md
├── checklists/
│   └── requirements.md
└── tasks.md             # Created by /speckit-tasks
```

### Source Code Changes

```text
apps/api/src/
├── services/
│   └── oauth-auth-sessions-store.ts   # NEW — Redis auth session CRUD
├── routes/oauth/
│   └── authorize.ts                   # MODIFY — GET only, Redis session + 303 redirect; remove POST handler
└── routes/
    └── platform-misc.ts               # MODIFY — add GET/POST/DELETE /platform/oauth/authorizations/*

packages/shared/src/
└── rbac.ts                             # MODIFY — add oauth.consent.read + oauth.consent.approve

apps/api/tests/
├── unit/oauth-auth-sessions-store.test.ts   # NEW
└── contract/oauth-platform-consent.test.ts  # NEW
```

## Phase 0: Research — COMPLETE

See [research.md](research.md). All unknowns resolved:
- Redis for session storage (existing ioredis singleton)
- Studio already provides the consent page (no frontend work needed)
- API shapes confirmed from Studio source + HAR analysis

## Phase 1: Design — COMPLETE

See [data-model.md](data-model.md), [contracts/oauth-authorize-endpoint.md](contracts/oauth-authorize-endpoint.md), [quickstart.md](quickstart.md).

### New service: `oauth-auth-sessions-store.ts`

```ts
interface OAuthAuthSession {
  auth_id: string
  client_id: string
  client_name: string
  client_website: string
  client_icon: string | null
  client_domain: string
  redirect_uri: string
  state: string
  code_challenge: string
  code_challenge_method: 'S256'
  scopes: string[]
  created_at: string
  expires_at: string
}

createAuthSession(params: Omit<OAuthAuthSession, 'auth_id' | 'created_at' | 'expires_at'>): Promise<string>
// → auth_id UUID; SET oauth:auth_session:<uuid> <json> EX 600 NX

getAuthSession(auth_id: string): Promise<OAuthAuthSession | null>
// → GET oauth:auth_session:<uuid>; null if missing/expired

consumeAuthSession(auth_id: string): Promise<OAuthAuthSession | null>
// → GETDEL oauth:auth_session:<uuid>; null if already consumed
```

### Modified `authorize.ts`

- Remove `POST /v1/oauth/authorize` handler entirely
- `GET /v1/oauth/authorize`:
  1. Validate params (existing `validateParams()` — no change)
  2. Load client via `getClientById()`
  3. Validate `redirect_uri` via `validateRedirectUri()`
  4. Call `createAuthSession({...})` → `auth_id`
  5. `return reply.redirect(303, \`${apexBase}/dashboard/authorize?auth_id=${auth_id}\`)`
  6. Remove the unauthenticated-user check (Studio's `/dashboard/authorize` page handles its own auth guard via `withAuth()`)

### New platform routes in `platform-misc.ts`

**GET `/platform/oauth/authorizations/:id`**:
```ts
app.authorize(req, 'oauth.consent.read')
const session = await getAuthSession(req.params.id)
if (!session) throw new ManagementApiError(404, 'session not found', 'not_found')
return {
  name: session.client_name,
  website: session.client_website,
  icon: session.client_icon,
  domain: session.client_domain,
  scopes: session.scopes,
  expires_at: session.expires_at,
  approved_at: null,
  approved_organization_slug: null,
}
```

**POST `/platform/organizations/:slug/oauth/authorizations/:id`**:
```ts
await app.authorizeOrg(req, 'oauth.consent.approve', req.params.slug)
const session = await consumeAuthSession(req.params.id)
if (!session) throw new ManagementApiError(404, 'session not found or already used', 'not_found')
const { code } = await issueCode({ clientId: session.client_id, userId: req.user.id,
  redirectUri: session.redirect_uri, codeChallenge: session.code_challenge,
  scope: session.scopes.join(' ') })
void emitAudit(req.user.id, 'oauth.code.issued', { client_id: session.client_id, ... })
const sep = session.redirect_uri.includes('?') ? '&' : '?'
const callbackUrl = `${session.redirect_uri}${sep}code=${encodeURIComponent(code)}&state=${encodeURIComponent(session.state)}`
const skipRedirect = req.query['skip_browser_redirect'] === 'true'
if (skipRedirect) return reply.status(201).send({ url: callbackUrl })
return reply.redirect(302, callbackUrl)
```

**DELETE `/platform/organizations/:slug/oauth/authorizations/:id`**:
```ts
await app.authorizeOrg(req, 'oauth.consent.approve', req.params.slug)
const session = await consumeAuthSession(req.params.id)
if (!session) throw new ManagementApiError(404, 'session not found or already used', 'not_found')
void emitAudit(req.user.id, 'oauth.consent.denied', { client_id: session.client_id, ... })
return reply.send({ id: req.params.id })
```

### RBAC additions in `packages/shared/src/rbac.ts`

```ts
// Add to ACTIONS array:
'oauth.consent.read',
'oauth.consent.approve',

// Add to admin matrix (all admin roles can consent):
'oauth.consent.read': true (all roles),
'oauth.consent.approve': true (owner + administrator),
```

## Complexity Tracking

No constitution violations.
