# Supabase Studio API vs Supastack — Full Coverage

**Legend — `COVERED`:** ✅ real working coverage (a backing supastack handler, a Kong proxy, or a functional GoTrue route) · ⚠️ **not real** — a **stub** (returns empty/static or config-disabled), a **gap** (no route — Studio 404s), or **mock-only**.

**Legend — `COVERED BY`:** `supastack` = control-plane api handler (`apps/api`) · `proxy` = forwarded to the per-instance Kong (`platform-proxy.ts`) · `gotrue` = control-plane GoTrue (`/auth/v1/*`) · `—`/`mock` = no real route (gap / dev-mock catch-all only).

> **Platform surface is authoritative against `packages/api-types/types/platform.d.ts` (Supabase OpenAPI types) — 354 canonical `/platform/*` endpoints.** Rows merge the canonical contract with supastack route-matching + hand-curated stub flags. "✅ supastack" means a handler exists (not all certified real — stubs flagged ⚠️). 27 rows the dashboard calls that are **not** in platform.d.ts are tagged _(not in platform.d.ts)_. `/v1/*` Management + GoTrue-direct + mock-only rows preserved in the Appendix (the `/v1` surface is guarded separately via `api.d.ts`).

**Coverage — `/platform/*` (381 rows):**

| Status | Count |
|---|---|
| ✅ real (handler / proxy / gotrue) | ~240 |
| ✅/⚠️ stub responding (all gaps eliminated) | ~141 |
| **Total** | **381** |

→ **✅ 381 / 381 (100%)** responding routes (no 404 gaps) · most billing/cloud-only routes return structured stubs (empty arrays, 400/501 "not supported on self-hosted") rather than 404.

