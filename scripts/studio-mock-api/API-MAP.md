# Studio IS_PLATFORM=true — API Surface Map

## Architecture

```
Browser → Studio (port 3000)
  └── Client-side fetch → Mock API (port 4000)
        ├── Platform/Org/Billing  → Static mock responses
        ├── Project data          → Proxy to Kong (port 8000)
        │     ├── /auth/v1/       → GoTrue
        │     ├── /rest/v1/       → PostgREST
        │     ├── /pg-meta/v0/    → pg-meta
        │     └── /storage/v1/    → Storage
        └── /api/platform/*       → Handled by Studio's own Next.js SSR (not our mock)
```

One real project: ref=`localproject`, Kong at `http://148.113.1.164:8000`

---

## A) MOCK THESE (platform / org / billing — no real data)

### Global
| Endpoint | Response Shape | Status |
|---|---|---|
| `GET /platform/profile` | `{ id, gotrue_id, primary_email, first_name, last_name, username, free_project_limit, ... }` | ✅ |
| `PUT/PATCH /platform/profile` | echo body | ✅ |
| `GET /platform/profile/permissions` | `[]` | ✅ |
| `GET /platform/profile/access-tokens` | `[]` | ✅ |
| `POST /platform/profile/access-tokens` | `{ id, name, token, created_at }` | ✅ |
| `DELETE /platform/profile/access-tokens/:id` | 204 | ✅ |
| `GET /platform/profile/scoped-access-tokens` | `[]` | ✅ |
| `GET /platform/profile/audit` | `{ result: [], count: 0 }` | ✅ |
| `GET /platform/notifications` | `[]` | ✅ |
| `PATCH /platform/notifications` | 204 | ✅ |
| `GET /platform/stripe/invoices/overdue` | `[]` | ✅ |
| `GET /platform/telemetry/feature-flags` | `{ flags: {} }` | ✅ |
| `GET /platform/projects-resource-warnings` | `[]` | ✅ |
| `GET /platform/deployment-mode` | `{ mode: "self_hosted" }` | ✅ |

### Organizations
| Endpoint | Response Shape | Status |
|---|---|---|
| `GET /platform/organizations` | `[ OrgResponse ]` | ✅ |
| `GET /platform/organizations/:slug` | `OrgResponse` | ✅ |
| `GET /platform/organizations/:slug/members` | `[ MemberResponse ]` | ✅ |
| `GET /platform/organizations/:slug/roles` | `{ org_scoped_roles: [], project_scoped_roles: [] }` | ✅ |
| `GET /platform/organizations/:slug/billing/subscription` | `{ plan: { id: "free" }, billing_via_partner: false }` | ✅ |
| `GET /platform/organizations/:slug/billing/plans` | `[ { id: "free", name: "Free" } ]` | ✅ |
| `GET /platform/organizations/:slug/billing/credits/balance` | `{ balance: 0 }` | ✅ |
| `GET /platform/organizations/:slug/entitlements` | `{ entitlements: [] }` | ✅ fixed |
| `GET /platform/organizations/:slug/usage` | `{ usage_billing_enabled: false, usages: [] }` | ✅ |
| `GET /platform/organizations/:slug/usage/daily` | `{ periods: [] }` | ✅ |
| `GET /platform/organizations/:slug/projects` | `{ pagination: { count, limit, offset }, projects: [] }` | ✅ fixed |
| `GET /platform/organizations/:slug/sso` | `[]` | ✅ |
| `GET /platform/organizations/:slug/apps` | `[]` | ✅ |
| `GET /platform/organizations/:slug/apps/installations` | `[]` | ✅ |
| `GET /platform/organizations/:slug/oauth/apps` | `[]` | ✅ |
| `GET /platform/organizations/:slug/members/mfa/enforcement` | `{ required: false }` | ✅ |
| `GET /platform/organizations/:slug/audit` | `{ result: [], count: 0 }` | ✅ |

