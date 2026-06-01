# Supabase Studio API vs Supastack — Full Coverage

**Legend:**
| Symbol | Meaning |
|---|---|
| ✅ | Implemented in Supastack |
| 🔧 | Partial — exists but incomplete |
| 🔀 | Proxy only — forward to per-instance Kong/service (`http://localhost:{portKong}/...`) |
| ❌ | Missing — needs platform-level logic |
| 🚫 | Out of scope (billing, marketplace, enterprise) |

**Coverage (297 total routes):**
| Status | Count | % |
|---|---|---|
| ✅ Covered | 34 | 11% |
| 🔧 Partial | 9 | 3% |
| 🔀 Proxy only (add route → forward to Kong) | 56 | 19% |
| ❌ Missing (needs platform-level logic) | 185 | 62% |
| 🚫 Out of scope | 13 | 4% |

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
| `/platform/signup` | POST | ❌ | Create new account | — |
| `/platform/reset-password` | POST | ❌ | Send password reset email | — |
| `/platform/update-email` | POST | ❌ | Update account email | — |

---

## Auth (Session)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/token` | POST | ✅ | Sign in with password / refresh token / PKCE | `POST /auth/login` |
| `/logout` | POST | ❌ | Sign out current session | `POST /auth/logout` (different path) |
| `/user` | GET | ❌ | Get current authenticated user | — |
| `/user` | PUT | ❌ | Update current user (email, password) | — |
| `/signup` | POST | ❌ | Register new user | — |
| `/health` | GET | 🔧 | GoTrue health check | `/health` |
| `/settings` | GET | ❌ | Get GoTrue server settings | — |
| `/otp` | POST | ❌ | Request OTP / magic link | — |
| `/recover` | POST | ❌ | Initiate password recovery | — |
| `/verify` | POST | ❌ | Verify OTP / magic link token | — |
| `/authorize` | GET | ❌ | OAuth authorize redirect | — |
| `/mfa/authenticator/assurance-level` | GET | ❌ | Get MFA assurance level for session | — |
| `/factors` | GET | ❌ | List MFA factors for current user | — |

---

## Auth Config (GoTrue settings per project)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/auth/:ref/config` | GET | ✅ | Get GoTrue auth settings (providers, JWT, etc.) | `GET /projects/:ref/config/auth` |
| `/platform/auth/:ref/config` | PATCH | ✅ | Update GoTrue auth settings | `PATCH /projects/:ref/config/auth` |
| `/platform/auth/:ref/config/hooks` | GET | ❌ | Get auth hook configs (stored in instance config/env) | — |
| `/platform/auth/:ref/config/hooks` | PATCH | ❌ | Update auth hook configs (requires env_file + restart) | — |

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

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/profile` | GET | ❌ | Get logged-in user's profile | `GET /profile` (basic) |
| `/platform/profile` | PUT | ❌ | Update profile (name, etc.) | — |
| `/platform/profile` | PATCH | ❌ | Partial update profile | — |
| `/platform/profile/permissions` | GET | ❌ | Get user's RBAC permissions | — |
| `/platform/profile/access-tokens` | GET | ❌ | List personal access tokens | `GET /auth/tokens` |
| `/platform/profile/access-tokens` | POST | ❌ | Create PAT | `POST /auth/tokens` |
| `/platform/profile/access-tokens/:id` | DELETE | ❌ | Revoke PAT | `DELETE /auth/tokens/:id` |
| `/platform/profile/scoped-access-tokens` | GET | ❌ | List scoped tokens | — |
| `/platform/profile/audit` | GET | ❌ | Get user login audit log | — |
| `/platform/profile/audit-login` | POST | ❌ | Record login audit event | — |

---

## Organizations

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations` | GET | ❌ | List user's organizations | `GET /organizations` (Supastack) |
| `/platform/organizations/:slug` | GET | ❌ | Get organization details | `GET /org` |
| `/platform/organizations/:slug` | PATCH | ❌ | Update organization (name, etc.) | `PATCH /org` |
| `/platform/organizations/:slug/projects` | GET | ❌ | List org projects (paginated) | `GET /instances` |
| `/platform/organizations/:slug/usage` | GET | ❌ | Get org usage metrics | — |
| `/platform/organizations/:slug/usage/daily` | GET | ❌ | Get daily usage breakdown | — |
| `/platform/organizations/:slug/entitlements` | GET | ❌ | Get feature entitlements | — |
| `/platform/organizations/:slug/audit` | GET | ❌ | Get org audit log | — |
| `/platform/organizations/:slug/available-versions` | GET | ❌ | List available Postgres versions | — |
| `/platform/organizations/:slug/sso` | GET | ❌ | List SSO configurations | — |

