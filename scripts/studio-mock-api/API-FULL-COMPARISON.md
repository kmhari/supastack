# Supabase Studio API vs Supastack — Full Coverage

**Legend:**
| Symbol | Meaning |
|---|---|
| ✅ | Implemented in Supastack (real backing logic) |
| 🔧 | Partial / platform stub — route exists and returns a valid (often empty/static) payload so Studio renders, but has no real backing yet |
| 🔀 | Proxy only — forward to per-instance Kong/service (`http://localhost:{portKong}/...`) |
| ❌ | Missing — no route (404), needs platform-level logic |
| 🚫 | Out of scope (billing, Stripe, marketplace, enterprise) |

> Updated for **feature 084** (control-plane GoTrue auth + multi-tenant orgs + Cloud RBAC) and **feature 025** (shared Studio `IS_PLATFORM=true`). Human session auth is now served by a real GoTrue at `/auth/v1/*` (Caddy → `auth:9999`); profile, organizations, members, invitations, roles and personal access tokens are real platform endpoints at `/api/v1/platform/*`. Feature 025 added a broad set of platform stubs so Studio's pages render without errors.

**Coverage (298 total rows):**
| Status | Count | % |
|---|---|---|
| ✅ Covered (real backing) | 72 | 24% |
| 🔧 Partial / platform stub | 143 | 48% |
| 🔀 Proxy only (add route → forward to Kong) | 48 | 16% |
| ❌ Missing (needs platform-level logic) | 27 | 9% |
| 🚫 Out of scope (billing/Stripe/marketplace) | 8 | 3% |

> Most of the 🔧 jump vs. earlier revisions is feature 025: it stubs ~130 platform routes (replication, org apps/OAuth, disk, content, notifications, integrations, analytics usage, feedback, …) with valid empty/static payloads so Studio renders, pending real backends.

---

## API Keys

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/api-keys` | GET | ✅ | List anon + service_role keys | `GET /projects/:ref/api-keys` |
| `/v1/projects/:ref/api-keys/:id` | PATCH | ❌ | Update key name/description | — |
| `/v1/projects/:ref/api-keys/:id` | DELETE | ❌ | Delete custom API key | — |

---

## Account

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/signup` | POST | 🔧 | Create new account (signups disabled — `GOTRUE_DISABLE_SIGNUP`) | `POST /api/v1/platform/signup` (stub) |
| `/platform/reset-password` | POST | ✅ | Send password reset email (GoTrue recover, SMTP-gated) | `POST /api/v1/platform/reset-password` |
| `/platform/update-email` | POST | 🔧 | Update account email | `POST /api/v1/platform/update-email` (stub) |

---

## Auth (Session)

> Feature 084: served by the real control-plane GoTrue at `/auth/v1/*` (Caddy → `auth:9999`). No more `sb_sid` session / `studio-gotrue` shim.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/token` | POST | ✅ | Sign in with password / refresh token / PKCE | `→ GoTrue /auth/v1/token` |
| `/logout` | POST | ✅ | Sign out current session | `→ GoTrue /auth/v1/logout` |
| `/user` | GET | ✅ | Get current authenticated user | `→ GoTrue /auth/v1/user` |
| `/user` | PUT | ✅ | Update current user (email, password) | `→ GoTrue /auth/v1/user` |
| `/signup` | POST | 🔧 | Register new user (disabled — `GOTRUE_DISABLE_SIGNUP`) | `→ GoTrue /auth/v1/signup` |
| `/health` | GET | ✅ | GoTrue health check | `→ GoTrue /auth/v1/health` |
| `/settings` | GET | ✅ | Get GoTrue server settings | `→ GoTrue /auth/v1/settings` |
| `/otp` | POST | ✅ | Request OTP / magic link (SMTP-gated) | `→ GoTrue /auth/v1/otp` |
| `/recover` | POST | ✅ | Initiate password recovery (SMTP-gated) | `→ GoTrue /auth/v1/recover` |
| `/verify` | POST | ✅ | Verify OTP / magic link token | `→ GoTrue /auth/v1/verify` |
| `/authorize` | GET | 🔧 | OAuth authorize redirect (no social providers configured) | `→ GoTrue /auth/v1/authorize` |
| `/mfa/authenticator/assurance-level` | GET | 🔧 | Get MFA assurance level (MFA out of scope) | `→ GoTrue /auth/v1/...` |
| `/factors` | GET | 🔧 | List MFA factors (MFA out of scope) | `→ GoTrue /auth/v1/factors` |

---

## Auth Config (GoTrue settings per project)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/auth/:ref/config` | GET | ✅ | Get GoTrue auth settings (providers, JWT, etc.) | `GET /projects/:ref/config/auth` |
| `/platform/auth/:ref/config` | PATCH | ✅ | Update GoTrue auth settings (incl. `hook_*`, feature 082) | `PATCH /projects/:ref/config/auth` |
| `/platform/auth/:ref/config/hooks` | GET | ❌ | Get auth hook configs (hooks flow through `config/auth`) | — |
| `/platform/auth/:ref/config/hooks` | PATCH | ❌ | Update auth hook configs (hooks flow through `config/auth`) | — |