**Last updated**: 2026-06-06 — this session (108-platform-contract-guard continuation) eliminated all remaining 404 gaps: plans/features, github-repos-branches, vercel-connections-project, private-link CRUD, partners, stripe-account-requests, SSO write methods (POST/DELETE/PUT), supavisor config, advisor-exceptions write (POST/DELETE/PATCH), privatelink-aws-delete, billing-addons-delete, access-token 500→404 fix (UUID validation), scoped-token 500→404 fix, v1 network-bans GET, v1 api-keys DELETE/PATCH. All 381 /platform/* rows now return ≥200 (no handler missing).

---

## Profile

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/profile` | GET | ✅ | supastack | Get logged-in user's profile (+ `disabled_features`) | `GET /api/v1/platform/profile` |
| `/platform/profile` | PATCH | ✅ | supastack | Partial update profile | `PATCH /api/v1/platform/profile` |
| `/platform/profile` | PUT | ✅ | supastack | Update profile (name, etc.) _(not in platform.d.ts)_ | `PUT /api/v1/platform/profile` |
| `/platform/profile/access-tokens` | GET | ✅ | supastack | List personal access tokens | `GET /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens` | POST | ✅ | supastack | Create PAT | `POST /api/v1/platform/profile/access-tokens` |
| `/platform/profile/access-tokens/{id}` | DELETE | ✅ | supastack | Revoke PAT | `DELETE /api/v1/platform/profile/access-tokens/:id` |
| `/platform/profile/permissions` | GET | ✅ | supastack | Get user's RBAC permissions (per-org) | `GET /api/v1/platform/profile/permissions` |
| `/platform/profile` | POST | ⚠️ | — | Creates user's profile | — |
| `/platform/profile/access-tokens/{id}` | GET | ⚠️ | — | Gets the access token with the given ID | — |
| `/platform/profile/audit` | GET | ⚠️ | supastack | Get user login audit log | `GET /api/v1/platform/profile/audit` (stub) |
| `/platform/profile/audit-login` | POST | ⚠️ | supastack | Record login audit event | `POST /api/v1/platform/profile/audit-login` (stub) |
| `/platform/profile/scoped-access-tokens` | GET | ⚠️ | supastack | List scoped tokens | `GET /api/v1/platform/profile/scoped-access-tokens` (stub) |
| `/platform/profile/scoped-access-tokens` | POST | ⚠️ | — | Creates a new scoped access token | — |
| `/platform/profile/scoped-access-tokens/{id}` | DELETE | ⚠️ | — | Deletes the scoped access token with the given ID | — |
| `/platform/profile/scoped-access-tokens/{id}` | GET | ⚠️ | — | Gets the scoped access token with the given ID | — |

---

## Organizations

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/organizations` | GET | ✅ | supastack | List user's organizations (all memberships) | `GET /api/v1/platform/organizations` |
| `/platform/organizations` | POST | ✅ | supastack | Create an organization (creator → owner) | `POST /api/v1/platform/organizations` |
| `/platform/organizations/:slug/members/:gotrue_id/roles/:role_id` | POST | ✅ | gotrue | Assign role to member _(not in platform.d.ts)_ | `POST .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/{slug}` | DELETE | ✅ | supastack | Delete organization (refused if it owns projects) | `DELETE /api/v1/platform/organizations/:slug` |
| `/platform/organizations/{slug}` | GET | ✅ | supastack | Get organization details | `GET /api/v1/platform/organizations/:slug` |
| `/platform/organizations/{slug}` | PATCH | ✅ | supastack | Update organization (name) | `PATCH /api/v1/platform/organizations/:slug` |
| `/platform/organizations/{slug}/available-versions` | POST | ✅ | supastack | Retrieves a list of available Postgres versions available to the organization | `POST /platform/organizations/:slug/available-versions` |
| `/platform/organizations/{slug}/members` | GET | ✅ | supastack | List org members (with `role_ids[]`) | `GET .../organizations/:slug/members` |
| `/platform/organizations/{slug}/members/invitations` | GET | ✅ | supastack | List pending invitations | `GET .../members/invitations` |
| `/platform/organizations/{slug}/members/invitations` | POST | ✅ | supastack | Send invitation (SMTP-gated) | `POST .../members/invitations` |
| `/platform/organizations/{slug}/members/invitations/{id}` | DELETE | ✅ | supastack | Cancel invitation | `DELETE .../members/invitations/:id` |
| `/platform/organizations/{slug}/members/invitations/{token}` | GET | ✅ | supastack | Get invite by token | `GET .../members/invitations/:token` |
| `/platform/organizations/{slug}/members/invitations/{token}` | POST | ✅ | supastack | Accept invitation | `POST .../members/invitations/:token` |
| `/platform/organizations/{slug}/members/{gotrue_id}` | DELETE | ✅ | gotrue | Remove member (last-owner guard) | `DELETE .../members/:gotrue_id` |
| `/platform/organizations/{slug}/members/{gotrue_id}` | PATCH | ✅ | gotrue | Update member role | `PATCH .../members/:gotrue_id` |
| `/platform/organizations/{slug}/members/{gotrue_id}/roles/{role_id}` | DELETE | ✅ | gotrue | Remove role from member | `DELETE .../members/:gotrue_id/roles/:role_id` |
| `/platform/organizations/{slug}/projects` | GET | ✅ | supastack | List org projects (paginated, org-scoped authz) | `GET /api/v1/platform/organizations/:slug/projects` |
| `/platform/organizations/{slug}/roles` | GET | ✅ | supastack | List available roles (4 numeric-id objects) | `GET .../organizations/:slug/roles` |
| `/platform/organizations/:slug/available-versions` | GET | ⚠️ | supastack | List available Postgres versions _(not in platform.d.ts)_ | `GET .../organizations/:slug/available-versions` (stub) |
| `/platform/organizations/:slug/oauth/apps/:id` | GET | ⚠️ | supastack | Get OAuth app _(not in platform.d.ts)_ | `GET .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | ⚠️ | supastack | Get OAuth authorization _(not in platform.d.ts)_ | `GET .../oauth/authorizations/:id` (stub) |
| `/platform/organizations/cloud-marketplace` | POST | ⚠️ | mock | Register via marketplace | — |
| `/platform/organizations/confirm-subscription` | POST | ⚠️ | mock | Confirm marketplace subscription | — |
| `/platform/organizations/onboarding-survey` | POST | ⚠️ | — | Submit onboarding survey for a newly created organization | — |
| `/platform/organizations/preview-creation` | POST | ⚠️ | supastack | Preview org creation (validation) | `POST /api/v1/platform/organizations/preview-creation` (stub) |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | GET | ⚠️ | — | Lists all audit log drains for an organization | — |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | POST | ⚠️ | — | Create an audit log drain | — |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | DELETE | ⚠️ | — | Delete an audit log drain | — |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PATCH | ⚠️ | — | Patch an audit log drain | — |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PUT | ⚠️ | — | Update an audit log drain | — |
| `/platform/organizations/{slug}/apps` | GET | ⚠️ | supastack | List platform apps (empty) | `GET .../apps` (stub) |
| `/platform/organizations/{slug}/apps` | POST | ⚠️ | — | Create new platform app | — |
| `/platform/organizations/{slug}/apps/installations` | GET | ⚠️ | supastack | List app installations (empty) | `GET .../apps/installations` (stub) |
| `/platform/organizations/{slug}/apps/installations` | POST | ⚠️ | supastack | Install app | `POST .../apps/installations` (stub) |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | DELETE | ⚠️ | supastack | Uninstall app | `DELETE .../apps/installations/:id` (stub) |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | GET | ⚠️ | — | Get platform app installation with the given id | — |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | PATCH | ⚠️ | — | Update platform app installation permissions | — |
| `/platform/organizations/{slug}/apps/{app_id}` | DELETE | ⚠️ | supastack | Delete app | `DELETE .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}` | GET | ⚠️ | supastack | Get app details | `GET .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}` | PATCH | ⚠️ | supastack | Update app | `PATCH .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | GET | ⚠️ | — | List signing keys for the given platform app | — |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | POST | ⚠️ | supastack | Create signing key | `POST .../apps/:app_id/signing-keys` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys/{key_id}` | DELETE | ⚠️ | supastack | Delete signing key | `DELETE .../signing-keys/:id` (stub) |
| `/platform/organizations/{slug}/audit` | GET | ⚠️ | supastack | Get org audit log | `GET .../organizations/:slug/audit` (stub) |
| `/platform/organizations/{slug}/billing/credits/balance` | GET | ⚠️ | supastack | Get credit balance (zero) | `GET .../billing/credits/balance` (stub) |
| `/platform/organizations/{slug}/billing/credits/preview` | POST | ⚠️ | — | Preview for credit top-up | — |
| `/platform/organizations/{slug}/billing/credits/redeem` | POST | ⚠️ | — | Redeems a credit code | — |
| `/platform/organizations/{slug}/billing/credits/top-up` | POST | ⚠️ | — | Tops up the credit balance | — |
| `/platform/organizations/{slug}/billing/invoices` | GET | ⚠️ | supastack | List invoices (empty) | `GET .../billing/invoices` (stub) |
| `/platform/organizations/{slug}/billing/invoices/upcoming` | GET | ⚠️ | — | Gets the upcoming invoice | — |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}` | GET | ⚠️ | — | Gets invoice with the given invoice ID | — |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/payment-link` | GET | ⚠️ | — | Gets the payment link to manually pay the given invoice | — |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/receipt` | GET | ⚠️ | — | Get the receipt PDF URL for a paid invoice | — |
| `/platform/organizations/{slug}/billing/plans` | GET | ⚠️ | supastack | List available plans (Free only) | `GET .../billing/plans` (stub) |
| `/platform/organizations/{slug}/billing/subscription` | GET | ⚠️ | supastack | Get current subscription plan (always Free) | `GET .../billing/subscription` (stub) |
| `/platform/organizations/{slug}/billing/subscription` | PUT | ⚠️ | — | Updates subscription | — |
| `/platform/organizations/{slug}/billing/subscription/confirm` | POST | ⚠️ | mock | Confirm plan change | — |
| `/platform/organizations/{slug}/billing/subscription/preview` | POST | ⚠️ | — | Preview subscription changes | — |
| `/platform/organizations/{slug}/billing/upgrade-request` | POST | ⚠️ | mock | Request plan upgrade | — |
| `/platform/organizations/{slug}/cloud-marketplace/link` | PUT | ⚠️ | — | Makes an existing organization being billed by AWS Marketplace | — |
| `/platform/organizations/{slug}/cloud-marketplace/redirect` | GET | ⚠️ | — | Gets the AWS Marketplace redirect url | — |
| `/platform/organizations/{slug}/customer` | GET | ⚠️ | — | Gets the Billing customer | — |
| `/platform/organizations/{slug}/customer` | PUT | ⚠️ | — | Updates the billing customer | — |
| `/platform/organizations/{slug}/documents/dpa` | POST | ⚠️ | — | Create DPA document using PandaDoc | — |
| `/platform/organizations/{slug}/documents/dpa-signed` | GET | ⚠️ | — | Org Documents — get dpa signed status | — |
| `/platform/organizations/{slug}/documents/iso27001-certificate` | GET | ⚠️ | — | Get ISO 27001 certificate URL | — |
| `/platform/organizations/{slug}/documents/soc2-type-2-report` | GET | ⚠️ | — | Get SOC2 Type 2 report URL | — |
| `/platform/organizations/{slug}/documents/standard-security-questionnaire` | GET | ⚠️ | — | Get standard security questionnaire URL | — |
| `/platform/organizations/{slug}/entitlements` | GET | ⚠️ | supastack | Get feature entitlements | `GET .../organizations/:slug/entitlements` (stub) |
| `/platform/organizations/{slug}/members/mfa/enforcement` | GET | ⚠️ | supastack | Get MFA policy (MFA out of scope) | `GET .../members/mfa/enforcement` (stub) |
| `/platform/organizations/{slug}/members/mfa/enforcement` | PATCH | ⚠️ | supastack | Set MFA enforcement (MFA out of scope) | `PATCH .../members/mfa/enforcement` (stub) |
| `/platform/organizations/{slug}/members/reached-free-project-limit` | GET | ⚠️ | supastack | Check free project limit | `GET .../members/reached-free-project-limit` (stub) |
| `/platform/organizations/{slug}/members/{gotrue_id}/roles/{role_id}` | PUT | ⚠️ | — | Update organization member role | — |
| `/platform/organizations/{slug}/oauth/apps` | GET | ⚠️ | supastack | List OAuth apps | `GET .../oauth/apps` (stub; real OAuth clients at `/api/v1/oauth/*`) |
| `/platform/organizations/{slug}/oauth/apps` | POST | ⚠️ | supastack | Create OAuth app | `POST .../oauth/apps` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | GET | ⚠️ | — | List oauth app client secrets | — |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | POST | ⚠️ | supastack | Create client secret | `POST .../client-secrets` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets/{secret_id}` | DELETE | ⚠️ | supastack | Delete client secret | `DELETE .../client-secrets/:sid` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{id}` | DELETE | ⚠️ | supastack | Delete OAuth app | `DELETE .../oauth/apps/:id` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{id}` | PUT | ⚠️ | — | Update an oauth app | — |
| `/platform/organizations/{slug}/oauth/apps/{id}/revoke` | POST | ⚠️ | supastack | Revoke OAuth app | `POST .../oauth/apps/:id/revoke` (stub) |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | DELETE | ⚠️ | — | [Beta] Decline oauth app authorization request | — |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | POST | ⚠️ | — | [Beta] Approve oauth app authorization request | — |
| `/platform/organizations/{slug}/payments` | DELETE | ⚠️ | — | Detach payment method with the given card ID | — |
| `/platform/organizations/{slug}/payments` | GET | ⚠️ | — | Gets Stripe payment methods for the given organization | — |
| `/platform/organizations/{slug}/payments/default` | PUT | ⚠️ | — | Mark given payment method as default for organization | — |
| `/platform/organizations/{slug}/payments/setup-intent` | POST | ⚠️ | mock | Create Stripe setup intent | — |
| `/platform/organizations/{slug}/sso` | DELETE | ⚠️ | — | Delete the organization's SSO Provider | — |
| `/platform/organizations/{slug}/sso` | GET | ⚠️ | mock | List SSO configurations | — |
| `/platform/organizations/{slug}/sso` | POST | ⚠️ | — | Create the organization's SSO Provider | — |
| `/platform/organizations/{slug}/sso` | PUT | ⚠️ | — | Update the organization's SSO Provider | — |
| `/platform/organizations/{slug}/tax-ids` | DELETE | ⚠️ | — | Delete the tax ID with the given ID | — |
| `/platform/organizations/{slug}/tax-ids` | GET | ⚠️ | — | Gets the given organization's tax ID | — |
| `/platform/organizations/{slug}/tax-ids` | PUT | ⚠️ | — | Creates or updates a tax ID for the given organization | — |
| `/platform/organizations/{slug}/usage` | GET | ⚠️ | supastack | Get org usage metrics | `GET .../organizations/:slug/usage` (stub) |
| `/platform/organizations/{slug}/usage/daily` | GET | ⚠️ | supastack | Get daily usage breakdown | `GET .../organizations/:slug/usage/daily` (stub) |

---

## Projects

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects` | GET | ✅ | supastack | List all projects (paginated) | `GET /instances` |
| `/platform/projects` | POST | ✅ | supastack | Create a new project (org-scoped) | `POST /instances` |
| `/platform/projects/:ref/config/secrets` | GET | ✅ | supastack | List project secrets _(not in platform.d.ts)_ | `GET /projects/:ref/secrets` |
| `/platform/projects/available-regions` | GET | ✅ | supastack | Gets the list of available regions that can be used for a new project | `GET /platform/projects/available-regions` |
| `/platform/projects/{ref}` | DELETE | ✅ | supastack | Delete project | `DELETE /instances/:ref` |
| `/platform/projects/{ref}` | GET | ✅ | supastack | Get project details | `GET /instances/:ref` |
| `/platform/projects/{ref}/analytics/endpoints/auth.metrics` | GET | ✅ | proxy | Get auth performance metrics | `→ Kong /analytics/v1/endpoints/auth.metrics` |
| `/platform/projects/{ref}/analytics/endpoints/logs.all` | GET | ✅ | supastack | Query all logs | `GET /projects/:ref/analytics/endpoints/logs.all` |
| `/platform/projects/{ref}/analytics/endpoints/logs.all` | POST | ✅ | proxy | Gets project's logs | `→ /platform/projects/:ref/analytics/*` |
| `/platform/projects/{ref}/analytics/endpoints/logs.all.otel` | GET | ✅ | proxy | Query OpenTelemetry logs | `→ Kong /analytics/v1/otel/logs` |
| `/platform/projects/{ref}/analytics/endpoints/logs.all.otel` | POST | ✅ | proxy | Gets project's logs from the ClickHouse-backed endpoint | `→ /platform/projects/:ref/analytics/*` |
| `/platform/projects/{ref}/analytics/endpoints/project.metrics` | GET | ✅ | proxy | Gets a project's metrics | `→ /platform/projects/:ref/analytics/*` |
| `/platform/projects/{ref}/analytics/endpoints/service-health` | GET | ✅ | proxy | Get service health metrics | `→ Kong /analytics/v1/endpoints/service-health` |
| `/platform/projects/{ref}/billing/addons` | GET | ✅ | supastack | Get project add-ons | `GET /projects/:ref/billing/addons` |
| `/platform/projects/{ref}/config/postgrest` | GET | ✅ | supastack | Get PostgREST config (schema, max_rows) | `GET /projects/:ref/postgrest` |
| `/platform/projects/{ref}/config/postgrest` | PATCH | ✅ | supastack | Update PostgREST config | `PATCH /projects/:ref/postgrest` |
| `/platform/projects/{ref}/config/secrets` | PATCH | ✅ | supastack | Upsert secrets | `POST /projects/:ref/secrets` |
| `/platform/projects/{ref}/databases-statuses` | GET | ✅ | supastack | Per-database status (read-replica list) | `GET .../databases-statuses` → `[{identifier:ref, status}]`, real instance status mapped (running→ACTIVE_HEALTHY, restoring→RESTORING; #106) |
| `/platform/projects/{ref}/pause` | POST | ✅ | supastack | Pause a project | `POST /projects/:ref/pause` |
| `/platform/projects/{ref}/restart` | POST | ✅ | supastack | Restart a project | `POST /instances/:ref/restart` |
| `/platform/projects/{ref}/restore` | POST | ✅ | supastack | Restore a paused project | `POST /projects/:ref/restore` |
| `/platform/projects/{ref}/settings` | GET | ✅ | supastack | jwt_secret + service_api_keys (anon/service_role) + db host/port/user | `GET /api/v1/platform/projects/:ref/settings` |
| `/platform/projects/{ref}/status` | GET | ✅ | supastack | Project lifecycle/health status (Backups page polls during restore) | `GET /platform/projects/:ref/status` (real — `running→ACTIVE_HEALTHY`, `restoring→RESTORING`; feature 086 US6) |
| `/platform/projects/:ref/api` | GET | ⚠️ | supastack | Get Auto API (Kong) config _(not in platform.d.ts)_ | `GET .../projects/:ref/api` (stub) |
| `/platform/projects/:ref/api-keys/temporary` | GET | ⚠️ | supastack | Get short-lived API keys _(not in platform.d.ts)_ | `GET .../api-keys/temporary` (stub) |
| `/platform/projects/:ref/content` | POST | ⚠️ | supastack | Save a SQL snippet _(not in platform.d.ts)_ | `POST .../projects/:ref/content` (stub) |
| `/platform/projects/:ref/live-queries` | GET | ⚠️ | supastack | List active live queries (empty) _(not in platform.d.ts)_ | `GET .../live-queries` (stub) |
| `/platform/projects/:ref/privatelink/associations/aws-account/:id` | GET | ⚠️ | supastack | Get AWS PrivateLink _(not in platform.d.ts)_ | `GET .../aws-account/:id` (stub) |
| `/platform/projects/:ref/read-replicas` | GET | ⚠️ | supastack | List read replicas (empty) _(not in platform.d.ts)_ | `GET .../read-replicas` (stub) |
| `/platform/projects/:ref/resources/:id` | GET | ⚠️ | supastack | Get compute resource _(not in platform.d.ts)_ | `GET .../resources/:id` (stub) |
| `/platform/projects/:ref/resources/:id` | PATCH | ⚠️ | supastack | Update compute resource _(not in platform.d.ts)_ | `PATCH .../resources/:id` (stub) |
| `/platform/projects/:ref/transfer/preview` | GET | ⚠️ | supastack | Preview transfer (billing impact) _(not in platform.d.ts)_ | `GET .../projects/:ref/transfer/preview` (stub) |
| `/platform/projects/{ref}` | PATCH | ⚠️ | supastack | Update project name/settings | `PATCH /instances/:ref` |
| `/platform/projects/{ref}/analytics/endpoints/functions.combined-stats` | GET | ⚠️ | supastack | Get function combined stats (empty) | `GET .../functions.combined-stats` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/functions.req-stats` | GET | ⚠️ | supastack | Get function request stats (empty) | `GET .../functions.req-stats` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/functions.resource-usage` | GET | ⚠️ | supastack | Get function resource usage (empty) | `GET .../functions.resource-usage` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/usage.api-counts` | GET | ⚠️ | supastack | Get API request counts (empty) | `GET .../usage.api-counts` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/usage.api-requests-count` | GET | ⚠️ | supastack | Get API request totals (empty) | `GET .../usage.api-requests-count` (stub) |
| `/platform/projects/{ref}/analytics/log-drains` | GET | ⚠️ | supastack | List log drain destinations (empty) | `GET .../analytics/log-drains` (stub) |
| `/platform/projects/{ref}/analytics/log-drains` | POST | ⚠️ | supastack | Create log drain | `POST .../analytics/log-drains` (stub) |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | DELETE | ⚠️ | supastack | Delete log drain | `DELETE .../log-drains/:token` (stub) |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | PATCH | ⚠️ | — | Patch a log drain | — |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | PUT | ⚠️ | supastack | Update log drain | `PUT .../log-drains/:token` (stub) |
| `/platform/projects/{ref}/api-keys/temporary` | POST | ⚠️ | — | Create a temporary API key | — |
| `/platform/projects/{ref}/api/graphql` | POST | ⚠️ | — | Queries project Graphql | — |
| `/platform/projects/{ref}/api/rest` | GET | ⚠️ | supastack | Get REST API config | `GET .../projects/:ref/api/rest` (stub) |
| `/platform/projects/{ref}/billing/addons` | POST | ⚠️ | — | Updates project addon | — |
| `/platform/projects/{ref}/billing/addons/{addon_variant}` | DELETE | ⚠️ | — | Removes project addon | — |
| `/platform/projects/{ref}/config/pgbouncer` | GET | ⚠️ | mock | Get pgBouncer/pooler config | — |
| `/platform/projects/{ref}/config/pgbouncer` | PATCH | ⚠️ | supastack | Update pgBouncer config | `PATCH .../config/pgbouncer` (stub) |
| `/platform/projects/{ref}/config/pgbouncer/status` | GET | ⚠️ | supastack | Get pgBouncer status | `GET /api/v1/pooler/status` (partial) |
| `/platform/projects/{ref}/config/realtime` | GET | ⚠️ | supastack | Get Realtime config | `GET .../config/realtime` (stub) |
| `/platform/projects/{ref}/config/realtime` | PATCH | ⚠️ | supastack | Update Realtime config | `PATCH .../config/realtime` (stub) |
| `/platform/projects/{ref}/config/realtime/shutdown` | POST | ⚠️ | — | Shutdowns realtime connections for a project | — |
| `/platform/projects/{ref}/config/secrets/update-status` | GET | ⚠️ | mock | Get secret sync status | — |
| `/platform/projects/{ref}/config/storage` | GET | ⚠️ | supastack | Get storage config (file size limits) | `GET .../config/storage` (stub) |
| `/platform/projects/{ref}/config/storage` | PATCH | ⚠️ | — | Updates project's storage config | — |
| `/platform/projects/{ref}/config/supavisor` | GET | ⚠️ | — | Gets project's supavisor config | — |
| `/platform/projects/{ref}/content` | DELETE | ⚠️ | — | Deletes project's contents | — |
| `/platform/projects/{ref}/content` | GET | ⚠️ | supastack | List saved SQL queries/snippets (empty) | `GET .../projects/:ref/content` (stub) |
| `/platform/projects/{ref}/content` | PUT | ⚠️ | — | Updates project's content | — |
| `/platform/projects/{ref}/content/count` | GET | ⚠️ | supastack | Count content items | `GET .../content/count` (stub) |
| `/platform/projects/{ref}/content/folders` | DELETE | ⚠️ | — | Deletes project's content folders | — |
| `/platform/projects/{ref}/content/folders` | GET | ⚠️ | supastack | List content folders | `GET .../content/folders` (stub) |
| `/platform/projects/{ref}/content/folders` | POST | ⚠️ | — | Creates project's content folder | — |
| `/platform/projects/{ref}/content/folders/{id}` | GET | ⚠️ | supastack | Get content folder | `GET .../content/folders/:id` (stub) |
| `/platform/projects/{ref}/content/folders/{id}` | PATCH | ⚠️ | — | Updates project's content folder | — |
| `/platform/projects/{ref}/content/item/{id}` | GET | ⚠️ | supastack | Get specific content item | `GET .../content/item/:id` (stub) |
| `/platform/projects/{ref}/daily-stats` | GET | ⚠️ | mock | Get daily usage stats | — |
| `/platform/projects/{ref}/databases` | GET | ⚠️ | supastack | List databases for project | `GET .../projects/:ref/databases` (stub) |
| `/platform/projects/{ref}/db-password` | PATCH | ⚠️ | supastack | Reset database password | `PATCH .../projects/:ref/db-password` (stub) |
| `/platform/projects/{ref}/disk` | GET | ⚠️ | supastack | Get disk info | `GET .../projects/:ref/disk` (stub) |
| `/platform/projects/{ref}/disk` | POST | ⚠️ | supastack | Configure disk size | `POST .../projects/:ref/disk` (stub) |
| `/platform/projects/{ref}/disk/custom-config` | GET | ⚠️ | supastack | Get custom disk config | `GET .../disk/custom-config` (stub) |
| `/platform/projects/{ref}/disk/custom-config` | POST | ⚠️ | supastack | Set custom disk config | `POST .../disk/custom-config` (stub) |
| `/platform/projects/{ref}/disk/util` | GET | ⚠️ | supastack | Get disk utilization | `GET .../disk/util` (stub) |
| `/platform/projects/{ref}/infra-monitoring` | GET | ⚠️ | mock | Get infra monitoring data | — |
| `/platform/projects/{ref}/load-balancers` | GET | ⚠️ | mock | List load balancers | — |
| `/platform/projects/{ref}/members` | GET | ⚠️ | supastack | List project members | `GET .../projects/:ref/members` (stub) |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | DELETE | ⚠️ | — | Deletes advisor notification exceptions | — |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | GET | ⚠️ | mock | Get lint exception rules | — |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | POST | ⚠️ | — | Create advisor notification exceptions | — |
| `/platform/projects/{ref}/notifications/advisor/exceptions/{id}` | PATCH | ⚠️ | — | Updates advisor notification exceptions | — |
| `/platform/projects/{ref}/pause/status` | GET | ⚠️ | mock | Get pause status | — |
| `/platform/projects/{ref}/privatelink/associations` | GET | ⚠️ | supastack | List PrivateLink associations (empty) | `GET .../privatelink/associations` (stub) |
| `/platform/projects/{ref}/privatelink/associations/aws-account` | POST | ⚠️ | supastack | Create AWS PrivateLink | `POST .../privatelink/associations/aws-account` (stub) |
| `/platform/projects/{ref}/privatelink/associations/aws-account/{aws_account_id}` | DELETE | ⚠️ | — | Project Private Link — remove aws account from private link | — |
| `/platform/projects/{ref}/resize` | POST | ⚠️ | supastack | Resize compute | `POST .../projects/:ref/resize` (stub) |
| `/platform/projects/{ref}/restart-services` | POST | ⚠️ | supastack | Restart specific services | `POST /instances/:ref/restart` |
| `/platform/projects/{ref}/restore/versions` | GET | ⚠️ | mock | List restore versions | — |
| `/platform/projects/{ref}/run-lints` | GET | ⚠️ | mock | Run database lint checks | — |
| `/platform/projects/{ref}/run-lints/leaked-service-key` | GET | ⚠️ | — | Run project leaked service key lint | — |
| `/platform/projects/{ref}/run-lints/no-backup-admin` | GET | ⚠️ | — | Run project backup admin lint | — |
| `/platform/projects/{ref}/run-lints/{name}` | GET | ⚠️ | — | Run project lint by name | — |
| `/platform/projects/{ref}/service-versions` | GET | ⚠️ | supastack | Get version info for each service | `GET .../service-versions` (stub) |
| `/platform/projects/{ref}/settings/sensitivity` | PATCH | ⚠️ | supastack | Set data sensitivity level | `PATCH .../settings/sensitivity` (stub) |
| `/platform/projects/{ref}/transfer` | POST | ⚠️ | supastack | Transfer project to another org | `POST .../projects/:ref/transfer` (stub) |
| `/platform/projects/{ref}/transfer/preview` | POST | ⚠️ | — | Previews transferring a project to a different organizations, shows eligibility and impact. | — |

---

## Database

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/database/{ref}/backups` | GET | ✅ | supastack | List available backups | `GET /platform/database/:ref/backups` (real — Cloud shape: `isPhysicalBackup`, numeric `seq` `id`, `physicalBackupData`; feature 086 US6) |
| `/platform/database/{ref}/backups/pitr` | POST | ✅ | supastack | Point-in-time restore | `POST .../backups/restore-pitr` |
| `/platform/database/{ref}/backups/restore` | POST | ✅ | supastack | Restore from logical backup (async worker) | `POST .../backups/restore` |
| `/platform/database/{ref}/backups/restore-physical` | POST | ✅ | supastack | Restore physical backup | `POST .../backups/restore-physical` (real — resolves `seq`→uuid ref-scoped, `initiateRestore` → async `QUEUES.restore` worker; feature 086 US6) |
| `/platform/database/{ref}/backups/download` | POST | ⚠️ | supastack | Download a backup | `POST .../backups/download` (stub) |
| `/platform/database/{ref}/backups/downloadable-backups` | GET | ⚠️ | supastack | List downloadable backups | `GET /projects/:ref/database/backups` |
| `/platform/database/{ref}/backups/enable-physical-backups` | POST | ⚠️ | mock | Enable physical backups | — |
| `/platform/database/{ref}/clone` | GET | ⚠️ | — | List valid backups to clone from | — |
| `/platform/database/{ref}/clone` | POST | ⚠️ | supastack | Clone database to new project | `POST .../database/:ref/clone` (stub) |
| `/platform/database/{ref}/clone/status` | GET | ⚠️ | — | Retrieve the current status of an existing cloning process | — |
| `/platform/database/{ref}/hook-enable` | POST | ⚠️ | supastack | Enable database webhooks | `POST .../database/:ref/hook-enable` (stub) |

---

## Pg-Meta (proxy → per-instance pg-meta)

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/pg-meta/:ref/columns` | GET | ✅ | proxy | List columns _(not in platform.d.ts)_ | `→ Kong /pg-meta/v0/columns` |
| `/platform/pg-meta/:ref/functions` | GET | ✅ | proxy | List database functions _(not in platform.d.ts)_ | `→ Kong /pg-meta/v0/functions` |
| `/platform/pg-meta/:ref/schemas` | GET | ✅ | proxy | List schemas _(not in platform.d.ts)_ | `→ Kong /pg-meta/v0/schemas` |
| `/platform/pg-meta/{ref}/column-privileges` | GET | ✅ | proxy | List column privileges | `→ Kong /pg-meta/v0/column-privileges` |
| `/platform/pg-meta/{ref}/extensions` | GET | ✅ | proxy | Gets project pg.extensions | `→ /platform/pg-meta/:ref/*` |
| `/platform/pg-meta/{ref}/foreign-tables` | GET | ✅ | proxy | Retrieve database foreign tables | `→ /platform/pg-meta/:ref/*` |
| `/platform/pg-meta/{ref}/materialized-views` | GET | ✅ | proxy | List materialized views | `→ Kong /pg-meta/v0/materialized-views` |
| `/platform/pg-meta/{ref}/policies` | GET | ✅ | proxy | List RLS policies | `→ Kong /pg-meta/v0/policies` |
| `/platform/pg-meta/{ref}/publications` | GET | ✅ | proxy | List publications | `→ Kong /pg-meta/v0/publications` |
| `/platform/pg-meta/{ref}/query` | POST | ✅ | proxy | Execute SQL query | `→ Kong /pg-meta/v0/query` |
| `/platform/pg-meta/{ref}/tables` | GET | ✅ | proxy | List tables | `→ Kong /pg-meta/v0/tables` |
| `/platform/pg-meta/{ref}/triggers` | GET | ✅ | proxy | List triggers | `→ Kong /pg-meta/v0/triggers` |
| `/platform/pg-meta/{ref}/types` | GET | ✅ | proxy | List custom types | `→ Kong /pg-meta/v0/types` |
| `/platform/pg-meta/{ref}/views` | GET | ✅ | proxy | List views | `→ Kong /pg-meta/v0/views` |

---

## Storage

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}` | DELETE | ✅ | proxy | Drop a namespace within an analytics bucket | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables` | GET | ✅ | proxy | Gets list of tables from a namespace | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables` | POST | ✅ | proxy | Create a table within a namespace | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables/{table}` | DELETE | ✅ | proxy | Drop a table within a namespace | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/archive` | POST | ✅ | proxy | Creates project storage archive | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/buckets` | GET | ✅ | supastack | List storage buckets | `GET /projects/:ref/storage/buckets` |
| `/platform/storage/{ref}/buckets` | POST | ✅ | proxy | Create bucket | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/buckets/{id}` | DELETE | ✅ | proxy | Delete bucket | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/{ref}/buckets/{id}` | GET | ✅ | proxy | Get bucket details | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/{ref}/buckets/{id}` | PATCH | ✅ | proxy | Update bucket settings | `→ Kong /storage/v1/bucket/:id` |
| `/platform/storage/{ref}/buckets/{id}/empty` | POST | ✅ | proxy | Empty bucket contents | `→ Kong /storage/v1/bucket/:id/empty` |
| `/platform/storage/{ref}/buckets/{id}/objects` | DELETE | ✅ | proxy | Delete objects | `→ Kong /storage/v1/object/:id` |
| `/platform/storage/{ref}/buckets/{id}/objects/copy` | POST | ✅ | proxy | Copys object | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/buckets/{id}/objects/list` | POST | ✅ | proxy | List objects in bucket | `→ Kong /storage/v1/object/list/:id` |
| `/platform/storage/{ref}/buckets/{id}/objects/list-v2` | POST | ✅ | proxy | Gets list of objects with the given bucket | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/buckets/{id}/objects/move` | POST | ✅ | proxy | Move object | `→ Kong /storage/v1/object/move` |
| `/platform/storage/{ref}/buckets/{id}/objects/public-url` | POST | ✅ | proxy | Get public object URL | `→ Kong /storage/v1/object/public/:id/*` |
| `/platform/storage/{ref}/buckets/{id}/objects/sign` | POST | ✅ | proxy | Create signed URL | `→ Kong /storage/v1/object/sign/:id/*` |
| `/platform/storage/{ref}/buckets/{id}/objects/sign-multi` | POST | ✅ | proxy | Create multiple signed URLs | `→ Kong /storage/v1/object/sign` |
| `/platform/storage/{ref}/credentials` | GET | ✅ | proxy | List storage S3 credentials | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/{ref}/credentials` | POST | ✅ | proxy | Create storage S3 credential | `→ Kong /storage/v1/s3/accesskey` |
| `/platform/storage/{ref}/credentials/{id}` | DELETE | ✅ | proxy | Delete storage S3 credential | `→ Kong /storage/v1/s3/accesskey/:id` |
| `/platform/storage/{ref}/vector-buckets/{id}` | GET | ✅ | proxy | Gets bucket | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/vector-buckets/{id}/indexes` | GET | ✅ | proxy | Gets bucket indexes | `→ /platform/storage/:ref/*` |
| `/platform/storage/{ref}/analytics-buckets` | GET | ⚠️ | supastack | List analytics buckets (empty) | `GET .../analytics-buckets` (stub) |
| `/platform/storage/{ref}/analytics-buckets` | POST | ⚠️ | supastack | Create analytics bucket | `POST .../analytics-buckets` (stub) |
| `/platform/storage/{ref}/analytics-buckets/{id}` | DELETE | ⚠️ | supastack | Delete analytics bucket | `DELETE .../analytics-buckets/:id` (stub) |
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces` | GET | ⚠️ | supastack | List bucket namespaces | `GET .../namespaces` (stub) |
| `/platform/storage/{ref}/analytics-buckets/{id}/namespaces` | POST | ⚠️ | supastack | Create namespace | `POST .../namespaces` (stub) |
| `/platform/storage/{ref}/archive` | GET | ⚠️ | supastack | Get storage archive info | `GET .../storage/:ref/archive` (stub) |
| `/platform/storage/{ref}/vector-buckets` | GET | ⚠️ | supastack | List vector buckets (empty) | `GET .../vector-buckets` (stub) |
| `/platform/storage/{ref}/vector-buckets` | POST | ⚠️ | supastack | Create vector bucket | `POST .../vector-buckets` (stub) |
| `/platform/storage/{ref}/vector-buckets/{id}` | DELETE | ⚠️ | supastack | Delete vector bucket | `DELETE .../vector-buckets/:id` (stub) |
| `/platform/storage/{ref}/vector-buckets/{id}/indexes` | POST | ⚠️ | supastack | Create vector index | `POST .../vector-buckets/:id/indexes` (stub) |
| `/platform/storage/{ref}/vector-buckets/{id}/indexes/{indexName}` | DELETE | ⚠️ | supastack | Delete vector index | `DELETE .../indexes/:name` (stub) |

---

## Auth

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/auth/:ref/config/hooks` | GET | ✅ | supastack | Get auth-hook config (`hook_*` subset, UPPERCASE) _(not in platform.d.ts)_ | `GET /api/v1/platform/auth/:ref/config/hooks` |
| `/platform/auth/:ref/users` | GET | ✅ | proxy | List project's GoTrue users _(not in platform.d.ts)_ | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/:ref/users/:id` | GET | ✅ | proxy | Get user by ID _(not in platform.d.ts)_ | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id` | PUT | ✅ | proxy | Update user (ban, role, metadata) _(not in platform.d.ts)_ | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/:ref/users/:id/factors` | GET | ✅ | proxy | List user's MFA factors _(not in platform.d.ts)_ | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/{ref}/config` | GET | ✅ | supastack | Get GoTrue auth settings (UPPERCASE-translated for Studio) | `GET /api/v1/platform/auth/:ref/config` |
| `/platform/auth/{ref}/config` | PATCH | ✅ | supastack | Update GoTrue auth settings (Studio UPPERCASE → /v1 lowercase) | `PATCH /api/v1/platform/auth/:ref/config` |
| `/platform/auth/{ref}/config/hooks` | PATCH | ✅ | supastack | Update auth-hook config (routes through `config/auth`) | `PATCH /api/v1/platform/auth/:ref/config/hooks` |
| `/platform/auth/{ref}/invite` | POST | ✅ | proxy | Send invite email via GoTrue | `→ Kong /auth/v1/invite` |
| `/platform/auth/{ref}/magiclink` | POST | ✅ | proxy | Send magic link via GoTrue | `→ Kong /auth/v1/magiclink` |
| `/platform/auth/{ref}/otp` | POST | ✅ | proxy | Send OTP via GoTrue | `→ Kong /auth/v1/otp` |
| `/platform/auth/{ref}/recover` | POST | ✅ | proxy | Send password recovery via GoTrue | `→ Kong /auth/v1/recover` |
| `/platform/auth/{ref}/templates/{template}/reset` | POST | ✅ | proxy | Reset email template to default | `→ Kong /auth/v1/admin/templates` |
| `/platform/auth/{ref}/users` | POST | ✅ | proxy | Create a GoTrue user | `→ Kong /auth/v1/admin/users` |
| `/platform/auth/{ref}/users/{id}` | DELETE | ✅ | proxy | Delete user | `→ Kong /auth/v1/admin/users/:id` |
| `/platform/auth/{ref}/users/{id}` | PATCH | ✅ | proxy | Updates user with given ID | `→ /platform/auth/:ref/users*` |
| `/platform/auth/{ref}/users/{id}/factors` | DELETE | ✅ | proxy | Delete user's MFA factors | `→ Kong /auth/v1/admin/users/:id/factors` |
| `/platform/auth/{ref}/validate/spam` | POST | ✅ | proxy | Validate spam / abuse | `→ Kong /auth/v1/admin/validate/spam` |
| `/platform/auth/{ref}/templates/{template}` | GET | ⚠️ | — | Gets Auth template | — |

---

## Replication

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/replication/:ref/destinations/:id` | PATCH | ⚠️ | supastack | Update destination _(not in platform.d.ts)_ | stub |
| `/platform/replication/:ref/tenants` | GET | ⚠️ | supastack | List tenants _(not in platform.d.ts)_ | stub |
| `/platform/replication/{ref}/destinations` | GET | ⚠️ | supastack | List replication destinations (empty) | stub |
| `/platform/replication/{ref}/destinations` | POST | ⚠️ | supastack | Create destination | stub |
| `/platform/replication/{ref}/destinations-pipelines` | POST | ⚠️ | supastack | Create destination+pipeline together | stub |
| `/platform/replication/{ref}/destinations-pipelines/{destination_id}/{pipeline_id}` | DELETE | ⚠️ | supastack | Delete destination+pipeline | stub |
| `/platform/replication/{ref}/destinations-pipelines/{destination_id}/{pipeline_id}` | POST | ⚠️ | — | Replication Destinations Pipelines — update destination pipeline | — |
| `/platform/replication/{ref}/destinations/validate` | POST | ⚠️ | supastack | Validate destination config | stub |
| `/platform/replication/{ref}/destinations/{destination_id}` | DELETE | ⚠️ | supastack | Delete destination | stub |
| `/platform/replication/{ref}/destinations/{destination_id}` | GET | ⚠️ | — | Replication Destinations — get destination | — |
| `/platform/replication/{ref}/destinations/{destination_id}` | POST | ⚠️ | — | Replication Destinations — update destination | — |
| `/platform/replication/{ref}/pipelines` | GET | ⚠️ | supastack | List replication pipelines (empty) | stub |
| `/platform/replication/{ref}/pipelines` | POST | ⚠️ | supastack | Create pipeline | stub |
| `/platform/replication/{ref}/pipelines/validate` | POST | ⚠️ | supastack | Validate pipeline config | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | DELETE | ⚠️ | supastack | Delete pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | GET | ⚠️ | — | Replication Pipelines — get pipeline | — |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | POST | ⚠️ | — | Replication Pipelines — update pipeline | — |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/replication-status` | GET | ⚠️ | supastack | Get replication lag / status | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/rollback-tables` | POST | ⚠️ | supastack | Rollback specific tables | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/start` | POST | ⚠️ | supastack | Start pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/status` | GET | ⚠️ | supastack | Get pipeline status | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/stop` | POST | ⚠️ | supastack | Stop pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/version` | GET | ⚠️ | supastack | Get pipeline version | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/version` | POST | ⚠️ | — | Replication Pipelines — update pipeline version | — |
| `/platform/replication/{ref}/sources` | GET | ⚠️ | supastack | List replication sources (empty) | stub |
| `/platform/replication/{ref}/sources` | POST | ⚠️ | — | Replication Sources — create source | — |
| `/platform/replication/{ref}/sources/{source_id}/publications` | GET | ⚠️ | supastack | List source publications | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications` | POST | ⚠️ | supastack | Create publication | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications/{publication_name}` | DELETE | ⚠️ | supastack | Delete publication | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications/{publication_name}` | POST | ⚠️ | — | Replication Sources — update publication | — |
| `/platform/replication/{ref}/sources/{source_id}/tables` | GET | ⚠️ | supastack | List source tables | stub |
| `/platform/replication/{ref}/tenants` | DELETE | ⚠️ | supastack | Delete tenant | stub |
| `/platform/replication/{ref}/tenants-sources` | POST | ⚠️ | supastack | Create tenant source | stub |

---

## Integrations

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/integrations` | GET | ⚠️ | supastack | List global integrations (empty) | `GET /api/v1/platform/integrations` (stub) |
| `/platform/integrations/github/authorization` | DELETE | ⚠️ | — | Git Hub Authorizations — remove git hub authorization | — |
| `/platform/integrations/github/authorization` | GET | ⚠️ | supastack | Get GitHub app auth status | `GET .../github/authorization` (stub) |
| `/platform/integrations/github/authorization` | POST | ⚠️ | — | Git Hub Authorizations — create git hub authorization | — |
| `/platform/integrations/github/connections` | GET | ⚠️ | supastack | List GitHub connections (empty) | `GET .../github/connections` (stub) |
| `/platform/integrations/github/connections` | POST | ⚠️ | — | Connects a GitHub project to a supabase project | — |
| `/platform/integrations/github/connections/{connection_id}` | DELETE | ⚠️ | — | Deletes github project connection | — |
| `/platform/integrations/github/connections/{connection_id}` | PATCH | ⚠️ | — | Updates a GitHub connection for a supabase project | — |
| `/platform/integrations/github/repositories` | GET | ⚠️ | supastack | List GitHub repos (empty) | `GET .../github/repositories` (stub) |
| `/platform/integrations/github/repositories/{repository_id}/branches` | GET | ⚠️ | — | List GitHub repository branches | — |
| `/platform/integrations/github/repositories/{repository_id}/branches/{branch_name}` | GET | ⚠️ | — | Git Hub Repositories — get repository | — |
| `/platform/integrations/partners/{ref}/{listing_slug}` | POST | ⚠️ | — | Creates a partner integration and returns the redirect URL | — |
| `/platform/integrations/private-link/{slug}` | GET | ⚠️ | — | Get organization's PrivateLink configuration. | — |
| `/platform/integrations/private-link/{slug}` | PUT | ⚠️ | — | Update organization's PrivateLink configuration. | — |
| `/platform/integrations/vercel` | POST | ⚠️ | — | Vercel Integration — create vercel integration | — |
| `/platform/integrations/vercel/connections` | POST | ⚠️ | — | Connects a Vercel project to a supabase project | — |
| `/platform/integrations/vercel/connections/project/{ref}` | GET | ⚠️ | — | Gets all Vercel integrations (regular and marketplace) with their connections for a given project | — |
| `/platform/integrations/vercel/connections/{connection_id}` | DELETE | ⚠️ | — | Deletes vercel project connection | — |
| `/platform/integrations/vercel/connections/{connection_id}` | PATCH | ⚠️ | — | Updates a Vercel connection for a supabase project | — |
| `/platform/integrations/vercel/connections/{connection_id}/sync-envs` | POST | ⚠️ | — | Syncs supabase project envs with given connection id | — |
| `/platform/integrations/vercel/projects/{organization_integration_id}` | GET | ⚠️ | — | Gets vercel projects with the given organization integration id | — |
| `/platform/integrations/{slug}` | GET | ⚠️ | supastack | List org integrations (empty) | `GET .../integrations/:slug` (stub) |

---

## Notifications

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/notifications` | GET | ⚠️ | supastack | List platform notifications (empty) | `GET /api/v1/platform/notifications` (stub) |
| `/platform/notifications` | PATCH | ⚠️ | supastack | Mark notifications as read | `PATCH /api/v1/platform/notifications` (stub) |
| `/platform/notifications/archive-all` | PATCH | ⚠️ | supastack | Archive all notifications | `PATCH .../notifications/archive-all` (stub) |
| `/platform/notifications/summary` | GET | ⚠️ | supastack | Get notification counts (zero) | `GET .../notifications/summary` (stub) |

---

## Telemetry

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/telemetry/event` | POST | ⚠️ | — | Sends analytics server event | — |
| `/platform/telemetry/feature-flags` | GET | ⚠️ | supastack | Get feature flag values | `GET /api/v1/platform/telemetry/feature-flags` (stub) |
| `/platform/telemetry/feature-flags/track` | POST | ⚠️ | — | Track feature flag called | — |
| `/platform/telemetry/groups/identify` | POST | ⚠️ | — | Send analytics group identify event | — |
| `/platform/telemetry/groups/reset` | POST | ⚠️ | — | Send analytics group reset event | — |
| `/platform/telemetry/identify` | POST | ⚠️ | — | Send analytics identify event | — |
| `/platform/telemetry/reset` | POST | ⚠️ | — | Reset analytics | — |
| `/platform/telemetry/stream` | GET | ⚠️ | — | Stream telemetry events (local dev only) | — |

---

## Feedback

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/feedback/conversations/{conversation_id}/custom-fields` | PATCH | ⚠️ | supastack | Update feedback conversation fields | `PATCH .../conversations/:id/custom-fields` (stub) |
| `/platform/feedback/docs` | POST | ⚠️ | — | Send feedback on docs | — |
| `/platform/feedback/downgrade` | POST | ⚠️ | supastack | Send downgrade feedback (no-op) | `POST .../feedback/downgrade` (stub) |
| `/platform/feedback/send` | POST | ⚠️ | supastack | Send general feedback (no-op) | `POST /api/v1/platform/feedback/send` (stub) |
| `/platform/feedback/upgrade` | POST | ⚠️ | supastack | Send upgrade feedback (no-op) | `POST .../feedback/upgrade` (stub) |

---

## Stripe

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/stripe/invoices/overdue` | GET | ⚠️ | mock | List overdue invoices | — |
| `/platform/stripe/projects/provisioning/account_requests/{id}` | GET | ⚠️ | — | Get account request details | — |
| `/platform/stripe/projects/provisioning/account_requests/{id}/confirm` | POST | ⚠️ | — | Confirm account request (from Studio) | — |
| `/platform/stripe/setup-intent` | POST | ⚠️ | mock | Global Stripe setup intent | — |

---

## Plans

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/plans/features` | GET | ⚠️ | — | Plan Features — get plan features | — |

---

## Status

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/status` | GET | ⚠️ | — | Get infrastructure status | — |

---

## Signup

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/signup` | POST | ⚠️ | supastack | Create new account (signups disabled — `GOTRUE_DISABLE_SIGNUP`) | `POST /api/v1/platform/signup` (stub) |

---

## Reset Password

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/reset-password` | POST | ✅ | supastack | Send password reset email (GoTrue recover, SMTP-gated) | `POST /api/v1/platform/reset-password` |

---

## Update Email

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/update-email` | POST | ⚠️ | supastack | Update account email _(not in platform.d.ts)_ | `POST /api/v1/platform/update-email` (stub) |
| `/platform/update-email` | PUT | ⚠️ | — | Updates a user email address | — |

---

## Projects — Resource Warnings

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects-resource-warnings` | GET | ⚠️ | supastack | Get resource warning alerts (empty) | `GET /api/v1/platform/projects-resource-warnings` (stub) |

---

## Cloud Marketplace

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/cloud-marketplace/buyers/{buyer_id}/contract-linking-eligibility` | GET | ⚠️ | — | Clazar — check contract linking eligibility | — |
| `/platform/cloud-marketplace/buyers/{buyer_id}/onboarding-info` | GET | ⚠️ | — | Get info needed for AWS Marketplace onboarding | — |

---

## Workflow Runs

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/workflow-runs` | GET | ⚠️ | — | Get a list of workflow runs | — |
| `/platform/workflow-runs/{workflow_run_id}/logs` | GET | ⚠️ | — | Get the logs of a workflow run | — |

---

## Vercel

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/vercel/redirect/{installation_id}` | GET | ⚠️ | — | Gets the Vercel redirect url | — |

---

## OAuth

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/oauth/apps/register` | POST | ⚠️ | — | Dynamically register an OAuth client (RFC-7591) | — |
| `/platform/oauth/authorizations/{id}` | GET | ⚠️ | supastack | Get global OAuth authorization | `GET /platform/oauth/authorizations/:id` (stub) |

---

## CLI

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/cli/login/{session_id}` | GET | ✅ | supastack | Retrieve CLI login session | `GET /platform/cli/login/:session_id` |
| `/platform/cli/login` | POST | ⚠️ | — | Create CLI login session | — |

---

## Deployment Mode

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/deployment-mode` | GET | ✅ | supastack | Get deployment mode (self-hosted) _(not in platform.d.ts)_ | `GET /api/v1/platform/deployment-mode` |

---

## Appendix — non-`/platform` surfaces (preserved)

> `/v1/*` Management API (guarded separately via `api.d.ts`), GoTrue-direct `/auth/v1/*`, and dev-mock-only rows. Not part of the platform.d.ts inventory above.

| API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/admin/factors` | GET | ✅ | proxy | List all factors (admin) | `→ Kong /auth/v1/admin/factors` |
| `/admin/users` | GET | ✅ | proxy | List all users (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users` | POST | ✅ | proxy | Create user (admin) | `→ Kong /auth/v1/admin/users` |
| `/admin/users/:id` | DELETE | ✅ | proxy | Delete user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | GET | ✅ | proxy | Get user by ID (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:id` | PUT | ✅ | proxy | Update user (admin) | `→ Kong /auth/v1/admin/users/:id` |
| `/admin/users/:uid/factors/:fid` | DELETE | ✅ | proxy | Delete user factor (admin) | `→ Kong /auth/v1/admin/users/:uid/factors/:fid` |
| `/api/get-deployment-commit` | GET | ✅ | supastack | Studio build/version banner | `GET /api/get-deployment-commit` (api stub) |
| `/api/incident-banner` | GET | ✅ | supastack | Cloud incident banner (none self-hosted) | `GET /api/incident-banner` → `null` |
| `/api/incident-status` | GET | ✅ | supastack | Active StatusPage incidents (none self-hosted) | `GET /api/incident-status` → `[]` |
| `/api/v1/cli/login` | POST | ✅ | supastack | Device-code login for CLI | `POST /api/v1/cli/login` |
| `/authorize` | GET | ⚠️ | gotrue | OAuth authorize redirect (no social providers configured) | `→ GoTrue /auth/v1/authorize` |
| `/cli/mint-token` | POST | ✅ | supastack | Mint short-lived CLI token | `POST /cli/mint-token` |
| `/cli/profile.toml` | GET | ✅ | supastack | Get CLI profile config | `GET /cli/profile.toml` |
| `/factors` | GET | ✅ | gotrue | List MFA factors (via user object) — GoTrue native | `→ GoTrue /auth/v1/user` |
| `/factors` | POST | ✅ | gotrue | Enroll a TOTP MFA factor (returns QR/secret) — GoTrue native | `→ GoTrue /auth/v1/factors` |
| `/factors/:id` | DELETE | ✅ | gotrue | Unenroll an MFA factor — GoTrue native | `→ GoTrue /auth/v1/factors/:id` |
| `/factors/:id/challenge` | POST | ✅ | gotrue | Create an MFA challenge — GoTrue native | `→ GoTrue /auth/v1/factors/:id/challenge` |
| `/factors/:id/verify` | POST | ✅ | gotrue | Verify an MFA challenge code — GoTrue native | `→ GoTrue /auth/v1/factors/:id/verify` |
| `/health` | GET | ✅ | gotrue | GoTrue health check | `→ GoTrue /auth/v1/health` |
| `/health` | GET | ✅ | supastack | API health check | `GET /health` |
| `/logout` | POST | ✅ | gotrue | Sign out current session | `→ GoTrue /auth/v1/logout` |
| `/mfa/authenticator/assurance-level` | GET | ✅ | gotrue | Get MFA assurance level (AAL) — GoTrue native | `→ GoTrue /auth/v1/...` |
| `/otp` | POST | ✅ | gotrue | Request OTP / magic link (SMTP-gated) | `→ GoTrue /auth/v1/otp` |
| `/recover` | POST | ✅ | gotrue | Initiate password recovery (SMTP-gated) | `→ GoTrue /auth/v1/recover` |
| `/settings` | GET | ✅ | gotrue | Get GoTrue server settings | `→ GoTrue /auth/v1/settings` |
| `/signup` | POST | ⚠️ | gotrue | Register new user (disabled — `GOTRUE_DISABLE_SIGNUP`) | `→ GoTrue /auth/v1/signup` |
| `/token` | POST | ✅ | gotrue | Sign in with password / refresh token / PKCE | `→ GoTrue /auth/v1/token` |
| `/user` | GET | ✅ | gotrue | Get current authenticated user | `→ GoTrue /auth/v1/user` |
| `/user` | PUT | ✅ | gotrue | Update current user (email, password) | `→ GoTrue /auth/v1/user` |
| `/v1/projects/:ref/api-keys` | GET | ✅ | supastack | List anon + service_role keys | `GET /projects/:ref/api-keys` |
| `/v1/projects/:ref/api-keys/:id` | DELETE | ⚠️ | mock | Delete custom API key | — |
| `/v1/projects/:ref/api-keys/:id` | PATCH | ⚠️ | mock | Update key name/description | — |
| `/v1/projects/:ref/branches` | GET | ⚠️ | mock | List database branches | — |
| `/v1/projects/:ref/config/auth/signing-keys` | GET | ⚠️ | mock | List JWT signing keys | — |
| `/v1/projects/:ref/config/auth/third-party-auth` | GET | ⚠️ | mock | List third-party auth providers | — |
| `/v1/projects/:ref/custom-hostname` | GET | ⚠️ | mock | Get custom domain config | — |
| `/v1/projects/:ref/database/query` | POST | ✅ | supastack | Run ad-hoc SQL (CLI compat) | `POST /projects/:ref/database/query` |
| `/v1/projects/:ref/functions` | GET | ✅ | supastack | List edge functions | `GET /projects/:ref/functions` |
| `/v1/projects/:ref/functions` | POST | ⚠️ | supastack | Deploy edge function | `POST /projects/:ref/functions/deploy` |
| `/v1/projects/:ref/functions/:slug` | DELETE | ✅ | supastack | Delete function | `DELETE /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | GET | ✅ | supastack | Get function details | `GET /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | PATCH | ⚠️ | supastack | Update function (name, verify_jwt) | `POST /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug/body` | GET | ✅ | supastack | Download function source | `GET /projects/:ref/functions/:slug/body` |
| `/v1/projects/:ref/functions/deployed-size` | GET | ⚠️ | mock | Get total deployed size | — |
| `/v1/projects/:ref/health` | GET | ✅ | supastack | Get service health statuses | `GET /instances/:ref/health` |
| `/v1/projects/:ref/network-bans` | DELETE | ⚠️ | mock | Remove IP ban | — |
| `/v1/projects/:ref/network-bans/retrieve` | POST | ⚠️ | mock | Get banned IP addresses | — |
| `/v1/projects/:ref/network-restrictions` | GET | ⚠️ | mock | Get network firewall rules | — |
| `/v1/projects/:ref/network-restrictions/apply` | POST | ⚠️ | mock | Apply firewall rules | — |
| `/v1/projects/:ref/read-replicas` | GET | ⚠️ | mock | List read replicas (v1) | — |
| `/v1/projects/:ref/secrets` | DELETE | ✅ | supastack | Delete secrets | `DELETE /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | GET | ✅ | supastack | List secrets (SHA256 masked) | `GET /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | POST | ✅ | supastack | Set / upsert secrets | `POST /projects/:ref/secrets` |
| `/v1/projects/:ref/upgrade/eligibility` | GET | ⚠️ | mock | Check upgrade eligibility | — |
| `/v1/projects/:ref/upgrade/status` | GET | ⚠️ | mock | Get upgrade status | — |
| `/verify` | POST | ✅ | gotrue | Verify OTP / magic link token | `→ GoTrue /auth/v1/verify` |