---

## Org Members

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/members` | GET | ❌ | List org members | `GET /members` |
| `/platform/organizations/:slug/members/:gotrue_id` | PATCH | ❌ | Update member role | — |
| `/platform/organizations/:slug/members/:gotrue_id` | DELETE | ❌ | Remove member | `DELETE /members/:userId` |
| `/platform/organizations/:slug/members/invitations` | GET | ❌ | List pending invitations | `GET /members/invites` |
| `/platform/organizations/:slug/members/invitations` | POST | ❌ | Send invitation | `POST /members/invites` |
| `/platform/organizations/:slug/members/invitations/:id` | DELETE | ❌ | Cancel invitation | `DELETE /members/invites/:id` |
| `/platform/organizations/:slug/members/invitations/:token` | GET | ❌ | Get invite by token | — |
| `/platform/organizations/:slug/members/invitations/:token` | POST | ❌ | Accept invitation | `POST /members/invites/accept` |
| `/platform/organizations/:slug/members/mfa/enforcement` | GET | ❌ | Get MFA policy | — |
| `/platform/organizations/:slug/members/mfa/enforcement` | PATCH | ❌ | Set MFA enforcement | — |
| `/platform/organizations/:slug/members/reached-free-project-limit` | GET | ❌ | Check free project limit | — |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | POST | ❌ | Assign role to member | — |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | DELETE | ❌ | Remove role from member | — |
| `/platform/organizations/:slug/roles` | GET | ❌ | List available roles | — |

---

## Org Billing

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/billing/subscription` | GET | 🚫 | Get current subscription plan | — |
| `/platform/organizations/:slug/billing/subscription/confirm` | POST | 🚫 | Confirm plan change | — |
| `/platform/organizations/:slug/billing/upgrade-request` | POST | 🚫 | Request plan upgrade | — |
| `/platform/organizations/:slug/billing/plans` | GET | 🚫 | List available plans | — |
| `/platform/organizations/:slug/billing/invoices` | GET | 🚫 | List invoices | — |
| `/platform/organizations/:slug/billing/invoices` | HEAD | 🚫 | Count invoices (X-Total-Count) | — |
| `/platform/organizations/:slug/billing/credits/balance` | GET | 🚫 | Get credit balance | — |
| `/platform/organizations/:slug/payments/setup-intent` | POST | 🚫 | Create Stripe setup intent | — |
| `/platform/stripe/invoices/overdue` | GET | 🚫 | List overdue invoices | — |
| `/platform/stripe/setup-intent` | POST | 🚫 | Global Stripe setup intent | — |
| `/platform/organizations/cloud-marketplace` | POST | 🚫 | Register via marketplace | — |
| `/platform/organizations/confirm-subscription` | POST | 🚫 | Confirm marketplace subscription | — |

---