---

## Auth Management (GoTrue admin — per project users)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/auth/:ref/users` | GET | 🔀 | List project's GoTrue users | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/:ref/users` | POST | 🔀 | Create a GoTrue user | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/:ref/users/:id` | GET | 🔀 | Get user by ID | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id` | PUT | 🔀 | Update user (ban, role, metadata) | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id` | DELETE | 🔀 | Delete user | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id/factors` | GET | 🔀 | List user's MFA factors | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/:ref/users/:id/factors` | DELETE | 🔀 | Delete user's MFA factors | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/:ref/invite` | POST | 🔀 | Send invite email via GoTrue | `→ Kong /auth/v1/invite` |
| `/platform/auth/:ref/magiclink` | POST | 🔀 | Send magic link via GoTrue | `→ Kong /auth/v1/magiclink` |
| `/platform/auth/:ref/otp` | POST | 🔀 | Send OTP via GoTrue | `→ Kong /auth/v1/otp` |
| `/platform/auth/:ref/recover` | POST | 🔀 | Send password recovery via GoTrue | `→ Kong /auth/v1/recover` |
| `/platform/auth/:ref/templates/:template/reset` | POST | 🔀 | Reset email template to default | `→ Kong /auth/v1/admin/templates` |
| `/platform/auth/:ref/validate/spam` | POST | 🔀 | Validate spam / abuse | `→ Kong /auth/v1/admin/validate/spam` |

---

## GoTrue Admin (direct)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/admin/users` | GET | 🔀 | List all users (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users` | POST | 🔀 | Create user (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users/:id` | GET | 🔀 | Get user by ID (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | PUT | 🔀 | Update user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | DELETE | 🔀 | Delete user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:uid/factors/:fid` | DELETE | 🔀 | Delete user factor (admin) | `→ Kong /auth/v1/admin/users/:uid/factors/:fid` |
| `/admin/factors` | GET | 🔀 | List all factors (admin) | `→ Kong /auth/v1/admin/factors` |

---

## Profile

> Feature 084: real, backed by `auth.users` (GoTrue) + `api_tokens`.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/profile` | GET | ✅ | Get logged-in user's profile (+ `disabled_features`) | `GET /api/v1/platform/profile` |
| `/platform/profile` | PUT | ✅ | Update profile (name, etc.) | `PUT /api/v1/platform/profile` |
| `/platform/profile` | PATCH | ✅ | Partial update profile | `PATCH /api/v1/platform/profile` |
| `/platform/profile/permissions` | GET | ✅ | Get user's RBAC permissions (per-org) | `GET /api/v1/platform/profile/permissions` |
| `/platform/profile/access-tokens` | GET | ✅ | List personal access tokens | `GET /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens` | POST | ✅ | Create PAT | `POST /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens/:id` | DELETE | ✅ | Revoke PAT | `DELETE /api/v1/platform/profile/access-tokens/:id` |
| `/platform/profile/scoped-access-tokens` | GET | 🔧 | List scoped tokens | `GET /api/v1/platform/profile/scoped-access-tokens` (stub) |
| `/platform/profile/audit` | GET | 🔧 | Get user login audit log | `GET /api/v1/platform/profile/audit` (stub) |
| `/platform/profile/audit-login` | POST | 🔧 | Record login audit event | `POST /api/v1/platform/profile/audit-login` (stub) |

---

## Organizations

> Feature 084: real multi-tenant orgs. Org id = 20-char ref (not uuid). `slug` == id.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations` | GET | ✅ | List user's organizations (all memberships) | `GET /api/v1/platform/organizations` |
| `/platform/organizations` | POST | ✅ | Create an organization (creator → owner) | `POST /api/v1/platform/organizations` |
| `/platform/organizations/preview-creation` | POST | 🔧 | Preview org creation (validation) | `POST /api/v1/platform/organizations/preview-creation` (stub) |
| `/platform/organizations/:slug` | GET | ✅ | Get organization details | `GET /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug` | PATCH | ✅ | Update organization (name) | `PATCH /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug` | DELETE | ✅ | Delete organization (refused if it owns projects) | `DELETE /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug/projects` | GET | ✅ | List org projects (paginated, org-scoped authz) | `GET /api/v1/platform/organizations/:slug/projects` |
| `/platform/organizations/:slug/available-versions` | GET | 🔧 | List available Postgres versions | `GET .../organizations/:slug/available-versions` (stub) |
| `/platform/organizations/:slug/usage` | GET | 🔧 | Get org usage metrics | `GET .../organizations/:slug/usage` (stub) |
| `/platform/organizations/:slug/usage/daily` | GET | 🔧 | Get daily usage breakdown | `GET .../organizations/:slug/usage/daily` (stub) |
| `/platform/organizations/:slug/entitlements` | GET | 🔧 | Get feature entitlements | `GET .../organizations/:slug/entitlements` (stub) |
| `/platform/organizations/:slug/audit` | GET | 🔧 | Get org audit log | `GET .../organizations/:slug/audit` (stub) |
| `/platform/organizations/:slug/sso` | GET | ❌ | List SSO configurations | — |

