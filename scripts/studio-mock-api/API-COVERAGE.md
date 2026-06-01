# API Coverage Map: Mock API vs Supastack Implementation

**Generated:** 2026-06-01
**Scope:** Cross-reference mock routes (server.js), Supastack Fastify routes (apps/api/src/routes/), and Studio API surface (API-MAP.md)

---

## Summary

| Status | Count | Notes |
|--------|-------|-------|
| ✅ **Implemented** | 42 | Native Fastify routes in Supastack |
| 🔧 **Mock Only** | 115+ | Hardcoded responses in express mock server |
| 🔀 **Proxied** | 12 | Routed to real services (GoTrue, pg-meta, storage) |
| 🚫 **Out of Scope** | 25+ | Billing, marketplace, SSO, enterprise features |

---

## Implementation Status by Category

### Auth & Session Management

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| POST | `/auth/login` | ✅ | Supastack native; password verification + session |
| POST | `/auth/logout` | ✅ | Supastack native; session destroy |
| GET | `/auth/me` | ✅ | Supastack native; current user |
| POST | `/auth/tokens` | ✅ | Supastack native; mint API token |
| GET | `/auth/tokens` | ✅ | Supastack native; list user tokens |
| DELETE | `/auth/tokens/:id` | ✅ | Supastack native; revoke token |
| POST | `/token` | 🔀 | GoTrue (OpenID Connect); proxied via Kong |
| GET | `/user` | 🔀 | GoTrue user endpoint; proxied via Kong |
| PUT | `/user` | 🔀 | GoTrue user update; proxied via Kong |
| POST | `/logout` | 🔀 | GoTrue logout; mocked locally |
| GET | `/settings` | 🔀 | GoTrue auth config; proxied to `/auth/v1/settings` |
| POST | `/signup` | 🔀 | GoTrace signup; mocked locally |
| POST | `/otp` | 🔀 | GoTrue magic link/OTP; mocked locally |

### Profile & Account

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/profile` | ✅ | Supastack native; current user profile |
| GET | `/platform/profile` | 🔧 | Mock only; hardcoded response |
| PUT/PATCH | `/platform/profile` | 🔧 | Mock only; echo body |
| GET | `/platform/profile/access-tokens` | 🔧 | Mock only; returns `[]` |
| POST | `/platform/profile/access-tokens` | 🔧 | Mock only; synthetic token |
| DELETE | `/platform/profile/access-tokens/:id` | 🔧 | Mock only; 204 |
| GET | `/platform/profile/permissions` | 🔧 | Mock only; wildcard grant |
| GET | `/platform/profile/scoped-access-tokens` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/profile/audit` | 🔧 | Mock only; returns empty |

### Organizations & Members

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/organizations` | ✅ | Supastack native; list user's orgs |
| GET | `/platform/organizations` | 🔧 | Mock only; returns single org |
| GET | `/platform/organizations/:slug` | 🔧 | Mock only; org details |
| GET | `/platform/organizations/:slug/members` | 🔧 | Mock only; org members |
| GET | `/platform/organizations/:slug/roles` | 🔧 | Mock only; org roles |
| POST | `/platform/organizations/:slug/members/invitations` | 🔧 | Mock only; 201 |
| GET | `/platform/organizations/:slug/members/invitations` | 🔧 | Mock only; returns `[]` |
| DELETE | `/platform/organizations/:slug/members/invitations/:id` | 🔧 | Mock only; 204 |
| PATCH | `/platform/organizations/:slug/members/:gotrue_id` | 🔧 | Mock only; echo body |
| DELETE | `/platform/organizations/:slug/members/:gotrue_id` | 🔧 | Mock only; 204 |
| POST | `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | 🔧 | Mock only; 200 |
| DELETE | `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | 🔧 | Mock only; 204 |
| GET | `/members` | ✅ | Supastack native; org members |
| POST | `/members/invites` | ✅ | Supastack native; create invite |
| GET | `/members/invites` | ✅ | Supastack native; list invites |
| DELETE | `/members/invites/:id` | ✅ | Supastack native; revoke invite |
| POST | `/members/invites/accept` | ✅ | Supastack native; accept invite |
| DELETE | `/members/:userId` | ✅ | Supastack native; remove member |

### Projects (Metadata)

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects` | ✅ | Supastack native; list projects |
| GET | `/v1/projects/:ref` | ✅ | Supastack native; get project by ref |
| GET | `/platform/projects` | 🔧 | Mock only; paginated list |
| GET | `/platform/projects/:ref` | 🔧 | Mock only; project details |
| PATCH | `/platform/projects/:ref` | 🔧 | Mock only; echo body |
| POST | `/instances` | ✅ | Supastack native; create instance |
| GET | `/instances` | ✅ | Supastack native; list instances |
| GET | `/instances/:ref` | ✅ | Supastack native; get instance |
| PATCH | `/instances/:ref` | ✅ | Supastack native; update instance |
| DELETE | `/instances/:ref` | ✅ | Supastack native; delete instance |
| GET | `/instances/:ref/health` | ✅ | Supastack native; health status |
| POST | `/instances/:ref/pause` | ✅ | Supastack native; pause instance |
| POST | `/instances/:ref/resume` | ✅ | Supastack native; resume instance |
| POST | `/instances/:ref/restart` | ✅ | Supastack native; restart services |
| POST | `/instances/:ref/restart-db` | ✅ | Supastack native; restart database |
| POST | `/instances/:ref/upgrade` | ✅ | Supastack native; upgrade instance |
| POST | `/projects/:ref/pause` | 🔧 | Mock only; pause project |
| POST | `/projects/:ref/restore` | 🔧 | Mock only; restore project |

