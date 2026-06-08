# Research: OAuth Authorize Flow (Feature 115)

## Decision 1: Auth Session Storage Backend

**Decision**: Redis (ioredis, existing singleton via `getRedis()` in `apps/api/src/routes/oauth/clients-dashboard.ts`)

**Rationale**: The project already uses Redis for JWT revocation lists (feature 014), CLI device-login sessions (feature 011), and BullMQ. Adding a short-lived `oauth:auth_session:<auth_id>` key (TTL 600s) is zero-overhead: no migration, no new dependency, no added connection. DB-backed storage would require a new migration, a Drizzle schema, and cleanup jobs — all unnecessary for a 10-minute TTL token.

**Alternatives considered**:
- PostgreSQL table `oauth_auth_sessions` — clean audit trail but requires idempotent migration + TTL cleanup cron + extra round-trip. Over-engineered for ephemeral data.
- In-memory Map — would not survive api container restart during consent flow; single-node only.

**Redis key format**: `oauth:auth_session:<auth_id>` — JSON-encoded `OAuthAuthSession` (see data-model.md). `SET ... EX 600 NX` for idempotent creation; `DEL` for atomic consumption on approval/denial.

---

## Decision 2: Consent Page Location — Studio Already Has It

**Decision**: No new React page required. The upstream Supabase Studio already ships a full consent page at `apps/studio/pages/authorize.tsx`, which supastack serves at `https://<apex>/dashboard/authorize` (Studio uses `/dashboard` basePath in IS_PLATFORM mode). The page is fully self-contained: it calls `GET /platform/oauth/authorizations/{id}`, `POST /platform/organizations/{slug}/oauth/authorizations/{id}?skip_browser_redirect=true` (approve), and `DELETE /platform/organizations/{slug}/oauth/authorizations/{id}` (decline). These API endpoints are what supastack must implement.

**Studio components**:
- `pages/authorize.tsx` — route `/dashboard/authorize?auth_id=...`
- `components/interfaces/ApiAuthorization/ApiAuthorization.Valid.tsx` — main consent flow
- `data/api-authorization/api-authorization-query.ts` — `GET /platform/oauth/authorizations/{id}`
- `data/api-authorization/api-authorization-approve-mutation.ts` — `POST .../oauth/authorizations/{id}?skip_browser_redirect=true` → `{ url: string }`
- `data/api-authorization/api-authorization-decline-mutation.ts` — `DELETE .../oauth/authorizations/{id}` → `{ id: string }`

**No Caddy changes needed**: `/dashboard/*` already routes to the Studio catch-all. No apps/web changes needed.

**Alternatives considered**: Building a new React page in `apps/web` — unnecessary, adds maintenance burden, and would diverge from the upstream Studio component that's already maintained by the Supabase team.

---

## Decision 3: Consent API Shape — Match Studio's Exact Calls

**Decision**: Implement these three endpoints exactly as the Studio calls them:
1. `GET /platform/oauth/authorizations/:id` → `ApiAuthorizationResponse`
2. `POST /platform/organizations/:slug/oauth/authorizations/:id?skip_browser_redirect=true` → `{ url: string }` (callback redirect URL)
3. `DELETE /platform/organizations/:slug/oauth/authorizations/:id` → `{ id: string }`

**Response shape for GET** (exact fields Studio reads):
```ts
{
  name: string           // client_name from oauth_clients
  website: string        // from metadata.website or redirect_uris[0] domain
  icon: string | null    // from metadata.icon
  domain: string         // hostname of redirect_uris[0]
  scopes: OAuthScope[]   // scope string split on spaces
  expires_at: string     // ISO-8601
  approved_at: string | null
  approved_organization_slug?: string
}
```

**POST behavior**: With `?skip_browser_redirect=true`, the API issues the code and returns `{ url: '<redirect_uri>?code=<code>&state=<state>' }` rather than doing a 302. The Studio's approve mutation follows this URL via `window.location.href = res.url`. Without the flag, a 302 is still acceptable for non-Studio clients.

**Rationale**: The Studio's data layer is fixed upstream. The API must match exactly or the consent page breaks silently.

---

## Decision 4: RBAC for Consent Endpoints

**Decision**: New RBAC actions added to `packages/shared/src/rbac.ts`:
- `oauth.consent.read` — GET authorization details; any authenticated org member can read a pending authorization
- `oauth.consent.approve` — POST consent approval; requires org membership

For the GET, any authenticated user (regardless of org) can read a pending auth session they received (the `auth_id` is a UUID that acts as a capability token). For the POST, the user must be a member of the named org. Both are gated via `app.authorize(req, ...)` per Principle III.

**Alternatives considered**:
- No RBAC, just check `req.user` is set — violates Principle III which requires every privileged endpoint to use `app.authorize()`.

---

## Decision 5: Scope Display Map

**Decision**: Human-readable scope labels are owned by the **upstream Studio consent page** (`apps/studio/components/interfaces/ApiAuthorization/*`) — there is **no `apps/web` page** in this feature. The backend returns only the raw `scopes` string array on `GET /platform/oauth/authorizations/:id`; Studio maps each scope to a label. The reference map below documents the expected scopes for test fixtures only; it is not implemented in supastack code.

**Reference scope map** (Studio-owned rendering; documented for fixtures, based on HAR and MCP tool surface):
```
organizations:read  → "Read access to your organizations"
projects:read       → "Read access to all projects"
projects:write      → "Create and manage projects"
database:read       → "Read database schemas and data"
database:write      → "Execute SQL and apply migrations"
analytics:read      → "Read project logs and analytics"
secrets:read        → "Read project secrets"
edge_functions:read → "Read Edge Functions"
edge_functions:write → "Deploy and manage Edge Functions"
environment:read    → "Read environment configuration"
environment:write   → "Update environment configuration"
storage:read        → "Read Storage buckets and objects"
platform           → "Full platform access (all projects)"
```

---

## Decision 6: auth_id Replay / Expiry Handling

**Decision**: 
- Creation: `SET oauth:auth_session:<uuid> <json> EX 600 NX` — atomic, idempotent, 10-minute TTL
- Consumption: `GETDEL oauth:auth_session:<auth_id>` — atomic read+delete in Redis 6.2+; fallback: GET then DEL in a pipeline. If GET returns null → already consumed or expired → **404** (uniform; no `410`).
- Expiry on consent page: The Studio consent page loads `GET /platform/oauth/authorizations/:auth_id` on mount. If it returns 404, the page shows a session-expired error.

**Redis version**: The project uses `redis:7` (infra/docker-compose.yml uses `redis:7-alpine` or similar); `GETDEL` is available.