---

## Org Members

> Feature 084: real members + invitations + numeric-id roles (Owner/Administrator/Developer/Read-only).

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/members` | GET | ✅ | List org members (with `role_ids[]`) | `GET .../organizations/:slug/members` |
| `/platform/organizations/:slug/members/:gotrue_id` | PATCH | ✅ | Update member role | `PATCH .../members/:gotrue_id` |
| `/platform/organizations/:slug/members/:gotrue_id` | DELETE | ✅ | Remove member (last-owner guard) | `DELETE .../members/:gotrue_id` |
| `/platform/organizations/:slug/members/invitations` | GET | ✅ | List pending invitations | `GET .../members/invitations` |
| `/platform/organizations/:slug/members/invitations` | POST | ✅ | Send invitation (SMTP-gated) | `POST .../members/invitations` |
| `/platform/organizations/:slug/members/invitations/:id` | DELETE | ✅ | Cancel invitation | `DELETE .../members/invitations/:id` |
| `/platform/organizations/:slug/members/invitations/:token` | GET | ✅ | Get invite by token | `GET .../members/invitations/:token` |
| `/platform/organizations/:slug/members/invitations/:token` | POST | ✅ | Accept invitation | `POST .../members/invitations/:token` |
| `/platform/organizations/:slug/members/mfa/enforcement` | GET | 🔧 | Get MFA policy (MFA out of scope) | `GET .../members/mfa/enforcement` (stub) |
| `/platform/organizations/:slug/members/mfa/enforcement` | PATCH | 🔧 | Set MFA enforcement (MFA out of scope) | `PATCH .../members/mfa/enforcement` (stub) |
| `/platform/organizations/:slug/members/reached-free-project-limit` | GET | 🔧 | Check free project limit | `GET .../members/reached-free-project-limit` (stub) |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | POST | ✅ | Assign role to member | `POST .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | DELETE | ✅ | Remove role from member | `DELETE .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/:slug/roles` | GET | ✅ | List available roles (4 numeric-id objects) | `GET .../organizations/:slug/roles` |

---