### Configuration: Database & Auth

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/config/auth` | ✅ | Supastack native; GoTrue config snapshot |
| GET | `/v1/projects/:ref/config/auth/reveal` | ✅ | Supastack native; reveal plaintext secrets |
| PATCH | `/v1/projects/:ref/config/auth` | ✅ | Supastack native; update auth config |
| GET | `/v1/projects/:ref/postgrest` | ✅ | Supastack native; PostgREST config |
| PATCH | `/v1/projects/:ref/postgrest` | ✅ | Supastack native; update PostgREST |
| GET | `/v1/projects/:ref/config/database/postgres` | ✅ | Supastack native; postgres.conf snapshot |
| PUT/PATCH | `/v1/projects/:ref/config/database/postgres` | ✅ | Supastack native; update postgres.conf |
| GET | `/platform/projects/:ref/config/postgrest` | 🔧 | Mock only; postgrest config |
| PATCH | `/platform/projects/:ref/config/postgrest` | 🔧 | Mock only; echo body |
| GET | `/platform/projects/:ref/config/storage` | 🔧 | Mock only; storage limits |
| GET | `/platform/projects/:ref/config/pgbouncer` | 🔧 | Mock only; connection pooler config |
| GET | `/platform/projects/:ref/config/pgbouncer/status` | 🔧 | Mock only; pooler status |
| GET | `/platform/projects/:ref/config/secrets/update-status` | 🔧 | Mock only; secrets sync status |
| GET | `/platform/auth/:ref/config` | 🔀 | Proxied to GoTrue `/auth/v1/settings` |
| GET | `/platform/projects/:ref/settings` | 🔧 | Mock only; JWT secret + API keys |

### API Keys & Secrets

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/api-keys` | ✅ | Supastack native; anon + service_role JWTs |
| GET | `/v1/projects/:ref/secrets` | ✅ | Supastack native; environment secrets |
| POST | `/v1/projects/:ref/secrets` | ✅ | Supastack native; create secret |
| DELETE | `/v1/projects/:ref/secrets` | ✅ | Supastack native; delete secret |
| GET | `/platform/projects/:ref/api-keys/temporary` | 🔧 | Mock only; temporary JWTs |
| GET | `/v1/projects/:ref/api-keys` | 🔧 | Mock only; list anon + service_role |