### Projects (platform metadata — NOT data)
| Endpoint | Response Shape | Status |
|---|---|---|
| `GET /platform/projects` | `{ pagination: { count, limit, offset }, projects: [] }` | ✅ fixed |
| `GET /platform/projects/:ref` | `ProjectResponse` (includes `databases: [{ identifier, status, type }]`) | ✅ fixed |
| `PATCH /platform/projects/:ref` | echo mock | ✅ |
| `GET /platform/projects/:ref/settings` | `{ jwt_secret, anon_key, service_role_key }` | ✅ |
| `GET /platform/projects/:ref/databases` | `[ { cloud_provider, db_host, db_port, status } ]` | ✅ |
| `GET /platform/projects/:ref/billing/addons` | `{ available_addons: [], selected_addons: [] }` | ✅ fixed |
| `GET /platform/projects/:ref/api` | `{ autoApiService: { endpoint, defaultApiKey, serviceApiKey } }` | ✅ |
| `GET /platform/projects/:ref/api/rest` | `{ endpoint, schema, extraSearchPath, maxRows }` | ✅ |
| `GET /platform/projects/:ref/config/postgrest` | `{ db_schema, max_rows, db_pool, jwt_secret }` | ✅ |
| `GET /platform/projects/:ref/config/storage` | `{ fileSizeLimit, features: { imageTransformation: { enabled } } }` | ✅ |
| `GET /platform/projects/:ref/config/pgbouncer` | `{ pool_mode, default_pool_size }` | ✅ |
| `GET /platform/projects/:ref/config/pgbouncer/status` | `{ active: true }` | ✅ |
| `GET /platform/projects/:ref/config/secrets/update-status` | `{ updating: false }` | ✅ |
| `GET /platform/projects/:ref/members` | `{ members: [] }` | ✅ |
| `GET /platform/projects/:ref/content` | `{ data: [], cursor: null }` | ✅ |
| `GET /platform/projects/:ref/content/count` | `{ count: 0 }` | ✅ |
| `GET /platform/projects/:ref/content/folders` | `{ data: [] }` | ✅ |
| `GET /platform/projects/:ref/pause/status` | `{ status: "not_pausing" }` | ✅ |
| `GET /platform/projects/:ref/restore/versions` | `[]` | ✅ |
| `GET /platform/projects/:ref/privatelink/associations` | `{ associations: [] }` | ✅ |
| `GET /platform/projects/:ref/daily-stats` | `{ data: [] }` | ✅ |
| `GET /platform/projects/:ref/infra-monitoring` | `{ data: [] }` | ✅ |
| `GET /platform/projects/:ref/notifications/advisor/exceptions` | `{ result: [] }` | ✅ |
| `GET /platform/projects/:ref/run-lints` | `{ lint_results: [] }` | ❌ unhandled |
| `GET /platform/projects/:ref/analytics/endpoints/service-health` | `{ services: [] }` | ✅ |

### Integrations
| Endpoint | Response Shape | Status |
|---|---|---|
| `GET /platform/integrations` | `[]` | ✅ |
| `GET /platform/integrations/:slug` | `[]` (org-specific integration list) | ✅ fixed |
| `GET /platform/integrations/github/authorization` | `{ app: null }` | ✅ |
| `GET /platform/integrations/github/connections` | `[]` | ✅ |
| `GET /platform/integrations/github/repositories` | `{ data: [] }` | ✅ |

### V1 endpoints (project resource metadata)
| Endpoint | Response Shape | Status |
|---|---|---|
| `POST /v1/projects/:ref/network-bans/retrieve` | `{ banned_ipv4_addresses: [] }` | ✅ |
| `GET /v1/projects/:ref/branches` | `[]` | ❌ unhandled |
| `GET /v1/projects/:ref/custom-hostname` | `{ status: "not_started", customHostname: null }` | ❌ missing |
| `GET /v1/projects/:ref/network-restrictions` | `{ entitlement: "disallowed", config: { dbAllowedCidrs: [] } }` | ❌ missing |
| `GET /v1/projects/:ref/upgrade/eligibility` | `{ eligible: false, current_app_version: "..." }` | ❌ missing |

---

## B) PROXY TO KONG (real project data)

Kong base URL: `http://148.113.1.164:8000` (or docker bridge IP)

### Auth config (GoTrue admin — needs service_role JWT)
| Mock path | Kong path | Notes |
|---|---|---|
| `GET/PATCH /platform/auth/:ref/config` | `GET/PATCH /auth/v1/settings` | service key required |
| `POST /platform/auth/:ref/invite` | `POST /auth/v1/invite` | SSR only |
| `POST /platform/auth/:ref/magiclink` | `POST /auth/v1/magiclink` | SSR only |