## Org Billing

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/billing/subscription` | GET | 🔧 | Get current subscription plan (always Free) | `GET .../billing/subscription` (stub) |
| `/platform/organizations/:slug/billing/subscription/confirm` | POST | 🚫 | Confirm plan change | — |
| `/platform/organizations/:slug/billing/upgrade-request` | POST | 🚫 | Request plan upgrade | — |
| `/platform/organizations/:slug/billing/plans` | GET | 🔧 | List available plans (Free only) | `GET .../billing/plans` (stub) |
| `/platform/organizations/:slug/billing/invoices` | GET | 🔧 | List invoices (empty) | `GET .../billing/invoices` (stub) |
| `/platform/organizations/:slug/billing/invoices` | HEAD | 🚫 | Count invoices (X-Total-Count) | — |
| `/platform/organizations/:slug/billing/credits/balance` | GET | 🔧 | Get credit balance (zero) | `GET .../billing/credits/balance` (stub) |
| `/platform/organizations/:slug/payments/setup-intent` | POST | 🚫 | Create Stripe setup intent | — |
| `/platform/stripe/invoices/overdue` | GET | 🚫 | List overdue invoices | — |
| `/platform/stripe/setup-intent` | POST | 🚫 | Global Stripe setup intent | — |
| `/platform/organizations/cloud-marketplace` | POST | 🚫 | Register via marketplace | — |
| `/platform/organizations/confirm-subscription` | POST | 🚫 | Confirm marketplace subscription | — |

---

## Org Apps & OAuth

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/apps` | GET | 🔧 | List platform apps (empty) | `GET .../apps` (stub) |
| `/platform/organizations/:slug/apps/installations` | GET | 🔧 | List app installations (empty) | `GET .../apps/installations` (stub) |
| `/platform/organizations/:slug/apps/installations` | POST | 🔧 | Install app | `POST .../apps/installations` (stub) |
| `/platform/organizations/:slug/apps/installations/:id` | DELETE | 🔧 | Uninstall app | `DELETE .../apps/installations/:id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | GET | 🔧 | Get app details | `GET .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | PATCH | 🔧 | Update app | `PATCH .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | DELETE | 🔧 | Delete app | `DELETE .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id/signing-keys` | POST | 🔧 | Create signing key | `POST .../apps/:app_id/signing-keys` (stub) |
| `/platform/organizations/:slug/apps/:app_id/signing-keys/:id` | DELETE | 🔧 | Delete signing key | `DELETE .../signing-keys/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps` | GET | 🔧 | List OAuth apps | `GET .../oauth/apps` (stub; real OAuth clients at `/api/v1/oauth/*`) |
| `/platform/organizations/:slug/oauth/apps` | POST | 🔧 | Create OAuth app | `POST .../oauth/apps` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id` | GET | 🔧 | Get OAuth app | `GET .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id` | DELETE | 🔧 | Delete OAuth app | `DELETE .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/revoke` | POST | 🔧 | Revoke OAuth app | `POST .../oauth/apps/:id/revoke` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets` | POST | 🔧 | Create client secret | `POST .../client-secrets` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets/:sid` | DELETE | 🔧 | Delete client secret | `DELETE .../client-secrets/:sid` (stub) |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | 🔧 | Get OAuth authorization | `GET .../oauth/authorizations/:id` (stub) |
| `/platform/oauth/authorizations/:id` | GET | 🔧 | Get global OAuth authorization | `GET /platform/oauth/authorizations/:id` (stub) |

---

## Projects

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects` | GET | ✅ | List all projects (paginated) | `GET /instances` |
| `/platform/projects` | POST | ✅ | Create a new project (org-scoped) | `POST /instances` |
| `/platform/projects/:ref` | GET | ✅ | Get project details | `GET /instances/:ref` |
| `/platform/projects/:ref` | PATCH | 🔧 | Update project name/settings | `PATCH /instances/:ref` |
| `/platform/projects/:ref` | DELETE | ✅ | Delete project | `DELETE /instances/:ref` |
| `/platform/projects/:ref/settings` | GET | ✅ | Get project JWT secret + API keys | included in `GET /instances/:ref` |
| `/platform/projects/:ref/api` | GET | 🔧 | Get Auto API (Kong) config | `GET .../projects/:ref/api` (stub) |
| `/platform/projects/:ref/api/rest` | GET | 🔧 | Get REST API config | `GET .../projects/:ref/api/rest` (stub) |
| `/platform/projects/:ref/members` | GET | 🔧 | List project members | `GET .../projects/:ref/members` (stub) |

---

## Project Lifecycle

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/pause` | POST | ✅ | Pause a project | `POST /projects/:ref/pause` |
| `/platform/projects/:ref/pause/status` | GET | ❌ | Get pause status | — |
| `/platform/projects/:ref/restart` | POST | ✅ | Restart a project | `POST /instances/:ref/restart` |
| `/platform/projects/:ref/restart-services` | POST | 🔧 | Restart specific services | `POST /instances/:ref/restart` |
| `/platform/projects/:ref/restore` | POST | ✅ | Restore a paused project | `POST /projects/:ref/restore` |
| `/platform/projects/:ref/restore/versions` | GET | ❌ | List restore versions | — |
| `/platform/projects/:ref/resize` | POST | 🔧 | Resize compute | `POST .../projects/:ref/resize` (stub) |
| `/platform/projects/:ref/db-password` | PATCH | 🔧 | Reset database password | `PATCH .../projects/:ref/db-password` (stub) |
| `/platform/projects/:ref/transfer` | POST | 🔧 | Transfer project to another org | `POST .../projects/:ref/transfer` (stub) |
| `/platform/projects/:ref/transfer/preview` | GET | 🔧 | Preview transfer (billing impact) | `GET .../projects/:ref/transfer/preview` (stub) |

---

## Project Config

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/config/postgrest` | GET | ✅ | Get PostgREST config (schema, max_rows) | `GET /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/postgrest` | PATCH | ✅ | Update PostgREST config | `PATCH /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/pgbouncer` | GET | ❌ | Get pgBouncer/pooler config | — |
| `/platform/projects/:ref/config/pgbouncer` | PATCH | 🔧 | Update pgBouncer config | `PATCH .../config/pgbouncer` (stub) |
| `/platform/projects/:ref/config/pgbouncer/status` | GET | 🔧 | Get pgBouncer status | `GET /api/v1/pooler/status` (partial) |
| `/platform/projects/:ref/config/realtime` | GET | 🔧 | Get Realtime config | `GET .../config/realtime` (stub) |
| `/platform/projects/:ref/config/realtime` | PATCH | 🔧 | Update Realtime config | `PATCH .../config/realtime` (stub) |
| `/platform/projects/:ref/config/storage` | GET | 🔧 | Get storage config (file size limits) | `GET .../config/storage` (stub) |
| `/platform/projects/:ref/config/secrets` | GET | ✅ | List project secrets | `GET /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets` | PATCH | ✅ | Upsert secrets | `POST /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets/update-status` | GET | ❌ | Get secret sync status | — |
| `/platform/projects/:ref/billing/addons` | GET | ✅ | Get project add-ons | `GET /projects/:ref/billing/addons` |

---

## Project Infrastructure

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/health` | GET | ✅ | Get service health statuses | `GET /instances/:ref/health` |
| `/platform/projects/:ref/databases` | GET | 🔧 | List databases for project | `GET .../projects/:ref/databases` (stub) |
| `/platform/projects/:ref/disk` | GET | 🔧 | Get disk info | `GET .../projects/:ref/disk` (stub) |
| `/platform/projects/:ref/disk` | POST | 🔧 | Configure disk size | `POST .../projects/:ref/disk` (stub) |
| `/platform/projects/:ref/disk/custom-config` | GET | 🔧 | Get custom disk config | `GET .../disk/custom-config` (stub) |
| `/platform/projects/:ref/disk/custom-config` | POST | 🔧 | Set custom disk config | `POST .../disk/custom-config` (stub) |
| `/platform/projects/:ref/disk/util` | GET | 🔧 | Get disk utilization | `GET .../disk/util` (stub) |
| `/platform/projects/:ref/load-balancers` | GET | ❌ | List load balancers | — |
| `/platform/projects/:ref/read-replicas` | GET | 🔧 | List read replicas (empty) | `GET .../read-replicas` (stub) |
| `/v1/projects/:ref/read-replicas` | GET | ❌ | List read replicas (v1) | — |
| `/platform/projects/:ref/live-queries` | GET | 🔧 | List active live queries (empty) | `GET .../live-queries` (stub) |
| `/platform/projects/:ref/resources/:id` | GET | 🔧 | Get compute resource | `GET .../resources/:id` (stub) |
| `/platform/projects/:ref/resources/:id` | PATCH | 🔧 | Update compute resource | `PATCH .../resources/:id` (stub) |
| `/platform/projects/:ref/infra-monitoring` | GET | ❌ | Get infra monitoring data | — |
| `/platform/projects/:ref/daily-stats` | GET | ❌ | Get daily usage stats | — |
| `/v1/projects/:ref/upgrade/eligibility` | GET | ❌ | Check upgrade eligibility | — |
| `/v1/projects/:ref/upgrade/status` | GET | ❌ | Get upgrade status | — |

---

## Network & Security

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/network-bans/retrieve` | POST | ❌ | Get banned IP addresses | — |
| `/v1/projects/:ref/network-bans` | DELETE | ❌ | Remove IP ban | — |
| `/v1/projects/:ref/network-restrictions` | GET | ❌ | Get network firewall rules | — |
| `/v1/projects/:ref/network-restrictions/apply` | POST | ❌ | Apply firewall rules | — |
| `/platform/projects/:ref/privatelink/associations` | GET | 🔧 | List PrivateLink associations (empty) | `GET .../privatelink/associations` (stub) |
| `/platform/projects/:ref/privatelink/associations/aws-account` | POST | 🔧 | Create AWS PrivateLink | `POST .../privatelink/associations/aws-account` (stub) |
| `/platform/projects/:ref/privatelink/associations/aws-account/:id` | GET | 🔧 | Get AWS PrivateLink | `GET .../aws-account/:id` (stub) |
| `/v1/projects/:ref/custom-hostname` | GET | ❌ | Get custom domain config | — |
| `/platform/projects/:ref/settings/sensitivity` | PATCH | 🔧 | Set data sensitivity level | `PATCH .../settings/sensitivity` (stub) |

---

## Database (Schema / SQL)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/pg-meta/:ref/query` | POST | 🔀 | Execute SQL query | `→ Kong /pg-meta/v0/query` |
| `/platform/pg-meta/:ref/tables` | GET | 🔀 | List tables | `→ Kong /pg-meta/v0/tables` |
| `/platform/pg-meta/:ref/views` | GET | 🔀 | List views | `→ Kong /pg-meta/v0/views` |
| `/platform/pg-meta/:ref/columns` | GET | 🔀 | List columns | `→ Kong /pg-meta/v0/columns` |
| `/platform/pg-meta/:ref/schemas` | GET | 🔀 | List schemas | `→ Kong /pg-meta/v0/schemas` |
| `/platform/pg-meta/:ref/policies` | GET | 🔀 | List RLS policies | `→ Kong /pg-meta/v0/policies` |
| `/platform/pg-meta/:ref/types` | GET | 🔀 | List custom types | `→ Kong /pg-meta/v0/types` |
| `/platform/pg-meta/:ref/functions` | GET | 🔀 | List database functions | `→ Kong /pg-meta/v0/functions` |
| `/platform/pg-meta/:ref/publications` | GET | 🔀 | List publications | `→ Kong /pg-meta/v0/publications` |
| `/platform/pg-meta/:ref/triggers` | GET | 🔀 | List triggers | `→ Kong /pg-meta/v0/triggers` |
| `/platform/pg-meta/:ref/materialized-views` | GET | 🔀 | List materialized views | `→ Kong /pg-meta/v0/materialized-views` |
| `/platform/pg-meta/:ref/column-privileges` | GET | 🔀 | List column privileges | `→ Kong /pg-meta/v0/column-privileges` |
| `/v1/projects/:ref/database/query` | POST | ✅ | Run ad-hoc SQL (CLI compat) | `POST /projects/:ref/database/query` |

---

## Backups

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/database/:ref/backups` | GET | ✅ | List available backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/downloadable-backups` | GET | 🔧 | List downloadable backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/download` | POST | 🔧 | Download a backup | `POST .../backups/download` (stub) |
| `/platform/database/:ref/backups/restore` | POST | ✅ | Restore from logical backup (async worker) | `POST .../backups/restore` |
| `/platform/database/:ref/backups/pitr` | POST | ✅ | Point-in-time restore | `POST .../backups/restore-pitr` |
| `/platform/database/:ref/backups/restore-physical` | POST | 🔧 | Restore physical backup | `POST .../backups/restore-physical` (stub) |
| `/platform/database/:ref/backups/enable-physical-backups` | POST | ❌ | Enable physical backups | — |
| `/platform/database/:ref/clone` | POST | 🔧 | Clone database to new project | `POST .../database/:ref/clone` (stub) |
| `/platform/database/:ref/hook-enable` | POST | 🔧 | Enable database webhooks | `POST .../database/:ref/hook-enable` (stub) |

---

## Storage

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/storage/:ref/buckets` | GET | ✅ | List storage buckets | `GET /projects/:ref/storage/buckets` |
| `/platform/storage/:ref/buckets/:id` | GET | 🔀 | Get bucket details | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id` | PATCH | 🔀 | Update bucket settings | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id` | DELETE | 🔀 | Delete bucket | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id/empty` | POST | 🔀 | Empty bucket contents | `→ Kong /storage/v1/bucket/:id/empty` |
| `/platform/storage/:ref/buckets/:id/objects/list` | POST | 🔀 | List objects in bucket | `→ Kong /storage/v1/object/list/:id` |
| `/platform/storage/:ref/buckets/:id/objects/sign` | POST | 🔀 | Create signed URL | `→ Kong /storage/v1/object/sign/:id/*` |
| `/platform/storage/:ref/buckets/:id/objects/sign-multi` | POST | 🔀 | Create multiple signed URLs | `→ Kong /storage/v1/object/sign` |
| `/platform/storage/:ref/buckets/:id/objects/public-url` | POST | 🔀 | Get public object URL | `→ Kong /storage/v1/object/public/:id/*` |
| `/platform/storage/:ref/buckets/:id/objects/move` | POST | 🔀 | Move object | `→ Kong /storage/v1/object/move` |
| `/platform/storage/:ref/buckets/:id/objects` | DELETE | 🔀 | Delete objects | `→ Kong /storage/v1/object/:id` |
| `/platform/storage/:ref/credentials` | GET | 🔀 | List storage S3 credentials | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/:ref/credentials` | POST | 🔀 | Create storage S3 credential | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/:ref/credentials/:id` | DELETE | 🔀 | Delete storage S3 credential | `→ Kong /storage/v1/s3/accesskey/:id` |
| `/platform/storage/:ref/vector-buckets` | GET | 🔧 | List vector buckets (empty) | `GET .../vector-buckets` (stub) |
| `/platform/storage/:ref/vector-buckets` | POST | 🔧 | Create vector bucket | `POST .../vector-buckets` (stub) |
| `/platform/storage/:ref/vector-buckets/:id` | DELETE | 🔧 | Delete vector bucket | `DELETE .../vector-buckets/:id` (stub) |
| `/platform/storage/:ref/vector-buckets/:id/indexes` | POST | 🔧 | Create vector index | `POST .../vector-buckets/:id/indexes` (stub) |
| `/platform/storage/:ref/vector-buckets/:id/indexes/:name` | DELETE | 🔧 | Delete vector index | `DELETE .../indexes/:name` (stub) |
| `/platform/storage/:ref/analytics-buckets` | GET | 🔧 | List analytics buckets (empty) | `GET .../analytics-buckets` (stub) |
| `/platform/storage/:ref/analytics-buckets` | POST | 🔧 | Create analytics bucket | `POST .../analytics-buckets` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id` | DELETE | 🔧 | Delete analytics bucket | `DELETE .../analytics-buckets/:id` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | GET | 🔧 | List bucket namespaces | `GET .../namespaces` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | POST | 🔧 | Create namespace | `POST .../namespaces` (stub) |
| `/platform/storage/:ref/archive` | GET | 🔧 | Get storage archive info | `GET .../storage/:ref/archive` (stub) |

---

## Edge Functions

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/functions` | GET | ✅ | List edge functions | `GET /projects/:ref/functions` |
| `/v1/projects/:ref/functions` | POST | 🔧 | Deploy edge function | `POST /projects/:ref/functions/deploy` |
| `/v1/projects/:ref/functions/:slug` | GET | ✅ | Get function details | `GET /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | PATCH | 🔧 | Update function (name, verify_jwt) | `POST /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | DELETE | ✅ | Delete function | `DELETE /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug/body` | GET | ✅ | Download function source | `GET /projects/:ref/functions/:slug/body` |
| `/v1/projects/:ref/functions/deployed-size` | GET | ❌ | Get total deployed size | — |

---

## Secrets

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/secrets` | GET | ✅ | List secrets (SHA256 masked) | `GET /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | POST | ✅ | Set / upsert secrets | `POST /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | DELETE | ✅ | Delete secrets | `DELETE /projects/:ref/secrets` |

---

## Analytics & Logs

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/analytics/endpoints/logs.all` | GET | ✅ | Query all logs | `GET /projects/:ref/analytics/endpoints/logs.all` |
| `/platform/projects/:ref/analytics/endpoints/logs.all.otel` | GET | 🔀 | Query OpenTelemetry logs | `→ Kong /analytics/v1/otel/logs` |
| `/platform/projects/:ref/analytics/endpoints/auth.metrics` | GET | 🔀 | Get auth performance metrics | `→ Kong /analytics/v1/endpoints/auth.metrics` |
| `/platform/projects/:ref/analytics/endpoints/service-health` | GET | 🔀 | Get service health metrics | `→ Kong /analytics/v1/endpoints/service-health` |
| `/platform/projects/:ref/analytics/endpoints/usage.api-counts` | GET | 🔧 | Get API request counts (empty) | `GET .../usage.api-counts` (stub) |
| `/platform/projects/:ref/analytics/endpoints/usage.api-requests-count` | GET | 🔧 | Get API request totals (empty) | `GET .../usage.api-requests-count` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.combined-stats` | GET | 🔧 | Get function combined stats (empty) | `GET .../functions.combined-stats` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.req-stats` | GET | 🔧 | Get function request stats (empty) | `GET .../functions.req-stats` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.resource-usage` | GET | 🔧 | Get function resource usage (empty) | `GET .../functions.resource-usage` (stub) |
| `/platform/projects/:ref/analytics/log-drains` | GET | 🔧 | List log drain destinations (empty) | `GET .../analytics/log-drains` (stub) |
| `/platform/projects/:ref/analytics/log-drains` | POST | 🔧 | Create log drain | `POST .../analytics/log-drains` (stub) |
| `/platform/projects/:ref/analytics/log-drains/:token` | PUT | 🔧 | Update log drain | `PUT .../log-drains/:token` (stub) |
| `/platform/projects/:ref/analytics/log-drains/:token` | DELETE | 🔧 | Delete log drain | `DELETE .../log-drains/:token` (stub) |
| `/platform/projects/:ref/run-lints` | GET | ❌ | Run database lint checks | — |
| `/platform/projects/:ref/notifications/advisor/exceptions` | GET | ❌ | Get lint exception rules | — |

---

## Notifications

> Feature 025 stubs — return empty so Studio's notification bell renders.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/notifications` | GET | 🔧 | List platform notifications (empty) | `GET /api/v1/platform/notifications` (stub) |
| `/platform/notifications` | PATCH | 🔧 | Mark notifications as read | `PATCH /api/v1/platform/notifications` (stub) |
| `/platform/notifications/archive-all` | PATCH | 🔧 | Archive all notifications | `PATCH .../notifications/archive-all` (stub) |
| `/platform/notifications/summary` | GET | 🔧 | Get notification counts (zero) | `GET .../notifications/summary` (stub) |

---

## Replication

> Feature 025 stubs — return empty so Studio's replication pages render. No real replication backend.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/replication/:ref/sources` | GET | 🔧 | List replication sources (empty) | stub |
| `/platform/replication/:ref/sources/:id/tables` | GET | 🔧 | List source tables | stub |
| `/platform/replication/:ref/sources/:id/publications` | GET | 🔧 | List source publications | stub |
| `/platform/replication/:ref/sources/:id/publications` | POST | 🔧 | Create publication | stub |
| `/platform/replication/:ref/sources/:id/publications/:name` | DELETE | 🔧 | Delete publication | stub |
| `/platform/replication/:ref/destinations` | GET | 🔧 | List replication destinations (empty) | stub |
| `/platform/replication/:ref/destinations` | POST | 🔧 | Create destination | stub |
| `/platform/replication/:ref/destinations/validate` | POST | 🔧 | Validate destination config | stub |
| `/platform/replication/:ref/destinations/:id` | PATCH | 🔧 | Update destination | stub |
| `/platform/replication/:ref/destinations/:id` | DELETE | 🔧 | Delete destination | stub |
| `/platform/replication/:ref/pipelines` | GET | 🔧 | List replication pipelines (empty) | stub |
| `/platform/replication/:ref/pipelines` | POST | 🔧 | Create pipeline | stub |
| `/platform/replication/:ref/pipelines/validate` | POST | 🔧 | Validate pipeline config | stub |
| `/platform/replication/:ref/pipelines/:id` | DELETE | 🔧 | Delete pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/start` | POST | 🔧 | Start pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/stop` | POST | 🔧 | Stop pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/status` | GET | 🔧 | Get pipeline status | stub |
| `/platform/replication/:ref/pipelines/:id/version` | GET | 🔧 | Get pipeline version | stub |
| `/platform/replication/:ref/pipelines/:id/replication-status` | GET | 🔧 | Get replication lag / status | stub |
| `/platform/replication/:ref/pipelines/:id/rollback-tables` | POST | 🔧 | Rollback specific tables | stub |
| `/platform/replication/:ref/destinations-pipelines` | POST | 🔧 | Create destination+pipeline together | stub |
| `/platform/replication/:ref/destinations-pipelines/:did/:pid` | DELETE | 🔧 | Delete destination+pipeline | stub |
| `/platform/replication/:ref/tenants` | GET | 🔧 | List tenants | stub |
| `/platform/replication/:ref/tenants` | DELETE | 🔧 | Delete tenant | stub |
| `/platform/replication/:ref/tenants-sources` | POST | 🔧 | Create tenant source | stub |

---

## Integrations

> Feature 025 stubs — return empty so Studio's integration pages render.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/integrations` | GET | 🔧 | List global integrations (empty) | `GET /api/v1/platform/integrations` (stub) |
| `/platform/integrations/:slug` | GET | 🔧 | List org integrations (empty) | `GET .../integrations/:slug` (stub) |
| `/platform/integrations/github/authorization` | GET | 🔧 | Get GitHub app auth status | `GET .../github/authorization` (stub) |
| `/platform/integrations/github/connections` | GET | 🔧 | List GitHub connections (empty) | `GET .../github/connections` (stub) |
| `/platform/integrations/github/repositories` | GET | 🔧 | List GitHub repos (empty) | `GET .../github/repositories` (stub) |

---

## Telemetry & Feature Flags

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/telemetry/feature-flags` | GET | 🔧 | Get feature flag values | `GET /api/v1/platform/telemetry/feature-flags` (stub) |
| `/platform/projects-resource-warnings` | GET | 🔧 | Get resource warning alerts (empty) | `GET /api/v1/platform/projects-resource-warnings` (stub) |
| `/platform/deployment-mode` | GET | ✅ | Get deployment mode (self-hosted) | `GET /api/v1/platform/deployment-mode` |

---

## Project Misc (UI / Content / Branches)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/content` | GET | 🔧 | List saved SQL queries/snippets (empty) | `GET .../projects/:ref/content` (stub) |
| `/platform/projects/:ref/content` | POST | 🔧 | Save a SQL snippet | `POST .../projects/:ref/content` (stub) |
| `/platform/projects/:ref/content/count` | GET | 🔧 | Count content items | `GET .../content/count` (stub) |
| `/platform/projects/:ref/content/folders` | GET | 🔧 | List content folders | `GET .../content/folders` (stub) |
| `/platform/projects/:ref/content/folders/:id` | GET | 🔧 | Get content folder | `GET .../content/folders/:id` (stub) |
| `/platform/projects/:ref/content/item/:id` | GET | 🔧 | Get specific content item | `GET .../content/item/:id` (stub) |
| `/platform/projects/:ref/service-versions` | GET | 🔧 | Get version info for each service | `GET .../service-versions` (stub) |
| `/platform/projects/:ref/api-keys/temporary` | GET | 🔧 | Get short-lived API keys | `GET .../api-keys/temporary` (stub) |
| `/v1/projects/:ref/branches` | GET | ❌ | List database branches | — |
| `/v1/projects/:ref/config/auth/signing-keys` | GET | ❌ | List JWT signing keys | — |
| `/v1/projects/:ref/config/auth/third-party-auth` | GET | ❌ | List third-party auth providers | — |

---

## CLI & Developer

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/api/v1/cli/login` | POST | ✅ | Device-code login for CLI | `POST /api/v1/cli/login` |
| `/cli/profile.toml` | GET | ✅ | Get CLI profile config | `GET /cli/profile.toml` |
| `/cli/mint-token` | POST | ✅ | Mint short-lived CLI token | `POST /cli/mint-token` |
| `/health` | GET | ✅ | API health check | `GET /health` |

---

## Studio UI Overrides (apex-root / basePath)

> Feature 025 + 891dde7: Studio's own Next.js API routes that 500 self-hosted are intercepted by Caddy and served by api stubs. Routed under the `/dashboard` basePath too.

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/api/get-deployment-commit` | GET | ✅ | Studio build/version banner | `GET /api/get-deployment-commit` (api stub) |
| `/api/incident-banner` | GET | ✅ | Cloud incident banner (none self-hosted) | `GET /api/incident-banner` → `null` |
| `/api/incident-status` | GET | ✅ | Active StatusPage incidents (none self-hosted) | `GET /api/incident-status` → `[]` |

---

## Feedback

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/feedback/send` | POST | 🔧 | Send general feedback (no-op) | `POST /api/v1/platform/feedback/send` (stub) |
| `/platform/feedback/upgrade` | POST | 🔧 | Send upgrade feedback (no-op) | `POST .../feedback/upgrade` (stub) |
| `/platform/feedback/downgrade` | POST | 🔧 | Send downgrade feedback (no-op) | `POST .../feedback/downgrade` (stub) |
| `/platform/feedback/conversations/:id/custom-fields` | PATCH | 🔧 | Update feedback conversation fields | `PATCH .../conversations/:id/custom-fields` (stub) |