### Functions (Edge Functions)

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/functions` | ✅ | Supastack native; list functions |
| PUT | `/v1/projects/:ref/functions` | ✅ | Supastack native; bulk update finalize |
| POST | `/v1/projects/:ref/functions/deploy` | ✅ | Supastack native; multipart deploy (--use-api) |
| POST | `/v1/projects/:ref/functions` | ✅ | Supastack native; create from eszip |
| PATCH | `/v1/projects/:ref/functions/:slug` | ✅ | Supastack native; update from eszip |
| GET | `/v1/projects/:ref/functions/:slug` | ✅ | Supastack native; function metadata |
| GET | `/v1/projects/:ref/functions/:slug/body` | ✅ | Supastack native; download function bundle |
| DELETE | `/v1/projects/:ref/functions/:slug` | ✅ | Supastack native; delete function |

### Database & Backups

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/platform/projects/:ref/databases` | 🔧 | Mock only; list databases |
| GET | `/v1/projects/:ref/database/backups` | ✅ | Supastack native; list backups |
| POST | `/v1/projects/:ref/database/backups` | ✅ | Supastack native; trigger backup |
| GET | `/v1/projects/:ref/database/backups/:id` | ✅ | Supastack native; backup details |
| GET | `/platform/database/:ref/backups` | 🔧 | Mock only; list backups |
| GET | `/platform/database/:ref/backups/downloadable-backups` | 🔧 | Mock only; downloadable list |
| POST | `/platform/database/:ref/backups/download` | 🔧 | Mock only; download URL |
| POST | `/platform/database/:ref/backups/restore` | 🔧 | Mock only; restore backup |
| POST | `/platform/database/:ref/backups/pitr` | 🔧 | Mock only; point-in-time restore |
| POST | `/platform/database/:ref/backups/enable-physical-backups` | 🔧 | Mock only; 200 |
| POST | `/platform/database/:ref/clone` | 🔧 | Mock only; clone database |

### Storage & Buckets

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/storage/buckets` | ✅ | Supastack native; reverse-proxy to storage |
| GET | `/platform/storage/:ref/buckets` | 🔀 | Proxied to storage container |
| GET | `/platform/storage/:ref/credentials` | 🔧 | Mock only; returns `[]` |
| POST | `/platform/storage/:ref/buckets/:id/empty` | 🔧 | Mock only; empty bucket |
| POST | `/platform/storage/:ref/buckets/:id/objects/list` | 🔧 | Mock only; list objects |
| POST | `/platform/storage/:ref/buckets/:id/objects/sign` | 🔧 | Mock only; signed URL |
| POST | `/platform/storage/:ref/credentials` | 🔧 | Mock only; create credential |
| DELETE | `/platform/storage/:ref/credentials/:id` | 🔧 | Mock only; delete credential |

### Analytics & Logs

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/analytics/endpoints/logs.all` | ✅ | Supastack native; proxies to Logflare |
| GET | `/platform/projects/:ref/analytics/endpoints/logs.all` | 🔧 | Mock only; returns empty |
| GET | `/platform/projects/:ref/analytics/endpoints/logs.all.otel` | 🔧 | Mock only; returns empty |
| GET | `/platform/projects/:ref/analytics/endpoints/auth.metrics` | 🔧 | Mock only; returns empty |
| GET | `/platform/projects/:ref/analytics/endpoints/functions.*` | 🔧 | Mock only; returns empty |
| GET | `/platform/projects/:ref/analytics/endpoints/usage.*` | 🔧 | Mock only; returns empty |
| GET | `/platform/projects/:ref/analytics/log-drains` | 🔧 | Mock only; returns `[]` |
| POST | `/platform/projects/:ref/analytics/log-drains` | 🔧 | Mock only; create drain |
| DELETE | `/platform/projects/:ref/analytics/log-drains/:token` | 🔧 | Mock only; delete drain |

### TypeScript Types Generation

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/types/typescript` | ✅ | Supastack native; generate TypeScript defs |

### Databases Migrations

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/v1/projects/:ref/database/migrations` | ✅ | Supastack native; list migrations |

### SSL/TLS

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/platform/projects/:ref/ssl-enforcement` | ✅ | Supastack native; SSL policy |

### Health & Status

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/health` | ✅ | Supastack native; API health check |
| GET | `/instances/:ref/health` | ✅ | Supastack native; project health |
| GET | `/api/v1/pooler/status` | ✅ | Supastack native; connection pooler |
| GET | `/v1/projects/:ref/health` | 🔧 | Mock only; service health |

