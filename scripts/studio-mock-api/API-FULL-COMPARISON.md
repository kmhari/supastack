# Supabase Studio API vs Supastack — Full Coverage

**Legend — `COVERED`:**
| Symbol | Meaning |
|---|---|
| ✅ | Real, working coverage — a backing supastack endpoint, a Kong proxy, or a functional GoTrue route |
| ⚠️ | **Not real coverage** — a **stub** (supastack/gotrue route that returns empty/static or is config-disabled) **or mock-only** (real api 404s; only the dev mock's catch-all answers). Don't rely on it. |

**Legend — `COVERED BY`:**
| Value | Meaning |
|---|---|
| `supastack` | Endpoint in the control-plane api (`apps/api`). ✅ = real backing; ⚠️ = stub (flagged "(stub)" / "(empty)"). |
| `proxy` | Forwarded to the per-instance Kong gateway (`http://localhost:{portKong}/...`). All real (✅). |
| `gotrue` | Served by the control-plane GoTrue at `/auth/v1/*` (Caddy → `auth:9999`). ✅ = functional; ⚠️ = config-disabled (`signup`, `authorize`). |
| `mock` | Only the dev mock (`scripts/studio-mock-api/server.js`) answers via its `/platform/*` + `/v1/*` catch-all; **not** in the real api (⚠️ gap). |

> Updated for **feature 084** (control-plane GoTrue auth + multi-tenant orgs + Cloud RBAC) and **feature 025** (shared Studio `IS_PLATFORM=true`). Human session auth is served by a real GoTrue at `/auth/v1/*`; profile, organizations, members, invitations, roles and PATs are real platform endpoints at `/api/v1/platform/*`; feature 025 added a broad set of `supastack` **stubs** (⚠️) so Studio's pages render pending real backends.

**Coverage (302 total rows):**

| Covered by | Total | ✅ real | ⚠️ stub/gap/broken |
|---|---|---|---|
| `supastack` | 200 | 61 | 139 |
| `proxy` → Kong | 48 | 48 | 0 |
| `gotrue` | 21 | 19 | 2 |
| `mock` | 33 | 0 | 33 |
| **Total** | **302** | **128 (42%)** | **174 (58%)** |

→ **✅ 124 / 302 (41%)** real, working coverage · **⚠️ 178 (59%)** not-real = stubs + 35 mock-only gaps + 2 broken (auth-config case mismatch).

---

## API Keys

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/v1/projects/:ref/api-keys` | GET | ✅ | supastack | List anon + service_role keys | `GET /projects/:ref/api-keys` |
| `/v1/projects/:ref/api-keys/:id` | PATCH | ⚠️ | mock | Update key name/description | — |
| `/v1/projects/:ref/api-keys/:id` | DELETE | ⚠️ | mock | Delete custom API key | — |

---

## Account

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/signup` | POST | ⚠️ | supastack | Create new account (signups disabled — `GOTRUE_DISABLE_SIGNUP`) | `POST /api/v1/platform/signup` (stub) |
| `/platform/reset-password` | POST | ✅ | supastack | Send password reset email (GoTrue recover, SMTP-gated) | `POST /api/v1/platform/reset-password` |
| `/platform/update-email` | POST | ⚠️ | supastack | Update account email | `POST /api/v1/platform/update-email` (stub) |

---

## Auth (Session)

> Feature 084: served by the real control-plane GoTrue at `/auth/v1/*` (Caddy → `auth:9999`). No more `sb_sid` session / `studio-gotrue` shim. **TOTP MFA (enroll → challenge → verify → unenroll) works natively** — verified live on supaviser.dev; nothing was built for it. Only the org-level *MFA enforcement policy* (`/members/mfa/enforcement`) remains a stub.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/token` | POST | ✅ | gotrue | Sign in with password / refresh token / PKCE | `→ GoTrue /auth/v1/token` |
| `/logout` | POST | ✅ | gotrue | Sign out current session | `→ GoTrue /auth/v1/logout` |
| `/user` | GET | ✅ | gotrue | Get current authenticated user | `→ GoTrue /auth/v1/user` |
| `/user` | PUT | ✅ | gotrue | Update current user (email, password) | `→ GoTrue /auth/v1/user` |
| `/signup` | POST | ⚠️ | gotrue | Register new user (disabled — `GOTRUE_DISABLE_SIGNUP`) | `→ GoTrue /auth/v1/signup` |
| `/health` | GET | ✅ | gotrue | GoTrue health check | `→ GoTrue /auth/v1/health` |
| `/settings` | GET | ✅ | gotrue | Get GoTrue server settings | `→ GoTrue /auth/v1/settings` |
| `/otp` | POST | ✅ | gotrue | Request OTP / magic link (SMTP-gated) | `→ GoTrue /auth/v1/otp` |
| `/recover` | POST | ✅ | gotrue | Initiate password recovery (SMTP-gated) | `→ GoTrue /auth/v1/recover` |
| `/verify` | POST | ✅ | gotrue | Verify OTP / magic link token | `→ GoTrue /auth/v1/verify` |
| `/authorize` | GET | ⚠️ | gotrue | OAuth authorize redirect (no social providers configured) | `→ GoTrue /auth/v1/authorize` |
| `/factors` | POST | ✅ | gotrue | Enroll a TOTP MFA factor (returns QR/secret) — GoTrue native | `→ GoTrue /auth/v1/factors` |
| `/factors/:id/challenge` | POST | ✅ | gotrue | Create an MFA challenge — GoTrue native | `→ GoTrue /auth/v1/factors/:id/challenge` |
| `/factors/:id/verify` | POST | ✅ | gotrue | Verify an MFA challenge code — GoTrue native | `→ GoTrue /auth/v1/factors/:id/verify` |
| `/factors/:id` | DELETE | ✅ | gotrue | Unenroll an MFA factor — GoTrue native | `→ GoTrue /auth/v1/factors/:id` |
| `/factors` | GET | ✅ | gotrue | List MFA factors (via user object) — GoTrue native | `→ GoTrue /auth/v1/user` |
| `/mfa/authenticator/assurance-level` | GET | ✅ | gotrue | Get MFA assurance level (AAL) — GoTrue native | `→ GoTrue /auth/v1/...` |

---

## Auth Config (GoTrue settings per project)

> ✅ **Fixed by feature 085.** The bridge (`platform-misc.ts`) now translates field-name case at the platform edge (`auth-config-case.ts`): Studio's UPPERCASE GoTrue-config names ↔ the strict-lowercase Management API. Clean case-flip over the 134+ `env-field-mapper` keys; `_supastack` meta excluded; unknown fields pass through so the strict schema still reports them. The bridge re-injects via `/v1` so validation **400 + details** surface (was masked as 500). `/config/hooks` GET/PATCH created (scoped view/write over the `hook_*` subset, reusing feature 082 validation). The Management API `/v1/*` path (CLI, lowercase) is untouched. GoTrue exposes **no** config-write API — config is env-driven (verified: `/admin/config` 404), so the env-rewrite+restart mechanism is correct.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/auth/:ref/config` | GET | ✅ | supastack | Get GoTrue auth settings (UPPERCASE-translated for Studio) | `GET /api/v1/platform/auth/:ref/config` |
| `/platform/auth/:ref/config` | PATCH | ✅ | supastack | Update GoTrue auth settings (Studio UPPERCASE → /v1 lowercase) | `PATCH /api/v1/platform/auth/:ref/config` |
| `/platform/auth/:ref/config/hooks` | GET | ✅ | supastack | Get auth-hook config (`hook_*` subset, UPPERCASE) | `GET /api/v1/platform/auth/:ref/config/hooks` |
| `/platform/auth/:ref/config/hooks` | PATCH | ✅ | supastack | Update auth-hook config (routes through `config/auth`) | `PATCH /api/v1/platform/auth/:ref/config/hooks` |

---

## Auth Management (GoTrue admin — per project users)

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/auth/:ref/users` | GET | ✅ | proxy | List project's GoTrue users | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/:ref/users` | POST | ✅ | proxy | Create a GoTrue user | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/:ref/users/:id` | GET | ✅ | proxy | Get user by ID | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id` | PUT | ✅ | proxy | Update user (ban, role, metadata) | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id` | DELETE | ✅ | proxy | Delete user | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id/factors` | GET | ✅ | proxy | List user's MFA factors | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/:ref/users/:id/factors` | DELETE | ✅ | proxy | Delete user's MFA factors | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/:ref/invite` | POST | ✅ | proxy | Send invite email via GoTrue | `→ Kong /auth/v1/invite` |
| `/platform/auth/:ref/magiclink` | POST | ✅ | proxy | Send magic link via GoTrue | `→ Kong /auth/v1/magiclink` |
| `/platform/auth/:ref/otp` | POST | ✅ | proxy | Send OTP via GoTrue | `→ Kong /auth/v1/otp` |
| `/platform/auth/:ref/recover` | POST | ✅ | proxy | Send password recovery via GoTrue | `→ Kong /auth/v1/recover` |
| `/platform/auth/:ref/templates/:template/reset` | POST | ✅ | proxy | Reset email template to default | `→ Kong /auth/v1/admin/templates` |
| `/platform/auth/:ref/validate/spam` | POST | ✅ | proxy | Validate spam / abuse | `→ Kong /auth/v1/admin/validate/spam` |

---

## GoTrue Admin (direct)

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/admin/users` | GET | ✅ | proxy | List all users (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users` | POST | ✅ | proxy | Create user (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users/:id` | GET | ✅ | proxy | Get user by ID (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | PUT | ✅ | proxy | Update user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | DELETE | ✅ | proxy | Delete user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:uid/factors/:fid` | DELETE | ✅ | proxy | Delete user factor (admin) | `→ Kong /auth/v1/admin/users/:uid/factors/:fid` |
| `/admin/factors` | GET | ✅ | proxy | List all factors (admin) | `→ Kong /auth/v1/admin/factors` |

---

## Profile

> Feature 084: real, backed by `auth.users` (GoTrue) + `api_tokens`.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/profile` | GET | ✅ | supastack | Get logged-in user's profile (+ `disabled_features`) | `GET /api/v1/platform/profile` |
| `/platform/profile` | PUT | ✅ | supastack | Update profile (name, etc.) | `PUT /api/v1/platform/profile` |
| `/platform/profile` | PATCH | ✅ | supastack | Partial update profile | `PATCH /api/v1/platform/profile` |
| `/platform/profile/permissions` | GET | ✅ | supastack | Get user's RBAC permissions (per-org) | `GET /api/v1/platform/profile/permissions` |
| `/platform/profile/access-tokens` | GET | ✅ | supastack | List personal access tokens | `GET /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens` | POST | ✅ | supastack | Create PAT | `POST /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens/:id` | DELETE | ✅ | supastack | Revoke PAT | `DELETE /api/v1/platform/profile/access-tokens/:id` |
| `/platform/profile/scoped-access-tokens` | GET | ⚠️ | supastack | List scoped tokens | `GET /api/v1/platform/profile/scoped-access-tokens` (stub) |
| `/platform/profile/audit` | GET | ⚠️ | supastack | Get user login audit log | `GET /api/v1/platform/profile/audit` (stub) |
| `/platform/profile/audit-login` | POST | ⚠️ | supastack | Record login audit event | `POST /api/v1/platform/profile/audit-login` (stub) |

---

## Organizations

> Feature 084: real multi-tenant orgs. Org id = 20-char ref (not uuid). `slug` == id.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/organizations` | GET | ✅ | supastack | List user's organizations (all memberships) | `GET /api/v1/platform/organizations` |
| `/platform/organizations` | POST | ✅ | supastack | Create an organization (creator → owner) | `POST /api/v1/platform/organizations` |
| `/platform/organizations/preview-creation` | POST | ⚠️ | supastack | Preview org creation (validation) | `POST /api/v1/platform/organizations/preview-creation` (stub) |
| `/platform/organizations/:slug` | GET | ✅ | supastack | Get organization details | `GET /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug` | PATCH | ✅ | supastack | Update organization (name) | `PATCH /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug` | DELETE | ✅ | supastack | Delete organization (refused if it owns projects) | `DELETE /api/v1/platform/organizations/:slug` |
| `/platform/organizations/:slug/projects` | GET | ✅ | supastack | List org projects (paginated, org-scoped authz) | `GET /api/v1/platform/organizations/:slug/projects` |
| `/platform/organizations/:slug/available-versions` | GET | ⚠️ | supastack | List available Postgres versions | `GET .../organizations/:slug/available-versions` (stub) |
| `/platform/organizations/:slug/usage` | GET | ⚠️ | supastack | Get org usage metrics | `GET .../organizations/:slug/usage` (stub) |
| `/platform/organizations/:slug/usage/daily` | GET | ⚠️ | supastack | Get daily usage breakdown | `GET .../organizations/:slug/usage/daily` (stub) |
| `/platform/organizations/:slug/entitlements` | GET | ⚠️ | supastack | Get feature entitlements | `GET .../organizations/:slug/entitlements` (stub) |
| `/platform/organizations/:slug/audit` | GET | ⚠️ | supastack | Get org audit log | `GET .../organizations/:slug/audit` (stub) |
| `/platform/organizations/:slug/sso` | GET | ⚠️ | mock | List SSO configurations | — |

---

## Org Members

> Feature 084: real members + invitations + numeric-id roles (Owner/Administrator/Developer/Read-only).

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/organizations/:slug/members` | GET | ✅ | supastack | List org members (with `role_ids[]`) | `GET .../organizations/:slug/members` |
| `/platform/organizations/:slug/members/:gotrue_id` | PATCH | ✅ | gotrue | Update member role | `PATCH .../members/:gotrue_id` |
| `/platform/organizations/:slug/members/:gotrue_id` | DELETE | ✅ | gotrue | Remove member (last-owner guard) | `DELETE .../members/:gotrue_id` |
| `/platform/organizations/:slug/members/invitations` | GET | ✅ | supastack | List pending invitations | `GET .../members/invitations` |
| `/platform/organizations/:slug/members/invitations` | POST | ✅ | supastack | Send invitation (SMTP-gated) | `POST .../members/invitations` |
| `/platform/organizations/:slug/members/invitations/:id` | DELETE | ✅ | supastack | Cancel invitation | `DELETE .../members/invitations/:id` |
| `/platform/organizations/:slug/members/invitations/:token` | GET | ✅ | supastack | Get invite by token | `GET .../members/invitations/:token` |
| `/platform/organizations/:slug/members/invitations/:token` | POST | ✅ | supastack | Accept invitation | `POST .../members/invitations/:token` |
| `/platform/organizations/:slug/members/mfa/enforcement` | GET | ⚠️ | supastack | Get MFA policy (MFA out of scope) | `GET .../members/mfa/enforcement` (stub) |
| `/platform/organizations/:slug/members/mfa/enforcement` | PATCH | ⚠️ | supastack | Set MFA enforcement (MFA out of scope) | `PATCH .../members/mfa/enforcement` (stub) |
| `/platform/organizations/:slug/members/reached-free-project-limit` | GET | ⚠️ | supastack | Check free project limit | `GET .../members/reached-free-project-limit` (stub) |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | POST | ✅ | gotrue | Assign role to member | `POST .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | DELETE | ✅ | gotrue | Remove role from member | `DELETE .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/:slug/roles` | GET | ✅ | supastack | List available roles (4 numeric-id objects) | `GET .../organizations/:slug/roles` |

---

## Org Billing

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/organizations/:slug/billing/subscription` | GET | ⚠️ | supastack | Get current subscription plan (always Free) | `GET .../billing/subscription` (stub) |
| `/platform/organizations/:slug/billing/subscription/confirm` | POST | ⚠️ | mock | Confirm plan change | — |
| `/platform/organizations/:slug/billing/upgrade-request` | POST | ⚠️ | mock | Request plan upgrade | — |
| `/platform/organizations/:slug/billing/plans` | GET | ⚠️ | supastack | List available plans (Free only) | `GET .../billing/plans` (stub) |
| `/platform/organizations/:slug/billing/invoices` | GET | ⚠️ | supastack | List invoices (empty) | `GET .../billing/invoices` (stub) |
| `/platform/organizations/:slug/billing/invoices` | HEAD | ⚠️ | mock | Count invoices (X-Total-Count) | — |
| `/platform/organizations/:slug/billing/credits/balance` | GET | ⚠️ | supastack | Get credit balance (zero) | `GET .../billing/credits/balance` (stub) |
| `/platform/organizations/:slug/payments/setup-intent` | POST | ⚠️ | mock | Create Stripe setup intent | — |
| `/platform/stripe/invoices/overdue` | GET | ⚠️ | mock | List overdue invoices | — |
| `/platform/stripe/setup-intent` | POST | ⚠️ | mock | Global Stripe setup intent | — |
| `/platform/organizations/cloud-marketplace` | POST | ⚠️ | mock | Register via marketplace | — |
| `/platform/organizations/confirm-subscription` | POST | ⚠️ | mock | Confirm marketplace subscription | — |

---

## Org Apps & OAuth

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/organizations/:slug/apps` | GET | ⚠️ | supastack | List platform apps (empty) | `GET .../apps` (stub) |
| `/platform/organizations/:slug/apps/installations` | GET | ⚠️ | supastack | List app installations (empty) | `GET .../apps/installations` (stub) |
| `/platform/organizations/:slug/apps/installations` | POST | ⚠️ | supastack | Install app | `POST .../apps/installations` (stub) |
| `/platform/organizations/:slug/apps/installations/:id` | DELETE | ⚠️ | supastack | Uninstall app | `DELETE .../apps/installations/:id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | GET | ⚠️ | supastack | Get app details | `GET .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | PATCH | ⚠️ | supastack | Update app | `PATCH .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id` | DELETE | ⚠️ | supastack | Delete app | `DELETE .../apps/:app_id` (stub) |
| `/platform/organizations/:slug/apps/:app_id/signing-keys` | POST | ⚠️ | supastack | Create signing key | `POST .../apps/:app_id/signing-keys` (stub) |
| `/platform/organizations/:slug/apps/:app_id/signing-keys/:id` | DELETE | ⚠️ | supastack | Delete signing key | `DELETE .../signing-keys/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps` | GET | ⚠️ | supastack | List OAuth apps | `GET .../oauth/apps` (stub; real OAuth clients at `/api/v1/oauth/*`) |
| `/platform/organizations/:slug/oauth/apps` | POST | ⚠️ | supastack | Create OAuth app | `POST .../oauth/apps` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id` | GET | ⚠️ | supastack | Get OAuth app | `GET .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id` | DELETE | ⚠️ | supastack | Delete OAuth app | `DELETE .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/revoke` | POST | ⚠️ | supastack | Revoke OAuth app | `POST .../oauth/apps/:id/revoke` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets` | POST | ⚠️ | supastack | Create client secret | `POST .../client-secrets` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id/client-secrets/:sid` | DELETE | ⚠️ | supastack | Delete client secret | `DELETE .../client-secrets/:sid` (stub) |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | ⚠️ | supastack | Get OAuth authorization | `GET .../oauth/authorizations/:id` (stub) |
| `/platform/oauth/authorizations/:id` | GET | ⚠️ | supastack | Get global OAuth authorization | `GET /platform/oauth/authorizations/:id` (stub) |

---

## Projects

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects` | GET | ✅ | supastack | List all projects (paginated) | `GET /instances` |
| `/platform/projects` | POST | ✅ | supastack | Create a new project (org-scoped) | `POST /instances` |
| `/platform/projects/:ref` | GET | ✅ | supastack | Get project details | `GET /instances/:ref` |
| `/platform/projects/:ref` | PATCH | ⚠️ | supastack | Update project name/settings | `PATCH /instances/:ref` |
| `/platform/projects/:ref` | DELETE | ✅ | supastack | Delete project | `DELETE /instances/:ref` |
| `/platform/projects/:ref/settings` | GET | ✅ | supastack | jwt_secret + service_api_keys (anon/service_role) + db host/port/user | `GET /api/v1/platform/projects/:ref/settings` |
| `/platform/projects/:ref/api` | GET | ⚠️ | supastack | Get Auto API (Kong) config | `GET .../projects/:ref/api` (stub) |
| `/platform/projects/:ref/api/rest` | GET | ⚠️ | supastack | Get REST API config | `GET .../projects/:ref/api/rest` (stub) |
| `/platform/projects/:ref/members` | GET | ⚠️ | supastack | List project members | `GET .../projects/:ref/members` (stub) |

---

## Project Lifecycle

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects/:ref/pause` | POST | ✅ | supastack | Pause a project | `POST /projects/:ref/pause` |
| `/platform/projects/:ref/pause/status` | GET | ⚠️ | mock | Get pause status | — |
| `/platform/projects/:ref/restart` | POST | ✅ | supastack | Restart a project | `POST /instances/:ref/restart` |
| `/platform/projects/:ref/restart-services` | POST | ⚠️ | supastack | Restart specific services | `POST /instances/:ref/restart` |
| `/platform/projects/:ref/restore` | POST | ✅ | supastack | Restore a paused project | `POST /projects/:ref/restore` |
| `/platform/projects/:ref/restore/versions` | GET | ⚠️ | mock | List restore versions | — |
| `/platform/projects/:ref/resize` | POST | ⚠️ | supastack | Resize compute | `POST .../projects/:ref/resize` (stub) |
| `/platform/projects/:ref/db-password` | PATCH | ⚠️ | supastack | Reset database password | `PATCH .../projects/:ref/db-password` (stub) |
| `/platform/projects/:ref/transfer` | POST | ⚠️ | supastack | Transfer project to another org | `POST .../projects/:ref/transfer` (stub) |
| `/platform/projects/:ref/transfer/preview` | GET | ⚠️ | supastack | Preview transfer (billing impact) | `GET .../projects/:ref/transfer/preview` (stub) |

---

## Project Config

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects/:ref/config/postgrest` | GET | ✅ | supastack | Get PostgREST config (schema, max_rows) | `GET /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/postgrest` | PATCH | ✅ | supastack | Update PostgREST config | `PATCH /projects/:ref/postgrest` |
| `/platform/projects/:ref/config/pgbouncer` | GET | ⚠️ | mock | Get pgBouncer/pooler config | — |
| `/platform/projects/:ref/config/pgbouncer` | PATCH | ⚠️ | supastack | Update pgBouncer config | `PATCH .../config/pgbouncer` (stub) |
| `/platform/projects/:ref/config/pgbouncer/status` | GET | ⚠️ | supastack | Get pgBouncer status | `GET /api/v1/pooler/status` (partial) |
| `/platform/projects/:ref/config/realtime` | GET | ⚠️ | supastack | Get Realtime config | `GET .../config/realtime` (stub) |
| `/platform/projects/:ref/config/realtime` | PATCH | ⚠️ | supastack | Update Realtime config | `PATCH .../config/realtime` (stub) |
| `/platform/projects/:ref/config/storage` | GET | ⚠️ | supastack | Get storage config (file size limits) | `GET .../config/storage` (stub) |
| `/platform/projects/:ref/config/secrets` | GET | ✅ | supastack | List project secrets | `GET /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets` | PATCH | ✅ | supastack | Upsert secrets | `POST /projects/:ref/secrets` |
| `/platform/projects/:ref/config/secrets/update-status` | GET | ⚠️ | mock | Get secret sync status | — |
| `/platform/projects/:ref/billing/addons` | GET | ✅ | supastack | Get project add-ons | `GET /projects/:ref/billing/addons` |

---

## Project Infrastructure

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/v1/projects/:ref/health` | GET | ✅ | supastack | Get service health statuses | `GET /instances/:ref/health` |
| `/platform/projects/:ref/databases` | GET | ⚠️ | supastack | List databases for project | `GET .../projects/:ref/databases` (stub) |
| `/platform/projects/:ref/disk` | GET | ⚠️ | supastack | Get disk info | `GET .../projects/:ref/disk` (stub) |
| `/platform/projects/:ref/disk` | POST | ⚠️ | supastack | Configure disk size | `POST .../projects/:ref/disk` (stub) |
| `/platform/projects/:ref/disk/custom-config` | GET | ⚠️ | supastack | Get custom disk config | `GET .../disk/custom-config` (stub) |
| `/platform/projects/:ref/disk/custom-config` | POST | ⚠️ | supastack | Set custom disk config | `POST .../disk/custom-config` (stub) |
| `/platform/projects/:ref/disk/util` | GET | ⚠️ | supastack | Get disk utilization | `GET .../disk/util` (stub) |
| `/platform/projects/:ref/load-balancers` | GET | ⚠️ | mock | List load balancers | — |
| `/platform/projects/:ref/read-replicas` | GET | ⚠️ | supastack | List read replicas (empty) | `GET .../read-replicas` (stub) |
| `/v1/projects/:ref/read-replicas` | GET | ⚠️ | mock | List read replicas (v1) | — |
| `/platform/projects/:ref/live-queries` | GET | ⚠️ | supastack | List active live queries (empty) | `GET .../live-queries` (stub) |
| `/platform/projects/:ref/resources/:id` | GET | ⚠️ | supastack | Get compute resource | `GET .../resources/:id` (stub) |
| `/platform/projects/:ref/resources/:id` | PATCH | ⚠️ | supastack | Update compute resource | `PATCH .../resources/:id` (stub) |
| `/platform/projects/:ref/infra-monitoring` | GET | ⚠️ | mock | Get infra monitoring data | — |
| `/platform/projects/:ref/daily-stats` | GET | ⚠️ | mock | Get daily usage stats | — |
| `/v1/projects/:ref/upgrade/eligibility` | GET | ⚠️ | mock | Check upgrade eligibility | — |
| `/v1/projects/:ref/upgrade/status` | GET | ⚠️ | mock | Get upgrade status | — |

---

## Network & Security

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/v1/projects/:ref/network-bans/retrieve` | POST | ⚠️ | mock | Get banned IP addresses | — |
| `/v1/projects/:ref/network-bans` | DELETE | ⚠️ | mock | Remove IP ban | — |
| `/v1/projects/:ref/network-restrictions` | GET | ⚠️ | mock | Get network firewall rules | — |
| `/v1/projects/:ref/network-restrictions/apply` | POST | ⚠️ | mock | Apply firewall rules | — |
| `/platform/projects/:ref/privatelink/associations` | GET | ⚠️ | supastack | List PrivateLink associations (empty) | `GET .../privatelink/associations` (stub) |
| `/platform/projects/:ref/privatelink/associations/aws-account` | POST | ⚠️ | supastack | Create AWS PrivateLink | `POST .../privatelink/associations/aws-account` (stub) |
| `/platform/projects/:ref/privatelink/associations/aws-account/:id` | GET | ⚠️ | supastack | Get AWS PrivateLink | `GET .../aws-account/:id` (stub) |
| `/v1/projects/:ref/custom-hostname` | GET | ⚠️ | mock | Get custom domain config | — |
| `/platform/projects/:ref/settings/sensitivity` | PATCH | ⚠️ | supastack | Set data sensitivity level | `PATCH .../settings/sensitivity` (stub) |

---

## Database (Schema / SQL)

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/pg-meta/:ref/query` | POST | ✅ | proxy | Execute SQL query | `→ Kong /pg-meta/v0/query` |
| `/platform/pg-meta/:ref/tables` | GET | ✅ | proxy | List tables | `→ Kong /pg-meta/v0/tables` |
| `/platform/pg-meta/:ref/views` | GET | ✅ | proxy | List views | `→ Kong /pg-meta/v0/views` |
| `/platform/pg-meta/:ref/columns` | GET | ✅ | proxy | List columns | `→ Kong /pg-meta/v0/columns` |
| `/platform/pg-meta/:ref/schemas` | GET | ✅ | proxy | List schemas | `→ Kong /pg-meta/v0/schemas` |
| `/platform/pg-meta/:ref/policies` | GET | ✅ | proxy | List RLS policies | `→ Kong /pg-meta/v0/policies` |
| `/platform/pg-meta/:ref/types` | GET | ✅ | proxy | List custom types | `→ Kong /pg-meta/v0/types` |
| `/platform/pg-meta/:ref/functions` | GET | ✅ | proxy | List database functions | `→ Kong /pg-meta/v0/functions` |
| `/platform/pg-meta/:ref/publications` | GET | ✅ | proxy | List publications | `→ Kong /pg-meta/v0/publications` |
| `/platform/pg-meta/:ref/triggers` | GET | ✅ | proxy | List triggers | `→ Kong /pg-meta/v0/triggers` |
| `/platform/pg-meta/:ref/materialized-views` | GET | ✅ | proxy | List materialized views | `→ Kong /pg-meta/v0/materialized-views` |
| `/platform/pg-meta/:ref/column-privileges` | GET | ✅ | proxy | List column privileges | `→ Kong /pg-meta/v0/column-privileges` |
| `/v1/projects/:ref/database/query` | POST | ✅ | supastack | Run ad-hoc SQL (CLI compat) | `POST /projects/:ref/database/query` |

---

## Backups

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/database/:ref/backups` | GET | ✅ | supastack | List available backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/downloadable-backups` | GET | ⚠️ | supastack | List downloadable backups | `GET /projects/:ref/database/backups` |
| `/platform/database/:ref/backups/download` | POST | ⚠️ | supastack | Download a backup | `POST .../backups/download` (stub) |
| `/platform/database/:ref/backups/restore` | POST | ✅ | supastack | Restore from logical backup (async worker) | `POST .../backups/restore` |
| `/platform/database/:ref/backups/pitr` | POST | ✅ | supastack | Point-in-time restore | `POST .../backups/restore-pitr` |
| `/platform/database/:ref/backups/restore-physical` | POST | ⚠️ | supastack | Restore physical backup | `POST .../backups/restore-physical` (stub) |
| `/platform/database/:ref/backups/enable-physical-backups` | POST | ⚠️ | mock | Enable physical backups | — |
| `/platform/database/:ref/clone` | POST | ⚠️ | supastack | Clone database to new project | `POST .../database/:ref/clone` (stub) |
| `/platform/database/:ref/hook-enable` | POST | ⚠️ | supastack | Enable database webhooks | `POST .../database/:ref/hook-enable` (stub) |

---

## Storage

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/storage/:ref/buckets` | GET | ✅ | supastack | List storage buckets | `GET /projects/:ref/storage/buckets` |
| `/platform/storage/:ref/buckets/:id` | GET | ✅ | proxy | Get bucket details | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id` | PATCH | ✅ | proxy | Update bucket settings | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id` | DELETE | ✅ | proxy | Delete bucket | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/:ref/buckets/:id/empty` | POST | ✅ | proxy | Empty bucket contents | `→ Kong /storage/v1/bucket/:id/empty` |
| `/platform/storage/:ref/buckets/:id/objects/list` | POST | ✅ | proxy | List objects in bucket | `→ Kong /storage/v1/object/list/:id` |
| `/platform/storage/:ref/buckets/:id/objects/sign` | POST | ✅ | proxy | Create signed URL | `→ Kong /storage/v1/object/sign/:id/*` |
| `/platform/storage/:ref/buckets/:id/objects/sign-multi` | POST | ✅ | proxy | Create multiple signed URLs | `→ Kong /storage/v1/object/sign` |
| `/platform/storage/:ref/buckets/:id/objects/public-url` | POST | ✅ | proxy | Get public object URL | `→ Kong /storage/v1/object/public/:id/*` |
| `/platform/storage/:ref/buckets/:id/objects/move` | POST | ✅ | proxy | Move object | `→ Kong /storage/v1/object/move` |
| `/platform/storage/:ref/buckets/:id/objects` | DELETE | ✅ | proxy | Delete objects | `→ Kong /storage/v1/object/:id` |
| `/platform/storage/:ref/credentials` | GET | ✅ | proxy | List storage S3 credentials | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/:ref/credentials` | POST | ✅ | proxy | Create storage S3 credential | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/:ref/credentials/:id` | DELETE | ✅ | proxy | Delete storage S3 credential | `→ Kong /storage/v1/s3/accesskey/:id` |
| `/platform/storage/:ref/vector-buckets` | GET | ⚠️ | supastack | List vector buckets (empty) | `GET .../vector-buckets` (stub) |
| `/platform/storage/:ref/vector-buckets` | POST | ⚠️ | supastack | Create vector bucket | `POST .../vector-buckets` (stub) |
| `/platform/storage/:ref/vector-buckets/:id` | DELETE | ⚠️ | supastack | Delete vector bucket | `DELETE .../vector-buckets/:id` (stub) |
| `/platform/storage/:ref/vector-buckets/:id/indexes` | POST | ⚠️ | supastack | Create vector index | `POST .../vector-buckets/:id/indexes` (stub) |
| `/platform/storage/:ref/vector-buckets/:id/indexes/:name` | DELETE | ⚠️ | supastack | Delete vector index | `DELETE .../indexes/:name` (stub) |
| `/platform/storage/:ref/analytics-buckets` | GET | ⚠️ | supastack | List analytics buckets (empty) | `GET .../analytics-buckets` (stub) |
| `/platform/storage/:ref/analytics-buckets` | POST | ⚠️ | supastack | Create analytics bucket | `POST .../analytics-buckets` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id` | DELETE | ⚠️ | supastack | Delete analytics bucket | `DELETE .../analytics-buckets/:id` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | GET | ⚠️ | supastack | List bucket namespaces | `GET .../namespaces` (stub) |
| `/platform/storage/:ref/analytics-buckets/:id/namespaces` | POST | ⚠️ | supastack | Create namespace | `POST .../namespaces` (stub) |
| `/platform/storage/:ref/archive` | GET | ⚠️ | supastack | Get storage archive info | `GET .../storage/:ref/archive` (stub) |

---

## Edge Functions

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/v1/projects/:ref/functions` | GET | ✅ | supastack | List edge functions | `GET /projects/:ref/functions` |
| `/v1/projects/:ref/functions` | POST | ⚠️ | supastack | Deploy edge function | `POST /projects/:ref/functions/deploy` |
| `/v1/projects/:ref/functions/:slug` | GET | ✅ | supastack | Get function details | `GET /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | PATCH | ⚠️ | supastack | Update function (name, verify_jwt) | `POST /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | DELETE | ✅ | supastack | Delete function | `DELETE /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug/body` | GET | ✅ | supastack | Download function source | `GET /projects/:ref/functions/:slug/body` |
| `/v1/projects/:ref/functions/deployed-size` | GET | ⚠️ | mock | Get total deployed size | — |

---

## Secrets

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/v1/projects/:ref/secrets` | GET | ✅ | supastack | List secrets (SHA256 masked) | `GET /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | POST | ✅ | supastack | Set / upsert secrets | `POST /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | DELETE | ✅ | supastack | Delete secrets | `DELETE /projects/:ref/secrets` |

---

## Analytics & Logs

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects/:ref/analytics/endpoints/logs.all` | GET | ✅ | supastack | Query all logs | `GET /projects/:ref/analytics/endpoints/logs.all` |
| `/platform/projects/:ref/analytics/endpoints/logs.all.otel` | GET | ✅ | proxy | Query OpenTelemetry logs | `→ Kong /analytics/v1/otel/logs` |
| `/platform/projects/:ref/analytics/endpoints/auth.metrics` | GET | ✅ | proxy | Get auth performance metrics | `→ Kong /analytics/v1/endpoints/auth.metrics` |
| `/platform/projects/:ref/analytics/endpoints/service-health` | GET | ✅ | proxy | Get service health metrics | `→ Kong /analytics/v1/endpoints/service-health` |
| `/platform/projects/:ref/analytics/endpoints/usage.api-counts` | GET | ⚠️ | supastack | Get API request counts (empty) | `GET .../usage.api-counts` (stub) |
| `/platform/projects/:ref/analytics/endpoints/usage.api-requests-count` | GET | ⚠️ | supastack | Get API request totals (empty) | `GET .../usage.api-requests-count` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.combined-stats` | GET | ⚠️ | supastack | Get function combined stats (empty) | `GET .../functions.combined-stats` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.req-stats` | GET | ⚠️ | supastack | Get function request stats (empty) | `GET .../functions.req-stats` (stub) |
| `/platform/projects/:ref/analytics/endpoints/functions.resource-usage` | GET | ⚠️ | supastack | Get function resource usage (empty) | `GET .../functions.resource-usage` (stub) |
| `/platform/projects/:ref/analytics/log-drains` | GET | ⚠️ | supastack | List log drain destinations (empty) | `GET .../analytics/log-drains` (stub) |
| `/platform/projects/:ref/analytics/log-drains` | POST | ⚠️ | supastack | Create log drain | `POST .../analytics/log-drains` (stub) |
| `/platform/projects/:ref/analytics/log-drains/:token` | PUT | ⚠️ | supastack | Update log drain | `PUT .../log-drains/:token` (stub) |
| `/platform/projects/:ref/analytics/log-drains/:token` | DELETE | ⚠️ | supastack | Delete log drain | `DELETE .../log-drains/:token` (stub) |
| `/platform/projects/:ref/run-lints` | GET | ⚠️ | mock | Run database lint checks | — |
| `/platform/projects/:ref/notifications/advisor/exceptions` | GET | ⚠️ | mock | Get lint exception rules | — |

---

## Notifications

> Feature 025 stubs — return empty so Studio's notification bell renders.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/notifications` | GET | ⚠️ | supastack | List platform notifications (empty) | `GET /api/v1/platform/notifications` (stub) |
| `/platform/notifications` | PATCH | ⚠️ | supastack | Mark notifications as read | `PATCH /api/v1/platform/notifications` (stub) |
| `/platform/notifications/archive-all` | PATCH | ⚠️ | supastack | Archive all notifications | `PATCH .../notifications/archive-all` (stub) |
| `/platform/notifications/summary` | GET | ⚠️ | supastack | Get notification counts (zero) | `GET .../notifications/summary` (stub) |

---

## Replication

> Feature 025 stubs — return empty so Studio's replication pages render. No real replication backend.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/replication/:ref/sources` | GET | ⚠️ | supastack | List replication sources (empty) | stub |
| `/platform/replication/:ref/sources/:id/tables` | GET | ⚠️ | supastack | List source tables | stub |
| `/platform/replication/:ref/sources/:id/publications` | GET | ⚠️ | supastack | List source publications | stub |
| `/platform/replication/:ref/sources/:id/publications` | POST | ⚠️ | supastack | Create publication | stub |
| `/platform/replication/:ref/sources/:id/publications/:name` | DELETE | ⚠️ | supastack | Delete publication | stub |
| `/platform/replication/:ref/destinations` | GET | ⚠️ | supastack | List replication destinations (empty) | stub |
| `/platform/replication/:ref/destinations` | POST | ⚠️ | supastack | Create destination | stub |
| `/platform/replication/:ref/destinations/validate` | POST | ⚠️ | supastack | Validate destination config | stub |
| `/platform/replication/:ref/destinations/:id` | PATCH | ⚠️ | supastack | Update destination | stub |
| `/platform/replication/:ref/destinations/:id` | DELETE | ⚠️ | supastack | Delete destination | stub |
| `/platform/replication/:ref/pipelines` | GET | ⚠️ | supastack | List replication pipelines (empty) | stub |
| `/platform/replication/:ref/pipelines` | POST | ⚠️ | supastack | Create pipeline | stub |
| `/platform/replication/:ref/pipelines/validate` | POST | ⚠️ | supastack | Validate pipeline config | stub |
| `/platform/replication/:ref/pipelines/:id` | DELETE | ⚠️ | supastack | Delete pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/start` | POST | ⚠️ | supastack | Start pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/stop` | POST | ⚠️ | supastack | Stop pipeline | stub |
| `/platform/replication/:ref/pipelines/:id/status` | GET | ⚠️ | supastack | Get pipeline status | stub |
| `/platform/replication/:ref/pipelines/:id/version` | GET | ⚠️ | supastack | Get pipeline version | stub |
| `/platform/replication/:ref/pipelines/:id/replication-status` | GET | ⚠️ | supastack | Get replication lag / status | stub |
| `/platform/replication/:ref/pipelines/:id/rollback-tables` | POST | ⚠️ | supastack | Rollback specific tables | stub |
| `/platform/replication/:ref/destinations-pipelines` | POST | ⚠️ | supastack | Create destination+pipeline together | stub |
| `/platform/replication/:ref/destinations-pipelines/:did/:pid` | DELETE | ⚠️ | supastack | Delete destination+pipeline | stub |
| `/platform/replication/:ref/tenants` | GET | ⚠️ | supastack | List tenants | stub |
| `/platform/replication/:ref/tenants` | DELETE | ⚠️ | supastack | Delete tenant | stub |
| `/platform/replication/:ref/tenants-sources` | POST | ⚠️ | supastack | Create tenant source | stub |

---

## Integrations

> Feature 025 stubs — return empty so Studio's integration pages render.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/integrations` | GET | ⚠️ | supastack | List global integrations (empty) | `GET /api/v1/platform/integrations` (stub) |
| `/platform/integrations/:slug` | GET | ⚠️ | supastack | List org integrations (empty) | `GET .../integrations/:slug` (stub) |
| `/platform/integrations/github/authorization` | GET | ⚠️ | supastack | Get GitHub app auth status | `GET .../github/authorization` (stub) |
| `/platform/integrations/github/connections` | GET | ⚠️ | supastack | List GitHub connections (empty) | `GET .../github/connections` (stub) |
| `/platform/integrations/github/repositories` | GET | ⚠️ | supastack | List GitHub repos (empty) | `GET .../github/repositories` (stub) |

---

## Telemetry & Feature Flags

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/telemetry/feature-flags` | GET | ⚠️ | supastack | Get feature flag values | `GET /api/v1/platform/telemetry/feature-flags` (stub) |
| `/platform/projects-resource-warnings` | GET | ⚠️ | supastack | Get resource warning alerts (empty) | `GET /api/v1/platform/projects-resource-warnings` (stub) |
| `/platform/deployment-mode` | GET | ✅ | supastack | Get deployment mode (self-hosted) | `GET /api/v1/platform/deployment-mode` |

---

## Project Misc (UI / Content / Branches)

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects/:ref/content` | GET | ⚠️ | supastack | List saved SQL queries/snippets (empty) | `GET .../projects/:ref/content` (stub) |
| `/platform/projects/:ref/content` | POST | ⚠️ | supastack | Save a SQL snippet | `POST .../projects/:ref/content` (stub) |
| `/platform/projects/:ref/content/count` | GET | ⚠️ | supastack | Count content items | `GET .../content/count` (stub) |
| `/platform/projects/:ref/content/folders` | GET | ⚠️ | supastack | List content folders | `GET .../content/folders` (stub) |
| `/platform/projects/:ref/content/folders/:id` | GET | ⚠️ | supastack | Get content folder | `GET .../content/folders/:id` (stub) |
| `/platform/projects/:ref/content/item/:id` | GET | ⚠️ | supastack | Get specific content item | `GET .../content/item/:id` (stub) |
| `/platform/projects/:ref/service-versions` | GET | ⚠️ | supastack | Get version info for each service | `GET .../service-versions` (stub) |
| `/platform/projects/:ref/api-keys/temporary` | GET | ⚠️ | supastack | Get short-lived API keys | `GET .../api-keys/temporary` (stub) |
| `/v1/projects/:ref/branches` | GET | ⚠️ | mock | List database branches | — |
| `/v1/projects/:ref/config/auth/signing-keys` | GET | ⚠️ | mock | List JWT signing keys | — |
| `/v1/projects/:ref/config/auth/third-party-auth` | GET | ⚠️ | mock | List third-party auth providers | — |

---

## CLI & Developer

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/api/v1/cli/login` | POST | ✅ | supastack | Device-code login for CLI | `POST /api/v1/cli/login` |
| `/cli/profile.toml` | GET | ✅ | supastack | Get CLI profile config | `GET /cli/profile.toml` |
| `/cli/mint-token` | POST | ✅ | supastack | Mint short-lived CLI token | `POST /cli/mint-token` |
| `/health` | GET | ✅ | supastack | API health check | `GET /health` |

---

## Studio UI Overrides (apex-root / basePath)

> Feature 025 + 891dde7: Studio's own Next.js API routes that 500 self-hosted are intercepted by Caddy and served by api stubs. Routed under the `/dashboard` basePath too.

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/api/get-deployment-commit` | GET | ✅ | supastack | Studio build/version banner | `GET /api/get-deployment-commit` (api stub) |
| `/api/incident-banner` | GET | ✅ | supastack | Cloud incident banner (none self-hosted) | `GET /api/incident-banner` → `null` |
| `/api/incident-status` | GET | ✅ | supastack | Active StatusPage incidents (none self-hosted) | `GET /api/incident-status` → `[]` |

---

## Feedback

| SUPABASE API | HTTP_METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/feedback/send` | POST | ⚠️ | supastack | Send general feedback (no-op) | `POST /api/v1/platform/feedback/send` (stub) |
| `/platform/feedback/upgrade` | POST | ⚠️ | supastack | Send upgrade feedback (no-op) | `POST .../feedback/upgrade` (stub) |
| `/platform/feedback/downgrade` | POST | ⚠️ | supastack | Send downgrade feedback (no-op) | `POST .../feedback/downgrade` (stub) |
| `/platform/feedback/conversations/:id/custom-fields` | PATCH | ⚠️ | supastack | Update feedback conversation fields | `PATCH .../conversations/:id/custom-fields` (stub) |