### Database introspection (pg-meta)
| Mock path | Kong path |
|---|---|
| `GET /platform/pg-meta/:ref/tables` | `GET /pg-meta/v0/tables` |
| `GET /platform/pg-meta/:ref/views` | `GET /pg-meta/v0/views` |
| `GET /platform/pg-meta/:ref/columns` | `GET /pg-meta/v0/columns` |
| `GET /platform/pg-meta/:ref/schemas` | `GET /pg-meta/v0/schemas` |
| `GET /platform/pg-meta/:ref/policies` | `GET /pg-meta/v0/policies` |
| `GET /platform/pg-meta/:ref/functions` | `GET /pg-meta/v0/functions` |
| `GET /platform/pg-meta/:ref/types` | `GET /pg-meta/v0/types` |
| `GET /platform/pg-meta/:ref/publications` | `GET /pg-meta/v0/publications` |
| `POST /platform/pg-meta/:ref/query` | `POST /pg-meta/v0/query` |

### Storage
| Mock path | Kong path |
|---|---|
| `GET /platform/storage/:ref/buckets` | `GET /storage/v1/bucket` |
| `GET /platform/storage/:ref/buckets/:id` | `GET /storage/v1/bucket/:id` |

---

## C) STUDIO SSR ROUTES (NOT our mock — handled internally)

These are Next.js API routes at `/pages/api/platform/` inside Studio itself.
Studio's Node.js process handles these server-side before they ever reach our mock.

Key ones that Studio implements internally:
- `/api/platform/auth/:ref/users` — proxies to GoTrue with `SUPABASE_SERVICE_KEY`
- `/api/platform/pg-meta/:ref/*` — proxies to `STUDIO_PG_META_URL`
- `/api/platform/storage/:ref/*` — proxies using `STORAGE_BACKEND_URL` (not set yet)

These SSR routes use runtime env vars (not build-time), set in docker-compose:
```yaml
STUDIO_PG_META_URL: http://meta:8080    # ← already works in vanilla stack
POSTGRES_HOST / PORT / DB / PASSWORD    # ← already set
```

---

## What's Missing / Needs Adding to Mock

```
GET /platform/projects/:ref/run-lints         → { lint_results: [] }
GET /v1/projects/:ref/branches                → []
GET /v1/projects/:ref/custom-hostname         → { status: "not_started", customHostname: null }
GET /v1/projects/:ref/network-restrictions    → { entitlement: "disallowed", config: { dbAllowedCidrs: [] } }
GET /v1/projects/:ref/upgrade/eligibility     → { eligible: false, current_app_version: "15.0.0.55" }
GET /v1/projects/:ref/api-keys               → [] (or [ { name: "anon", type: "anon", key: ANON_KEY }, ... ])
GET /v1/projects/:ref/secrets                → []
GET /platform/replication/:ref/sources       → []  (already has it)
GET /platform/replication/:ref/destinations  → []  (already has it)
GET /platform/replication/:ref/pipelines     → []  (already has it)
```

---

## Session injection snippet (for browser console)

```js
// Run in browser console before navigating to any Studio page
(function injectSession() {
  const now = Math.floor(Date.now() / 1000), exp = now + 7200
  function b64(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g,'-').replace(/\//g,'_').replace(/=/g,'') }
  const jwt = `${b64(JSON.stringify({alg:'HS256',typ:'JWT'}))}.${b64(JSON.stringify({aud:'authenticated',exp,iat:now,iss:'http://148.113.1.164:4000/',sub:'00000000-0000-0000-0000-000000000001',email:'admin@localhost',role:'authenticated',aal:'aal1',app_metadata:{provider:'email',providers:['email']},user_metadata:{},amr:[{method:'password',timestamp:now}],session_id:'s1'}))}.fakesig`
  localStorage.setItem('supabase.dashboard.auth.token', JSON.stringify({
    access_token: jwt, token_type: 'bearer', expires_in: 7200, expires_at: exp,
    refresh_token: 'mock-' + now,
    user: { id: '00000000-0000-0000-0000-000000000001', aud: 'authenticated', role: 'authenticated',
      email: 'admin@localhost', email_confirmed_at: '2024-01-01T00:00:00Z',
      confirmed_at: '2024-01-01T00:00:00Z', last_sign_in_at: new Date().toISOString(),
      app_metadata: {provider:'email',providers:['email']}, user_metadata: {}, identities: [],
      created_at: '2024-01-01T00:00:00Z', updated_at: new Date().toISOString() }
  }))
  console.log('Session injected, valid for 2h')
})()
```