### Setup & Initialization

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/setup/status` | ✅ | Supastack native; check if open |
| POST | `/setup` | ✅ | Supastack native; first-time setup |

### CLI & Dashboard

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| POST | `/api/v1/cli/login` | ✅ | Supastack native; CLI login via user_id |
| GET | `/cli/profile.toml` | ✅ | Supastack native; profile for CLI config |
| POST | `/cli/mint-token` | ✅ | Supastack native; mint API token for CLI |
| GET | `/org` | ✅ | Supastack native; current org |
| PATCH | `/org` | ✅ | Supastack native; update org |
| PUT | `/org/backup-store` | ✅ | Supastack native; configure backup S3 |

### Billing & Plans

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/platform/organizations/:slug/billing/subscription` | 🔧 | Mock only; 'free' plan |
| GET | `/platform/organizations/:slug/billing/plans` | 🔧 | Mock only; list plans |
| GET | `/platform/organizations/:slug/billing/credits/balance` | 🔧 | Mock only; returns 0 |
| GET | `/platform/organizations/:slug/billing/invoices` | 🔧 | Mock only; returns `[]` |
| HEAD | `/platform/organizations/:slug/billing/invoices` | 🔧 | Mock only; X-Total-Count: 0 |
| POST | `/platform/organizations/:slug/billing/subscription/confirm` | 🚫 | Out of scope; billing feature |
| POST | `/platform/organizations/:slug/billing/upgrade-request` | 🚫 | Out of scope; billing feature |
| POST | `/platform/stripe/setup-intent` | 🚫 | Out of scope; stripe integration |
| POST | `/platform/organizations/:slug/payments/setup-intent` | 🚫 | Out of scope; stripe integration |
| GET | `/platform/stripe/invoices/overdue` | 🚫 | Out of scope; billing feature |

### Integrations & Apps

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/platform/integrations` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/integrations/:slug` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/integrations/github/authorization` | 🔧 | Mock only; null app |
| GET | `/platform/integrations/github/connections` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/integrations/github/repositories` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/organizations/:slug/apps` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/organizations/:slug/apps/installations` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/organizations/:slug/oauth/apps` | 🔧 | Mock only; returns `[]` |
| POST | `/platform/organizations/:slug/oauth/apps` | 🔧 | Mock only; synthetic app |
| DELETE | `/platform/organizations/:slug/oauth/apps/:id` | 🔧 | Mock only; 204 |
| POST | `/platform/organizations/:slug/oauth/apps/:id/revoke` | 🔧 | Mock only; 200 |

### OAuth / OIDC

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/.well-known/oauth-authorization-server` | ✅ | Supastack native; OIDC discovery |
| GET | `/oauth/authorize` | ✅ | Supastack native; auth code flow |
| POST | `/oauth/authorize` | ✅ | Supastack native; consent grant |
| POST | `/oauth/token` | ✅ | Supastack native; exchange code for token |
| POST | `/oauth/register` | ✅ | Supastack native; dynamic client registration |
| GET | `/api/v1/oauth/clients` | ✅ | Supastack native; list OAuth clients |
| DELETE | `/api/v1/oauth/clients/:client_id` | ✅ | Supastack native; revoke client |

### Replication

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/platform/replication/:ref/sources` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/replication/:ref/destinations` | 🔧 | Mock only; returns `[]` |
| GET | `/platform/replication/:ref/pipelines` | 🔧 | Mock only; returns `[]` |
| POST | `/platform/replication/:ref/destinations` | 🔧 | Mock only; synthetic dest |
| DELETE | `/platform/replication/:ref/destinations/:id` | 🔧 | Mock only; 204 |
| POST | `/platform/replication/:ref/pipelines` | 🔧 | Mock only; synthetic pipeline |
| DELETE | `/platform/replication/:ref/pipelines/:id` | 🔧 | Mock only; 204 |
| POST | `/platform/replication/:ref/pipelines/:id/start` | 🔧 | Mock only; 200 |
| POST | `/platform/replication/:ref/pipelines/:id/stop` | 🔧 | Mock only; 200 |

### Internal / Admin

| Method | Path | Status | Notes |
|--------|------|--------|-------|
| GET | `/audit` | ✅ | Supastack native; audit log |
| POST | `/internal/caddy/reload` | ✅ | Supastack native; reload reverse proxy |
| POST | `/internal/pg-edge-cert/issue` | ✅ | Supastack native; issue TLS cert |
| GET | `/internal/tls/ask` | ✅ | Supastack native; TLS ACME challenge |
| GET | `/.well-known/acme-challenge/:token` | ✅ | Supastack native; ACME validation |
| POST | `/internal/pooler/tenants` | ✅ | Supastack native; create pooler tenant |
| DELETE | `/internal/pooler/tenants/:ref` | ✅ | Supastack native; delete pooler tenant |
| GET | `/wildcard-certs/status` | ✅ | Supastack native; wildcard TLS status |
| POST | `/wildcard-certs/initiate` | ✅ | Supastack native; request wildcard cert |
| POST | `/wildcard-certs/verify` | ✅ | Supastack native; verify wildcard domain |
| DELETE | `/wildcard-certs` | ✅ | Supastack native; delete cert |
| POST | `/apex/recheck` | ✅ | Supastack native; recheck apex domain |
| POST | `/apex/issue` | ✅ | Supastack native; issue apex cert |
| GET | `/apex` | ✅ | Supastack native; apex domain status |