## Org Apps & OAuth

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/organizations/:slug/apps` | GET | ❌ | List platform apps | — |
| `/platform/organizations/:slug/apps/installations` | GET | ❌ | List app installations | — |
| `/platform/organizations/:slug/apps/installations` | POST | ❌ | Install app | — |
| `/platform/organizations/:slug/apps/installations/:id` | DELETE | ❌ | Uninstall app | — |
| `/platform/organizations/:slug/apps/:app_id` | GET | ❌ | Get app details | — |
| `/platform/organizations/:slug/apps/:app_id` | PATCH | ❌ | Update app | — |
| `/platform/organizations/:slug/apps/:app_id` | DELETE | ❌ | Delete app | — |
| `/platform/organizations/:slug/apps/:app_id/signing-keys` | POST | ❌ | Create signing key | — |
| `/platform/organizations/:slug/apps/:app_id/signing-keys/:id` | DELETE | ❌ | Delete signing key | — |
| `/platform/organizations/:slug/oauth/apps` | GET | ❌ | List OAuth apps | `GET /api/v1/oauth/clients` (partial) |
| `/platform/organizations/:slug/oauth/apps` | POST | ❌ | Create OAuth app | — |
| `/platform/organizations/:slug/oauth/apps/:id` | GET | ❌ | Get OAuth app | — |
| `/platform/organizations/:slug/oauth/apps/:id` | DELETE | ❌ | Delete OAuth app | — |
| `/platform/organizations/:slug/oauth/apps/:id/revoke` | POST | ❌ | Revoke OAuth app | — |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets` | POST | ❌ | Create client secret | — |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets/:sid` | DELETE | ❌ | Delete client secret | — |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | ❌ | Get OAuth authorization | — |
| `/platform/oauth/authorizations/:id` | GET | ❌ | Get global OAuth authorization | — |

---

## Projects

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects` | GET | ✅ | List all projects (paginated) | `GET /instances` |
| `/platform/projects` | POST | ✅ | Create a new project | `POST /instances` |
| `/platform/projects/:ref` | GET | ✅ | Get project details | `GET /instances/:ref` |
| `/platform/projects/:ref` | PATCH | 🔧 | Update project name/settings | `PATCH /instances/:ref` |
| `/platform/projects/:ref` | DELETE | ✅ | Delete project | `DELETE /instances/:ref` |
| `/platform/projects/:ref/settings` | GET | ✅ | Get project JWT secret + API keys | included in `GET /instances/:ref` |
| `/platform/projects/:ref/api` | GET | ❌ | Get Auto API (Kong) config | — |
| `/platform/projects/:ref/api/rest` | GET | ❌ | Get REST API config | — |
| `/platform/projects/:ref/members` | GET | ❌ | List project members | — |

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
| `/platform/projects/:ref/resize` | POST | ❌ | Resize compute | — |
| `/platform/projects/:ref/db-password` | PATCH | ❌ | Reset database password | — |
| `/platform/projects/:ref/transfer` | POST | ❌ | Transfer project to another org | — |
| `/platform/projects/:ref/transfer/preview` | GET | ❌ | Preview transfer (billing impact) | — |

---

## Project Config

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/config/postgrest` | GET | ✅ | Get PostgREST config (schema, max_rows) | `GET /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/postgrest` | PATCH | ✅ | Update PostgREST config | `PATCH /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/pgbouncer` | GET | ❌ | Get pgBouncer/pooler config | — |
| `/platform/projects/:ref/config/pgbouncer` | PATCH | ❌ | Update pgBouncer config | — |
| `/platform/projects/:ref/config/pgbouncer/status` | GET | ❌ | Get pgBouncer status | `GET /api/v1/pooler/status` (partial) |
| `/platform/projects/:ref/config/realtime` | GET | ❌ | Get Realtime config | — |
| `/platform/projects/:ref/config/realtime` | PATCH | ❌ | Update Realtime config | — |
| `/platform/projects/:ref/config/storage` | GET | ❌ | Get storage config (file size limits) | — |
| `/platform/projects/:ref/config/secrets` | GET | ✅ | List project secrets | `GET /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets` | PATCH | ✅ | Upsert secrets | `POST /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets/update-status` | GET | ❌ | Get secret sync status | — |
| `/platform/projects/:ref/billing/addons` | GET | ✅ | Get project add-ons | `GET /projects/:ref/billing/addons` |

---

## Project Infrastructure

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/v1/projects/:ref/health` | GET | ✅ | Get service health statuses | `GET /instances/:ref/health` |
| `/platform/projects/:ref/databases` | GET | ❌ | List databases for project | — |
| `/platform/projects/:ref/disk` | GET | ❌ | Get disk info | — |
| `/platform/projects/:ref/disk` | POST | ❌ | Configure disk size | — |
| `/platform/projects/:ref/disk/custom-config` | GET | ❌ | Get custom disk config | — |
| `/platform/projects/:ref/disk/custom-config` | POST | ❌ | Set custom disk config | — |
| `/platform/projects/:ref/disk/util` | GET | ❌ | Get disk utilization | — |
| `/platform/projects/:ref/load-balancers` | GET | ❌ | List load balancers | — |
| `/platform/projects/:ref/read-replicas` | GET | ❌ | List read replicas | — |
| `/v1/projects/:ref/read-replicas` | GET | ❌ | List read replicas (v1) | — |
| `/platform/projects/:ref/live-queries` | GET | ❌ | List active live queries | — |
| `/platform/projects/:ref/resources/:id` | GET | ❌ | Get compute resource | — |
| `/platform/projects/:ref/resources/:id` | PATCH | ❌ | Update compute resource | — |
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
| `/platform/projects/:ref/privatelink/associations` | GET | ❌ | List PrivateLink associations | — |
| `/platform/projects/:ref/privatelink/associations/aws-account` | POST | ❌ | Create AWS PrivateLink | — |
| `/platform/projects/:ref/privatelink/associations/aws-account/:id` | GET | ❌ | Get AWS PrivateLink | — |
| `/v1/projects/:ref/custom-hostname` | GET | ❌ | Get custom domain config | — |
| `/platform/projects/:ref/settings/sensitivity` | PATCH | ❌ | Set data sensitivity level | — |

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
| `/platform/database/:ref/backups` | GET | 🔧 | List available backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/downloadable-backups` | GET | 🔧 | List downloadable backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/download` | POST | ❌ | Download a backup | — |
| `/platform/database/:ref/backups/restore` | POST | 🔧 | Restore from logical backup | `POST /projects/:ref/database/backups/restore-pitr` |
| `/platform/database/:ref/backups/pitr` | POST | ✅ | Point-in-time restore | `POST /projects/:ref/database/backups/restore-pitr` |
| `/platform/database/:ref/backups/restore-physical` | POST | ❌ | Restore physical backup | — |
| `/platform/database/:ref/backups/enable-physical-backups` | POST | ❌ | Enable physical backups | — |
| `/platform/database/:ref/clone` | POST | ❌ | Clone database to new project | — |
| `/platform/database/:ref/hook-enable` | POST | ❌ | Enable database webhooks | — |

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
| `/platform/storage/:ref/vector-buckets` | GET | ❌ | List vector buckets (Supabase-specific) | — |
| `/platform/storage/:ref/vector-buckets` | POST | ❌ | Create vector bucket | — |
| `/platform/storage/:ref/vector-buckets/:id` | DELETE | ❌ | Delete vector bucket | — |
| `/platform/storage/:ref/vector-buckets/:id/indexes` | POST | ❌ | Create vector index | — |
| `/platform/storage/:ref/vector-buckets/:id/indexes/:name` | DELETE | ❌ | Delete vector index | — |
| `/platform/storage/:ref/analytics-buckets` | GET | ❌ | List analytics buckets | — |
| `/platform/storage/:ref/analytics-buckets` | POST | ❌ | Create analytics bucket | — |
| `/platform/storage/:ref/analytics-buckets/:id` | DELETE | ❌ | Delete analytics bucket | — |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | GET | ❌ | List bucket namespaces | — |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | POST | ❌ | Create namespace | — |
| `/platform/storage/:ref/archive` | GET | ❌ | Get storage archive info | — |

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
| `/platform/projects/:ref/analytics/endpoints/usage.api-counts` | GET | 🔀 | Get API request counts | `→ Kong /analytics/v1/endpoints/usage.api-counts` |
| `/platform/projects/:ref/analytics/endpoints/usage.api-requests-count` | GET | 🔀 | Get API request totals | `→ Kong /analytics/v1/endpoints/usage.api-requests-count` |
| `/platform/projects/:ref/analytics/endpoints/functions.combined-stats` | GET | 🔀 | Get function combined stats | `→ Kong /analytics/v1/endpoints/functions.combined-stats` |
| `/platform/projects/:ref/analytics/endpoints/functions.req-stats` | GET | 🔀 | Get function request stats | `→ Kong /analytics/v1/endpoints/functions.req-stats` |
| `/platform/projects/:ref/analytics/endpoints/functions.resource-usage` | GET | 🔀 | Get function resource usage | `→ Kong /analytics/v1/endpoints/functions.resource-usage` |
| `/platform/projects/:ref/analytics/log-drains` | GET | ❌ | List log drain destinations | — |
| `/platform/projects/:ref/analytics/log-drains` | POST | ❌ | Create log drain | — |
| `/platform/projects/:ref/analytics/log-drains/:token` | PUT | ❌ | Update log drain | — |
| `/platform/projects/:ref/analytics/log-drains/:token` | DELETE | ❌ | Delete log drain | — |
| `/platform/projects/:ref/run-lints` | GET | ❌ | Run database lint checks | — |
| `/platform/projects/:ref/notifications/advisor/exceptions` | GET | ❌ | Get lint exception rules | — |

---