### Out of Scope

| Method | Path | Category | Reason |
|--------|------|----------|--------|
| POST | `/platform/organizations/cloud-marketplace` | 🚫 | Marketplace |
| POST | `/platform/organizations/confirm-subscription` | 🚫 | Marketplace |
| POST | `/platform/feedback/*` | 🚫 | Feedback endpoints |
| GET | `/platform/organizations/:slug/sso` | 🚫 | SSO (enterprise) |
| PATCH | `/platform/organizations/:slug/members/mfa/enforcement` | 🚫 | MFA enforcement |
| GET | `/platform/projects/:ref/restore/versions` | 🚫 | Backup restore (complex) |
| GET | `/platform/projects/:ref/privatelink/associations` | 🚫 | PrivateLink (enterprise) |
| GET | `/v1/projects/:ref/read-replicas` | 🚫 | Read replicas (complex) |
| GET | `/platform/projects/:ref/load-balancers` | 🚫 | Load balancers (enterprise) |
| GET | `/platform/organizations/:slug/members/mfa/enforcement` | 🚫 | MFA enforcement |

---

## Key Observations

### Supastack Implementation (✅)
**42 native endpoints** covering:
- Complete auth flow (login, tokens, session management)
- Organization & member management
- Project CRUD + operations (pause/resume/restart/upgrade)
- Config management (auth, postgrest, postgres, storage)
- Function deployment (eszip, multipart, download)
- Database backups & migrations
- Storage buckets (proxy)
- Analytics/logs (proxy to Logflare)
- OAuth/OIDC discovery and token exchange
- CLI integration (profile.toml, token minting)
- Health checks & status endpoints
- Internal admin operations (TLS, pooler, audit)

### Mock-Only Routes (🔧)
**115+ endpoints** that return hardcoded responses suitable for local development:
- Billing/plans (always "free")
- Organization billing & usage
- Integrations (GitHub, apps)
- Replication (experimental feature)
- Analytics (empty results)
- Project settings & resource details

### Proxied Routes (🔀)
**12 endpoints** routed to real services:
- `/auth/v1/*` → GoTrue
- `/pg-meta/v0/*` → pg-meta introspection
- `/storage/v1/*` → Storage container
- Platform auth config → GoTrue `/settings`

### Out of Scope (🚫)
**25+ endpoints** not implemented in self-hosted:
- Stripe/payment integration
- Marketplace features
- SSO (enterprise)
- PrivateLink (enterprise)
- Replication with external sources
- Feedback endpoints

---

## Route Registration Pattern

All Supastack routes follow the Fastify plugin pattern:

```typescript
export const routesPlugin: FastifyPluginAsync = async (app) => {
  app.get('/path', async (req, reply) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'permission');
    // business logic
    return reply.send(result);
  });
};
```

Routes are mounted in a management API group with:
- Auth middleware (session-based)
- RBAC middleware (permission checks)
- Error handling (ManagementApiError)
- Audit logging

---

## Migration Path: Mock → Implemented

If a route is marked **🔧 Mock Only**, it can be implemented by:

1. Creating a `.ts` file in `/routes/management/`
2. Exporting a `FastifyPluginAsync` function
3. Registering the plugin in the management API group
4. Implementing business logic against the shared database schema

Example: `GET /platform/projects/:ref/billing/addons` → `/v1/projects/:ref/billing/addons`

---

## Recommendations for Deployment

- **Cloud Studio** (IS_PLATFORM=true): Use this mock server pointing at the self-hosted API at http://localhost:4000
- **Local dev**: Start docker-compose with mock API + Caddy reverse proxy
- **Production**: Replace mock routes with Supastack native implementations as needed
- **Billing features**: Out of scope; self-hosted instances are admin-managed (no metering)