## Notifications

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/notifications` | GET | ❌ | List platform notifications | — |
| `/platform/notifications` | PATCH | ❌ | Mark notifications as read | — |
| `/platform/notifications/archive-all` | PATCH | ❌ | Archive all notifications | — |
| `/platform/notifications/summary` | GET | ❌ | Get notification counts | — |

---

## Replication

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/replication/:ref/sources` | GET | ❌ | List replication sources | — |
| `/platform/replication/:ref/sources/:id/tables` | GET | ❌ | List source tables | — |
| `/platform/replication/:ref/sources/:id/publications` | GET | ❌ | List source publications | — |
| `/platform/replication/:ref/sources/:id/publications` | POST | ❌ | Create publication | — |
| `/platform/replication/:ref/sources/:id/publications/:name` | DELETE | ❌ | Delete publication | — |
| `/platform/replication/:ref/destinations` | GET | ❌ | List replication destinations | — |
| `/platform/replication/:ref/destinations` | POST | ❌ | Create destination | — |
| `/platform/replication/:ref/destinations/validate` | POST | ❌ | Validate destination config | — |
| `/platform/replication/:ref/destinations/:id` | PATCH | ❌ | Update destination | — |
| `/platform/replication/:ref/destinations/:id` | DELETE | ❌ | Delete destination | — |
| `/platform/replication/:ref/pipelines` | GET | ❌ | List replication pipelines | — |
| `/platform/replication/:ref/pipelines` | POST | ❌ | Create pipeline | — |
| `/platform/replication/:ref/pipelines/validate` | POST | ❌ | Validate pipeline config | — |
| `/platform/replication/:ref/pipelines/:id` | DELETE | ❌ | Delete pipeline | — |
| `/platform/replication/:ref/pipelines/:id/start` | POST | ❌ | Start pipeline | — |
| `/platform/replication/:ref/pipelines/:id/stop` | POST | ❌ | Stop pipeline | — |
| `/platform/replication/:ref/pipelines/:id/status` | GET | ❌ | Get pipeline status | — |
| `/platform/replication/:ref/pipelines/:id/version` | GET | ❌ | Get pipeline version | — |
| `/platform/replication/:ref/pipelines/:id/replication-status` | GET | ❌ | Get replication lag / status | — |
| `/platform/replication/:ref/pipelines/:id/rollback-tables` | POST | ❌ | Rollback specific tables | — |
| `/platform/replication/:ref/destinations-pipelines` | POST | ❌ | Create destination+pipeline together | — |
| `/platform/replication/:ref/destinations-pipelines/:did/:pid` | DELETE | ❌ | Delete destination+pipeline | — |
| `/platform/replication/:ref/tenants` | GET | ❌ | List tenants | — |
| `/platform/replication/:ref/tenants` | DELETE | ❌ | Delete tenant | — |
| `/platform/replication/:ref/tenants-sources` | POST | ❌ | Create tenant source | — |

---

## Integrations

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/integrations` | GET | ❌ | List global integrations | — |
| `/platform/integrations/:slug` | GET | ❌ | List org integrations | — |
| `/platform/integrations/github/authorization` | GET | ❌ | Get GitHub app auth status | — |
| `/platform/integrations/github/connections` | GET | ❌ | List GitHub connections | — |
| `/platform/integrations/github/repositories` | GET | ❌ | List GitHub repos | — |

---

## Telemetry & Feature Flags

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/telemetry/feature-flags` | GET | ❌ | Get feature flag values | — |
| `/platform/projects-resource-warnings` | GET | ❌ | Get resource warning alerts | — |
| `/platform/deployment-mode` | GET | ❌ | Get deployment mode (cloud/self-hosted) | — |

---

## Project Misc (UI / Content / Branches)

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/projects/:ref/content` | GET | ❌ | List saved SQL queries/snippets | — |
| `/platform/projects/:ref/content` | POST | ❌ | Save a SQL snippet | — |
| `/platform/projects/:ref/content/count` | GET | ❌ | Count content items | — |
| `/platform/projects/:ref/content/folders` | GET | ❌ | List content folders | — |
| `/platform/projects/:ref/content/folders/:id` | GET | ❌ | Get content folder | — |
| `/platform/projects/:ref/content/item/:id` | GET | ❌ | Get specific content item | — |
| `/platform/projects/:ref/service-versions` | GET | ❌ | Get version info for each service | — |
| `/platform/projects/:ref/api-keys/temporary` | GET | ❌ | Get short-lived API keys | — |
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

## Feedback

| SUPABASE API | HTTP_METHOD | COVERED | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|
| `/platform/feedback/send` | POST | ❌ | Send general feedback | — |
| `/platform/feedback/upgrade` | POST | ❌ | Send upgrade feedback | — |
| `/platform/feedback/downgrade` | POST | ❌ | Send downgrade feedback | — |
| `/platform/feedback/conversations/:id/custom-fields` | PATCH | ❌ | Update feedback conversation fields | — |
