# Supabase Studio API vs Supastack — Full Coverage

**Legend — `COVERED`:** ✅ real working coverage (a backing supastack handler, a Kong proxy, or a functional GoTrue route) · ⚠️ **not real** — a **stub** (returns empty/static or config-disabled), a **gap** (no route — Studio 404s), or **mock-only**.

**Legend — `COVERED BY`:** `supastack` = control-plane api handler (`apps/api`) · `proxy` = forwarded to the per-instance Kong (`platform-proxy.ts`) · `gotrue` = control-plane GoTrue (`/auth/v1/*`) · `—`/`mock` = no real route (gap / dev-mock catch-all only).

> **Platform surface is authoritative against `packages/api-types/types/platform.d.ts` (Supabase OpenAPI types) — 354 canonical `/platform/*` endpoints.** Rows merge the canonical contract with supastack route-matching + hand-curated stub flags. "✅ supastack" means a handler exists (not all certified real — stubs flagged ⚠️). 27 rows the dashboard calls that are **not** in platform.d.ts are tagged _(not in platform.d.ts)_. `/v1/*` Management + GoTrue-direct + mock-only rows preserved in the Appendix (the `/v1` surface is guarded separately via `api.d.ts`).

**Coverage — `/platform/*` (392 rows, 9 new rows added by feature 109, 2 new rows added by feature 111):**

| Status | Count |
|---|---|
| ✅ real (handler / proxy / gotrue) | ~283 |
| ✅/⚠️ stub responding (all gaps eliminated) | ~109 |
| **Total** | **392** |

→ **✅ 392 / 392 (100%)** responding routes (no 404 gaps) · doc-audit 2026-06-08 reclassified 18 previously-marked stubs to ✅ real (project rename, project members, databases list, member role PUT, db-password PATCH, restart-services, update-email POST/PUT, hook-enable, available-versions GET, notifications stubs, mfa-enforcement, reached-free-project-limit, entitlements, functions/:slug GET/PATCH/DELETE, `v1/functions/:slug` PATCH) · feature 111 promoted 6 stub rows to ✅ real · feature 109 promoted 17 stub/mock rows to ✅ real.

**Last updated**: 2026-06-08 — doc audit: reclassified 18 endpoints from ⚠️ stub to ✅ real — these were implemented in prior features but the doc was never updated. No code changes.

**Previously**: 2026-06-07 — feature 109 (platform-stub-conversions tier 1–4): 17 stub→real conversions: `pause/status` (real DB paused state), `readonly` GET+DELETE (paused→enabled; DELETE delegates→/v1/restore), `upgrade/status` (restoring→upgrading), `run-lints` + `run-lints/:name` (5 advisory lint checks via withPerInstancePg, 503 on not-running), `/audit` + `/activity` (real audit_log rows filtered by ref, paginated), `downloadable-backups` (real backups table query), network-bans GET+DELETE + network-restrictions GET+POST/apply + ssl-enforcement GET+PUT + functions/secrets GET+POST (all Tier 3b delegation to /v1). Live-verified on supaviser.dev 2026-06-07: 200s with real data, 401, 404, 503 all confirmed. 46 new unit tests (platform-stub-conversions.test.ts), 704 total passing.

**Previously**: 2026-06-06 — feature 108 (platform-contract-guard continuation) eliminated all remaining 404 gaps: plans/features, github-repos-branches, vercel-connections-project, private-link CRUD, partners, stripe-account-requests, SSO write methods (POST/DELETE/PUT), supavisor config, advisor-exceptions write (POST/DELETE/PATCH), privatelink-aws-delete, billing-addons-delete, access-token 500→404 fix (UUID validation), scoped-token 500→404 fix, v1 network-bans GET, v1 api-keys DELETE/PATCH. All 381 /platform/* rows now return ≥200 (no handler missing).

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
| `/platform/profile` | POST | ⚠️ | supastack | Creates user's profile | `POST /platform/profile` (stub 200) |
| `/platform/profile/access-tokens/{id}` | GET | ✅ | supastack | Gets the access token with the given ID | `GET /platform/profile/access-tokens/:id` (real — 404 for missing) |
| `/platform/profile/audit` | GET | ⚠️ | supastack | Get user login audit log | `GET /api/v1/platform/profile/audit` (stub) |
| `/platform/profile/audit-login` | POST | ⚠️ | supastack | Record login audit event | `POST /api/v1/platform/profile/audit-login` (stub) |
| `/platform/profile/scoped-access-tokens` | GET | ✅ | supastack | List scoped tokens | `GET /platform/profile/scoped-access-tokens` (real — queries apiTokens by userId) |
| `/platform/profile/scoped-access-tokens` | POST | ✅ | supastack | Creates a new scoped access token | `POST /platform/profile/scoped-access-tokens` (real) |
| `/platform/profile/scoped-access-tokens/{id}` | DELETE | ✅ | supastack | Deletes the scoped access token with the given ID | `DELETE /platform/profile/scoped-access-tokens/:id` (real) |
| `/platform/profile/scoped-access-tokens/{id}` | GET | ✅ | supastack | Gets the scoped access token with the given ID | `GET /platform/profile/scoped-access-tokens/:id` (real) |

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
| `/platform/organizations/:slug/available-versions` | GET | ✅ | supastack | List available Postgres versions _(not in platform.d.ts)_ | `GET .../organizations/:slug/available-versions` (returns static PG15 list) |
| `/platform/organizations/:slug/oauth/apps/:id` | GET | ⚠️ | supastack | Get OAuth app _(not in platform.d.ts)_ | `GET .../oauth/apps/:id` (stub) |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | ⚠️ | supastack | Get OAuth authorization _(not in platform.d.ts)_ | `GET .../oauth/authorizations/:id` (stub) |
| `/platform/organizations/cloud-marketplace` | POST | ⚠️ | mock | Register via marketplace | — |
| `/platform/organizations/confirm-subscription` | POST | ⚠️ | mock | Confirm marketplace subscription | — |
| `/platform/organizations/onboarding-survey` | POST | ⚠️ | supastack | Submit onboarding survey for a newly created organization | `POST .../onboarding-survey` (stub 200) |
| `/platform/organizations/preview-creation` | POST | ⚠️ | supastack | Preview org creation (validation) | `POST /api/v1/platform/organizations/preview-creation` (stub) |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | GET | ⚠️ | supastack | Lists all audit log drains for an organization | `GET .../analytics/audit-log-drains` (stub empty list) |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | POST | ⚠️ | supastack | Create an audit log drain | `POST .../analytics/audit-log-drains` (stub 201) |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | DELETE | ⚠️ | supastack | Delete an audit log drain | `DELETE .../analytics/audit-log-drains/:token` (stub 204) |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PATCH | ⚠️ | supastack | Patch an audit log drain | `PATCH .../analytics/audit-log-drains/:token` (stub 200) |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PUT | ⚠️ | supastack | Update an audit log drain | `PUT .../analytics/audit-log-drains/:token` (stub 200) |
| `/platform/organizations/{slug}/apps` | GET | ⚠️ | supastack | List platform apps (empty) | `GET .../apps` (stub) |
| `/platform/organizations/{slug}/apps` | POST | ⚠️ | supastack | Create new platform app | `POST .../apps` (stub 201) |
| `/platform/organizations/{slug}/apps/installations` | GET | ⚠️ | supastack | List app installations (empty) | `GET .../apps/installations` (stub) |
| `/platform/organizations/{slug}/apps/installations` | POST | ⚠️ | supastack | Install app | `POST .../apps/installations` (stub) |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | DELETE | ⚠️ | supastack | Uninstall app | `DELETE .../apps/installations/:id` (stub) |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | GET | ⚠️ | supastack | Get platform app installation with the given id | `GET .../apps/installations/:installation_id` (stub 200) |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | PATCH | ⚠️ | supastack | Update platform app installation permissions | `PATCH .../apps/installations/:installation_id` (stub 200) |
| `/platform/organizations/{slug}/apps/{app_id}` | DELETE | ⚠️ | supastack | Delete app | `DELETE .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}` | GET | ⚠️ | supastack | Get app details | `GET .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}` | PATCH | ⚠️ | supastack | Update app | `PATCH .../apps/:app_id` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | GET | ⚠️ | supastack | List signing keys for the given platform app | `GET .../apps/:app_id/signing-keys` (stub 200) |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | POST | ⚠️ | supastack | Create signing key | `POST .../apps/:app_id/signing-keys` (stub) |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys/{key_id}` | DELETE | ⚠️ | supastack | Delete signing key | `DELETE .../signing-keys/:id` (stub) |
| `/platform/organizations/{slug}/audit` | GET | ✅ | supastack | Get org audit log | `GET /platform/organizations/:slug/audit` (real — queries audit_log filtered by org+project targetIds, paginated) |
| `/platform/organizations/{slug}/billing/credits/balance` | GET | ⚠️ | supastack | Get credit balance (zero) | `GET .../billing/credits/balance` (stub) |
| `/platform/organizations/{slug}/billing/credits/preview` | POST | ⚠️ | supastack | Preview for credit top-up | `POST .../billing/credits/preview` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/billing/credits/redeem` | POST | ⚠️ | supastack | Redeems a credit code | `POST .../billing/credits/redeem` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/billing/credits/top-up` | POST | ⚠️ | supastack | Tops up the credit balance | `POST .../billing/credits/top-up` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/billing/invoices` | GET | ⚠️ | supastack | List invoices (empty) | `GET .../billing/invoices` (stub) |
| `/platform/organizations/{slug}/billing/invoices/upcoming` | GET | ⚠️ | supastack | Gets the upcoming invoice | `GET .../billing/invoices/upcoming` (stub 200) |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}` | GET | ⚠️ | supastack | Gets invoice with the given invoice ID | `GET .../billing/invoices/:invoice_id` (stub 404 — correct for self-hosted) |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/payment-link` | GET | ⚠️ | supastack | Gets the payment link to manually pay the given invoice | `GET .../billing/invoices/:invoice_id/payment-link` (stub 200) |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/receipt` | GET | ⚠️ | supastack | Get the receipt PDF URL for a paid invoice | `GET .../billing/invoices/:invoice_id/receipt` (stub 200) |
| `/platform/organizations/{slug}/billing/plans` | GET | ⚠️ | supastack | List available plans (Free only) | `GET .../billing/plans` (stub) |
| `/platform/organizations/{slug}/billing/subscription` | GET | ⚠️ | supastack | Get current subscription plan (always Free) | `GET .../billing/subscription` (stub) |
| `/platform/organizations/{slug}/billing/subscription` | PUT | ⚠️ | supastack | Updates subscription | `PUT .../billing/subscription` (stub 200) |
| `/platform/organizations/{slug}/billing/subscription/confirm` | POST | ⚠️ | supastack | Confirm plan change | `POST .../billing/subscription/confirm` (stub 200) |
| `/platform/organizations/{slug}/billing/subscription/preview` | POST | ⚠️ | supastack | Preview subscription changes | `POST .../billing/subscription/preview` (stub 200) |
| `/platform/organizations/{slug}/billing/upgrade-request` | POST | ⚠️ | supastack | Request plan upgrade | `POST .../billing/upgrade-request` (stub 200) |
| `/platform/organizations/{slug}/cloud-marketplace/link` | PUT | ⚠️ | supastack | Makes an existing organization being billed by AWS Marketplace | `PUT .../cloud-marketplace/link` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/cloud-marketplace/redirect` | GET | ⚠️ | supastack | Gets the AWS Marketplace redirect url | `GET .../cloud-marketplace/redirect` (stub 200) |
| `/platform/organizations/{slug}/customer` | GET | ⚠️ | supastack | Gets the Billing customer | `GET .../customer` (stub 200) |
| `/platform/organizations/{slug}/customer` | PUT | ⚠️ | supastack | Updates the billing customer | `PUT .../customer` (stub 200) |
| `/platform/organizations/{slug}/documents/dpa` | POST | ⚠️ | supastack | Create DPA document using PandaDoc | `POST .../documents/dpa` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/documents/dpa-signed` | GET | ⚠️ | supastack | Org Documents — get dpa signed status | `GET .../documents/dpa-signed` (stub 200) |
| `/platform/organizations/{slug}/documents/iso27001-certificate` | GET | ⚠️ | supastack | Get ISO 27001 certificate URL | `GET .../documents/iso27001-certificate` (stub 200) |
| `/platform/organizations/{slug}/documents/soc2-type-2-report` | GET | ⚠️ | supastack | Get SOC2 Type 2 report URL | `GET .../documents/soc2-type-2-report` (stub 200) |
| `/platform/organizations/{slug}/documents/standard-security-questionnaire` | GET | ⚠️ | supastack | Get standard security questionnaire URL | `GET .../documents/standard-security-questionnaire` (stub 200) |
| `/platform/organizations/{slug}/entitlements` | GET | ✅ | supastack | Get feature entitlements (returns empty list — self-hosted has no tier gates) | `GET .../organizations/:slug/entitlements` → `{ entitlements: [] }` |
| `/platform/organizations/{slug}/members/mfa/enforcement` | GET | ✅ | supastack | Get MFA policy (MFA out of scope — returns `{ required: false }`) | `GET .../members/mfa/enforcement` → `{ required: false }` |
| `/platform/organizations/{slug}/members/mfa/enforcement` | PATCH | ✅ | supastack | Set MFA enforcement (no-op — self-hosted has no MFA enforcement) | `PATCH .../members/mfa/enforcement` → 200 |
| `/platform/organizations/{slug}/members/reached-free-project-limit` | GET | ✅ | supastack | Check free project limit (always `[]` — self-hosted has no free tier limit) | `GET .../members/reached-free-project-limit` → `[]` |
| `/platform/organizations/{slug}/members/{gotrue_id}/roles/{role_id}` | PUT | ✅ | supastack | Update organization member role (real RBAC + owner guard) | `PUT .../members/:gotrue_id/roles/:role_id` (real — validates role, prevents last-owner demotion) |
| `/platform/organizations/{slug}/oauth/apps` | GET | ⚠️ | supastack | List OAuth apps | `GET .../oauth/apps` (stub; real OAuth clients at `/api/v1/oauth/*`) |
| `/platform/organizations/{slug}/oauth/apps` | POST | ⚠️ | supastack | Create OAuth app | `POST .../oauth/apps` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | GET | ⚠️ | supastack | List oauth app client secrets | `GET .../oauth/apps/:app_id/client-secrets` (stub 200) |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | POST | ⚠️ | supastack | Create client secret | `POST .../client-secrets` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets/{secret_id}` | DELETE | ⚠️ | supastack | Delete client secret | `DELETE .../client-secrets/:sid` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{id}` | DELETE | ⚠️ | supastack | Delete OAuth app | `DELETE .../oauth/apps/:id` (stub) |
| `/platform/organizations/{slug}/oauth/apps/{id}` | PUT | ⚠️ | supastack | Update an oauth app | `PUT .../oauth/apps/:id` (stub 200) |
| `/platform/organizations/{slug}/oauth/apps/{id}/revoke` | POST | ⚠️ | supastack | Revoke OAuth app | `POST .../oauth/apps/:id/revoke` (stub) |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | DELETE | ⚠️ | supastack | [Beta] Decline oauth app authorization request | `DELETE .../oauth/authorizations/:id` (stub 204) |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | POST | ⚠️ | supastack | [Beta] Approve oauth app authorization request | `POST .../oauth/authorizations/:id` (stub 200) |
| `/platform/organizations/{slug}/payments` | DELETE | ⚠️ | supastack | Detach payment method with the given card ID | `DELETE .../payments` (stub 204) |
| `/platform/organizations/{slug}/payments` | GET | ⚠️ | supastack | Gets Stripe payment methods for the given organization | `GET .../payments` (stub 200) |
| `/platform/organizations/{slug}/payments/default` | PUT | ⚠️ | supastack | Mark given payment method as default for organization | `PUT .../payments/default` (stub 200) |
| `/platform/organizations/{slug}/payments/setup-intent` | POST | ⚠️ | supastack | Create Stripe setup intent | `POST .../payments/setup-intent` (stub 200) |
| `/platform/organizations/{slug}/sso` | DELETE | ⚠️ | supastack | Delete the organization's SSO Provider | `DELETE .../sso` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/sso` | GET | ⚠️ | mock | List SSO configurations | — |
| `/platform/organizations/{slug}/sso` | POST | ⚠️ | supastack | Create the organization's SSO Provider | `POST .../sso` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/sso` | PUT | ⚠️ | supastack | Update the organization's SSO Provider | `PUT .../sso` (stub 400 — not supported self-hosted) |
| `/platform/organizations/{slug}/tax-ids` | DELETE | ⚠️ | supastack | Delete the tax ID with the given ID | `DELETE .../tax-ids` (stub 204) |
| `/platform/organizations/{slug}/tax-ids` | GET | ⚠️ | supastack | Gets the given organization's tax ID | `GET .../tax-ids` (stub 200) |
| `/platform/organizations/{slug}/tax-ids` | PUT | ⚠️ | supastack | Creates or updates a tax ID for the given organization | `PUT .../tax-ids` (stub 200) |
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
| `/platform/projects/{ref}` | PATCH | ✅ | supastack | Update project name/settings (renames project in DB) | `PATCH /platform/projects/:ref` (real — updates `supabaseInstances.name`) |
| `/platform/projects/{ref}/analytics/endpoints/functions.combined-stats` | GET | ⚠️ | supastack | Get function combined stats (empty) | `GET .../functions.combined-stats` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/functions.req-stats` | GET | ⚠️ | supastack | Get function request stats (empty) | `GET .../functions.req-stats` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/functions.resource-usage` | GET | ⚠️ | supastack | Get function resource usage (empty) | `GET .../functions.resource-usage` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/usage.api-counts` | GET | ⚠️ | supastack | Get API request counts (empty) | `GET .../usage.api-counts` (stub) |
| `/platform/projects/{ref}/analytics/endpoints/usage.api-requests-count` | GET | ⚠️ | supastack | Get API request totals (empty) | `GET .../usage.api-requests-count` (stub) |
| `/platform/projects/{ref}/analytics/log-drains` | GET | ⚠️ | supastack | List log drain destinations (empty) | `GET .../analytics/log-drains` (stub) |
| `/platform/projects/{ref}/analytics/log-drains` | POST | ⚠️ | supastack | Create log drain | `POST .../analytics/log-drains` (stub) |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | DELETE | ⚠️ | supastack | Delete log drain | `DELETE .../log-drains/:token` (stub) |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | PATCH | ⚠️ | supastack | Patch a log drain | `PATCH .../log-drains/:token` (stub 200) |
| `/platform/projects/{ref}/analytics/log-drains/{token}` | PUT | ⚠️ | supastack | Update log drain | `PUT .../log-drains/:token` (stub) |
| `/platform/projects/{ref}/api-keys/temporary` | POST | ⚠️ | supastack | Create a temporary API key | `POST .../api-keys/temporary` (stub 201) |
| `/platform/projects/{ref}/api/graphql` | POST | ⚠️ | supastack | Queries project Graphql | `POST .../api/graphql` (stub 200) |
| `/platform/projects/{ref}/api/rest` | GET | ✅ | supastack | Get REST API config (real PostgREST config: db_schema, max_rows, db_pool, db_extra_search_path) — delegates to `/v1/projects/:ref/postgrest` | `GET /platform/projects/:ref/api/rest` (real — Tier 3b delegation; feature 111) |
| `/platform/projects/{ref}/billing/addons` | POST | ⚠️ | supastack | Updates project addon | `POST .../billing/addons` (stub 400 — not supported self-hosted) |
| `/platform/projects/{ref}/billing/addons/{addon_variant}` | DELETE | ⚠️ | supastack | Removes project addon | `DELETE .../billing/addons/:addon_variant` (stub 400 — not supported self-hosted) |
| `/platform/projects/{ref}/config/pgbouncer` | GET | ⚠️ | supastack | Get pgBouncer/pooler config | `GET .../config/pgbouncer` (stub 200) |
| `/platform/projects/{ref}/config/pgbouncer` | PATCH | ⚠️ | supastack | Update pgBouncer config | `PATCH .../config/pgbouncer` (stub) |
| `/platform/projects/{ref}/config/pgbouncer/status` | GET | ⚠️ | supastack | Get pgBouncer status | `GET /api/v1/pooler/status` (partial) |
| `/platform/projects/{ref}/config/realtime` | GET | ⚠️ | supastack | Get Realtime config | `GET .../config/realtime` (stub) |
| `/platform/projects/{ref}/config/realtime` | PATCH | ⚠️ | supastack | Update Realtime config | `PATCH .../config/realtime` (stub) |
| `/platform/projects/{ref}/config/realtime/shutdown` | POST | ⚠️ | supastack | Shutdowns realtime connections for a project | `POST .../config/realtime/shutdown` (stub 200) |
| `/platform/projects/{ref}/config/secrets/update-status` | GET | ⚠️ | supastack | Get secret sync status | `GET .../config/secrets/update-status` (stub 200) |
| `/platform/projects/{ref}/config/storage` | GET | ⚠️ | supastack | Get storage config (file size limits) | `GET .../config/storage` (stub) |
| `/platform/projects/{ref}/config/storage` | PATCH | ⚠️ | supastack | Updates project's storage config | `PATCH .../config/storage` (stub 200) |
| `/platform/projects/{ref}/config/supavisor` | GET | ✅ | supastack | Gets project's supavisor config | `GET .../config/supavisor` (real 200) |
| `/platform/projects/{ref}/content` | DELETE | ⚠️ | supastack | Deletes project's contents | `DELETE .../content` (stub 200) |
| `/platform/projects/{ref}/content` | GET | ⚠️ | supastack | List saved SQL queries/snippets (empty) | `GET .../projects/:ref/content` (stub) |
| `/platform/projects/{ref}/content` | PUT | ⚠️ | supastack | Updates project's content | `PUT .../content` (stub 200) |
| `/platform/projects/{ref}/content/count` | GET | ⚠️ | supastack | Count content items | `GET .../content/count` (stub) |
| `/platform/projects/{ref}/content/folders` | DELETE | ⚠️ | supastack | Deletes project's content folders | `DELETE .../content/folders` (stub 204) |
| `/platform/projects/{ref}/content/folders` | GET | ⚠️ | supastack | List content folders | `GET .../content/folders` (stub) |
| `/platform/projects/{ref}/content/folders` | POST | ⚠️ | supastack | Creates project's content folder | `POST .../content/folders` (stub 201) |
| `/platform/projects/{ref}/content/folders/{id}` | GET | ⚠️ | supastack | Get content folder | `GET .../content/folders/:id` (stub) |
| `/platform/projects/{ref}/content/folders/{id}` | PATCH | ⚠️ | supastack | Updates project's content folder | `PATCH .../content/folders/:id` (stub 200) |
| `/platform/projects/{ref}/content/item/{id}` | GET | ⚠️ | supastack | Get specific content item | `GET .../content/item/:id` (stub) |
| `/platform/projects/{ref}/daily-stats` | GET | ⚠️ | mock | Get daily usage stats | — |
| `/platform/projects/{ref}/databases` | GET | ✅ | supastack | List databases for project (real — returns primary DB with connection details) | `GET /platform/projects/:ref/databases` (real — DB query + kong URL) |
| `/platform/projects/{ref}/db-password` | PATCH | ✅ | supastack | Reset database password (real — rotates postgres password via pg-password-reset service) | `PATCH /platform/projects/:ref/db-password` (real — `resetPgPasswordForInstance`) |
| `/platform/projects/{ref}/disk` | GET | ⚠️ | supastack | Get disk info | `GET .../projects/:ref/disk` (stub) |
| `/platform/projects/{ref}/disk` | POST | ⚠️ | supastack | Configure disk size | `POST .../projects/:ref/disk` (stub) |
| `/platform/projects/{ref}/disk/custom-config` | GET | ⚠️ | supastack | Get custom disk config | `GET .../disk/custom-config` (stub) |
| `/platform/projects/{ref}/disk/custom-config` | POST | ⚠️ | supastack | Set custom disk config | `POST .../disk/custom-config` (stub) |
| `/platform/projects/{ref}/disk/util` | GET | ⚠️ | supastack | Get disk utilization | `GET .../disk/util` (stub) |
| `/platform/projects/{ref}/infra-monitoring` | GET | ⚠️ | mock | Get infra monitoring data | — |
| `/platform/projects/{ref}/load-balancers` | GET | ⚠️ | mock | List load balancers | — |
| `/platform/projects/{ref}/members` | GET | ✅ | supastack | List project members (real — queries org membership scoped to project's org) | `GET /platform/projects/:ref/members` (real — org member join with role_ids) |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | DELETE | ⚠️ | supastack | Deletes advisor notification exceptions | `DELETE .../notifications/advisor/exceptions` (stub 204) |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | GET | ⚠️ | mock | Get lint exception rules | — |
| `/platform/projects/{ref}/notifications/advisor/exceptions` | POST | ⚠️ | supastack | Create advisor notification exceptions | `POST .../notifications/advisor/exceptions` (stub 201) |
| `/platform/projects/{ref}/notifications/advisor/exceptions/{id}` | PATCH | ⚠️ | supastack | Updates advisor notification exceptions | `PATCH .../notifications/advisor/exceptions/:id` (stub 200) |
| `/platform/projects/{ref}/activity` | GET | ✅ | supastack | Project activity log (ascending) — real audit_log rows filtered by ref, raw array (no pagination wrapper) | `GET /platform/projects/:ref/activity` (real — asc order, org-membership check, 404 on unknown ref; feature 109) |
| `/platform/projects/{ref}/audit` | GET | ✅ | supastack | Project audit log (paginated) — real audit_log rows filtered by ref with actor email join; `{result:[...], count}` | `GET /platform/projects/:ref/audit` (real — desc order, ?rows=50&page=1, max 200/page, 404 on unknown ref; feature 109) |
| `/platform/projects/{ref}/functions/secrets` | DELETE | ✅ | supastack | Delete edge function secrets — delegates to `DELETE /v1/projects/:ref/secrets` (vault-backed) | `DELETE /platform/projects/:ref/functions/secrets` (real — Tier 3b delegation; feature 111) |
| `/platform/projects/{ref}/functions/secrets` | GET | ✅ | supastack | List edge function secrets — delegates to `/v1/projects/:ref/secrets` (vault-backed) | `GET /platform/projects/:ref/functions/secrets` (real — Tier 3b delegation; feature 109) |
| `/platform/projects/{ref}/functions/secrets` | POST | ✅ | supastack | Upsert edge function secrets — delegates to `/v1/projects/:ref/secrets` (vault-backed), returns 201 | `POST /platform/projects/:ref/functions/secrets` (real — Tier 3b delegation; feature 109) |
| `/platform/projects/{ref}/postgres-config` | GET | ✅ | supastack | Get Postgres GUC tuning values (real 25-field GUC config) — delegates to `GET /v1/projects/:ref/config/database/postgres` | `GET /platform/projects/:ref/postgres-config` (real — Tier 3b delegation; feature 111) |
| `/platform/projects/{ref}/postgres-config` | PATCH | ✅ | supastack | Update Postgres GUC tuning values — delegates to `PATCH /v1/projects/:ref/config/database/postgres` | `PATCH /platform/projects/:ref/postgres-config` (real — Tier 3b delegation; feature 111) |
| `/platform/projects/{ref}/pause/status` | GET | ✅ | supastack | Get pause status — real DB: `{initiated_at: updatedAt\|null, status: 'not_pausing'}` (initiated_at non-null iff status='paused') | `GET /platform/projects/:ref/pause/status` (real — org-membership join, 404 on unknown ref; feature 109) |
| `/platform/projects/{ref}/readonly` | GET | ✅ | supastack | Get readonly mode — real DB: `{enabled: true}` iff instance status='paused' | `GET /platform/projects/:ref/readonly` (real — org-membership join, 404 on unknown ref; feature 109) |
| `/platform/projects/{ref}/readonly` | DELETE | ✅ | supastack | Disable readonly (resume project) — delegates to `POST /v1/projects/:ref/restore`, forwards auth header, returns upstream response | `DELETE /platform/projects/:ref/readonly` (real — Tier 3b delegation to restore endpoint; feature 109) |
| `/platform/projects/{ref}/ssl-enforcement` | GET | ✅ | supastack | Get SSL enforcement config — delegates to `/v1/projects/:ref/ssl-enforcement` (reads pg_hba.conf) | `GET /platform/projects/:ref/ssl-enforcement` (real — Tier 3b delegation; feature 109) |
| `/platform/projects/{ref}/ssl-enforcement` | PUT | ✅ | supastack | Update SSL enforcement config — delegates to `/v1/projects/:ref/ssl-enforcement`, forwards body | `PUT /platform/projects/:ref/ssl-enforcement` (real — Tier 3b delegation; feature 109) |
| `/platform/projects/{ref}/privatelink/associations` | GET | ⚠️ | supastack | List PrivateLink associations (empty) | `GET .../privatelink/associations` (stub) |
| `/platform/projects/{ref}/privatelink/associations/aws-account` | POST | ⚠️ | supastack | Create AWS PrivateLink | `POST .../privatelink/associations/aws-account` (stub) |
| `/platform/projects/{ref}/privatelink/associations/aws-account/{aws_account_id}` | DELETE | ⚠️ | supastack | Project Private Link — remove aws account from private link | `DELETE .../privatelink/associations/aws-account/:aws_account_id` (stub 204) |
| `/platform/projects/{ref}/resize` | POST | ⚠️ | supastack | Resize compute | `POST .../projects/:ref/resize` (stub) |
| `/platform/projects/{ref}/restart-services` | POST | ✅ | supastack | Restart specific services (real — delegates to full instance restart; no per-service granularity on self-hosted) | `POST /platform/projects/:ref/restart-services` → `POST /api/v1/instances/:ref/restart` |
| `/platform/projects/{ref}/restore/versions` | GET | ⚠️ | mock | List restore versions | — |
| `/platform/projects/{ref}/run-lints` | GET | ✅ | supastack | Run all 5 advisory lint checks via withPerInstancePg — `no_rls`, `duplicate_index`, `unused_index`, `bloat`, `sequence_wraparound`; 503 if project not running | `GET /platform/projects/:ref/run-lints` (real — live pg_stat queries; feature 109) |
| `/platform/projects/{ref}/run-lints/leaked-service-key` | GET | ✅ | supastack | Run project lint by name (falls through to run-lints/:name) | `GET .../run-lints/:name` (real — returns [] for unknown names; feature 109) |
| `/platform/projects/{ref}/run-lints/no-backup-admin` | GET | ✅ | supastack | Run project lint by name | `GET .../run-lints/:name` (real; feature 109) |
| `/platform/projects/{ref}/run-lints/{name}` | GET | ✅ | supastack | Run named lint check (one of 5 advisory checks); [] for unknown names; 503 if not running | `GET .../run-lints/:name` (real; feature 109) |
| `/platform/projects/{ref}/service-versions` | GET | ✅ | supastack | Get version info for each service (returns empty object — no per-service version surface on self-hosted) | `GET /platform/projects/:ref/service-versions` → `{}` |
| `/platform/projects/{ref}/settings/sensitivity` | PATCH | ⚠️ | supastack | Set data sensitivity level | `PATCH .../settings/sensitivity` (stub) |
| `/platform/projects/{ref}/transfer` | POST | ⚠️ | supastack | Transfer project to another org | `POST .../projects/:ref/transfer` (stub) |
| `/platform/projects/{ref}/transfer/preview` | POST | ⚠️ | supastack | Previews transferring a project to a different organizations, shows eligibility and impact. | `POST .../transfer/preview` (stub 200) |

---

## Database

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/database/{ref}/backups` | GET | ✅ | supastack | List available backups | `GET /platform/database/:ref/backups` (real — Cloud shape: `isPhysicalBackup`, numeric `seq` `id`, `physicalBackupData`; feature 086 US6) |
| `/platform/database/{ref}/backups/pitr` | POST | ✅ | supastack | Point-in-time restore | `POST .../backups/restore-pitr` |
| `/platform/database/{ref}/backups/restore` | POST | ✅ | supastack | Restore from logical backup (async worker) | `POST .../backups/restore` |
| `/platform/database/{ref}/backups/restore-physical` | POST | ✅ | supastack | Restore physical backup | `POST .../backups/restore-physical` (real — resolves `seq`→uuid ref-scoped, `initiateRestore` → async `QUEUES.restore` worker; feature 086 US6) |
| `/platform/database/{ref}/backups/download` | POST | ⚠️ | supastack | Download a backup | `POST .../backups/download` (stub) |
| `/platform/database/{ref}/backups/downloadable-backups` | GET | ✅ | supastack | List downloadable backups — real backups table query (status=completed), Cloud shape: `{id, inserted_at, completed_at, size_bytes, isPhysicalBackup:true, status:'COMPLETED'}` | `GET /platform/database/:ref/backups/downloadable-backups` (real — desc by startedAt; feature 109) |
| `/platform/database/{ref}/backups/enable-physical-backups` | POST | ⚠️ | mock | Enable physical backups | — |
| `/platform/database/{ref}/clone` | GET | ⚠️ | supastack | List valid backups to clone from | `GET .../database/:ref/clone` (stub empty list) |
| `/platform/database/{ref}/clone` | POST | ⚠️ | supastack | Clone database to new project | `POST .../database/:ref/clone` (stub) |
| `/platform/database/{ref}/clone/status` | GET | ⚠️ | supastack | Retrieve the current status of an existing cloning process | `GET .../database/:ref/clone/status` (stub) |
| `/platform/database/{ref}/hook-enable` | POST | ✅ | supastack | Enable database webhooks (real — creates `pg_net` extension + grants to postgres/authenticated/service_role) | `POST /platform/database/:ref/hook-enable` (real — `CREATE EXTENSION IF NOT EXISTS pg_net`) |

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
| `/platform/auth/{ref}/templates/{template}` | GET | ✅ | supastack | Gets Auth template | `GET /platform/auth/:ref/templates/:template` (real — reads from auth config) |

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
| `/platform/replication/{ref}/destinations-pipelines/{destination_id}/{pipeline_id}` | POST | ⚠️ | supastack | Replication Destinations Pipelines — update destination pipeline | `POST .../destinations-pipelines/:destination_id/:pipeline_id` (stub 200) |
| `/platform/replication/{ref}/destinations/validate` | POST | ⚠️ | supastack | Validate destination config | stub |
| `/platform/replication/{ref}/destinations/{destination_id}` | DELETE | ⚠️ | supastack | Delete destination | stub |
| `/platform/replication/{ref}/destinations/{destination_id}` | GET | ⚠️ | supastack | Replication Destinations — get destination | `GET .../destinations/:destination_id` (stub 200) |
| `/platform/replication/{ref}/destinations/{destination_id}` | POST | ⚠️ | supastack | Replication Destinations — update destination | `POST .../destinations/:destination_id` (stub 200) |
| `/platform/replication/{ref}/pipelines` | GET | ⚠️ | supastack | List replication pipelines (empty) | stub |
| `/platform/replication/{ref}/pipelines` | POST | ⚠️ | supastack | Create pipeline | stub |
| `/platform/replication/{ref}/pipelines/validate` | POST | ⚠️ | supastack | Validate pipeline config | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | DELETE | ⚠️ | supastack | Delete pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | GET | ⚠️ | supastack | Replication Pipelines — get pipeline | `GET .../pipelines/:pipeline_id` (stub 200) |
| `/platform/replication/{ref}/pipelines/{pipeline_id}` | POST | ⚠️ | supastack | Replication Pipelines — update pipeline | `POST .../pipelines/:pipeline_id` (stub 200) |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/replication-status` | GET | ⚠️ | supastack | Get replication lag / status | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/rollback-tables` | POST | ⚠️ | supastack | Rollback specific tables | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/start` | POST | ⚠️ | supastack | Start pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/status` | GET | ⚠️ | supastack | Get pipeline status | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/stop` | POST | ⚠️ | supastack | Stop pipeline | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/version` | GET | ⚠️ | supastack | Get pipeline version | stub |
| `/platform/replication/{ref}/pipelines/{pipeline_id}/version` | POST | ⚠️ | supastack | Replication Pipelines — update pipeline version | `POST .../pipelines/:pipeline_id/version` (stub 200) |
| `/platform/replication/{ref}/sources` | GET | ⚠️ | supastack | List replication sources (empty) | stub |
| `/platform/replication/{ref}/sources` | POST | ⚠️ | supastack | Replication Sources — create source | `POST .../sources` (stub 201) |
| `/platform/replication/{ref}/sources/{source_id}/publications` | GET | ⚠️ | supastack | List source publications | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications` | POST | ⚠️ | supastack | Create publication | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications/{publication_name}` | DELETE | ⚠️ | supastack | Delete publication | stub |
| `/platform/replication/{ref}/sources/{source_id}/publications/{publication_name}` | POST | ⚠️ | supastack | Replication Sources — update publication | `POST .../sources/:source_id/publications/:publication_name` (stub 200) |
| `/platform/replication/{ref}/sources/{source_id}/tables` | GET | ⚠️ | supastack | List source tables | stub |
| `/platform/replication/{ref}/tenants` | DELETE | ⚠️ | supastack | Delete tenant | stub |
| `/platform/replication/{ref}/tenants-sources` | POST | ⚠️ | supastack | Create tenant source | stub |

---

## Integrations

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/integrations` | GET | ⚠️ | supastack | List global integrations (empty) | `GET /api/v1/platform/integrations` (stub) |
| `/platform/integrations/github/authorization` | DELETE | ⚠️ | supastack | Git Hub Authorizations — remove git hub authorization | `DELETE .../github/authorization` (stub 200) |
| `/platform/integrations/github/authorization` | GET | ⚠️ | supastack | Get GitHub app auth status | `GET .../github/authorization` (stub) |
| `/platform/integrations/github/authorization` | POST | ⚠️ | supastack | Git Hub Authorizations — create git hub authorization | `POST .../github/authorization` (stub 400 — not supported self-hosted) |
| `/platform/integrations/github/connections` | GET | ⚠️ | supastack | List GitHub connections (empty) | `GET .../github/connections` (stub) |
| `/platform/integrations/github/connections` | POST | ⚠️ | supastack | Connects a GitHub project to a supabase project | `POST .../github/connections` (stub 400 — not supported self-hosted) |
| `/platform/integrations/github/connections/{connection_id}` | DELETE | ⚠️ | supastack | Deletes github project connection | `DELETE .../github/connections/:connection_id` (stub 400 — not supported self-hosted) |
| `/platform/integrations/github/connections/{connection_id}` | PATCH | ⚠️ | supastack | Updates a GitHub connection for a supabase project | `PATCH .../github/connections/:connection_id` (stub 400 — not supported self-hosted) |
| `/platform/integrations/github/repositories` | GET | ⚠️ | supastack | List GitHub repos (empty) | `GET .../github/repositories` (stub) |
| `/platform/integrations/github/repositories/{repository_id}/branches` | GET | ⚠️ | supastack | List GitHub repository branches | `GET .../github/repositories/:repository_id/branches` (stub 200) |
| `/platform/integrations/github/repositories/{repository_id}/branches/{branch_name}` | GET | ⚠️ | supastack | Git Hub Repositories — get repository | `GET .../github/repositories/:repository_id/branches/:branch_name` (stub 404) |
| `/platform/integrations/partners/{ref}/{listing_slug}` | POST | ⚠️ | supastack | Creates a partner integration and returns the redirect URL | `POST .../partners/:ref/:listing_slug` (stub 400 — not supported self-hosted) |
| `/platform/integrations/private-link/{slug}` | GET | ⚠️ | supastack | Get organization's PrivateLink configuration. | `GET .../private-link/:slug` (stub 200) |
| `/platform/integrations/private-link/{slug}` | PUT | ⚠️ | supastack | Update organization's PrivateLink configuration. | `PUT .../private-link/:slug` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel` | POST | ⚠️ | supastack | Vercel Integration — create vercel integration | `POST .../vercel` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel/connections` | POST | ⚠️ | supastack | Connects a Vercel project to a supabase project | `POST .../vercel/connections` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel/connections/project/{ref}` | GET | ⚠️ | supastack | Gets all Vercel integrations (regular and marketplace) with their connections for a given project | `GET .../vercel/connections/project/:ref` (stub 200) |
| `/platform/integrations/vercel/connections/{connection_id}` | DELETE | ⚠️ | supastack | Deletes vercel project connection | `DELETE .../vercel/connections/:connection_id` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel/connections/{connection_id}` | PATCH | ⚠️ | supastack | Updates a Vercel connection for a supabase project | `PATCH .../vercel/connections/:connection_id` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel/connections/{connection_id}/sync-envs` | POST | ⚠️ | supastack | Syncs supabase project envs with given connection id | `POST .../vercel/connections/:connection_id/sync-envs` (stub 400 — not supported self-hosted) |
| `/platform/integrations/vercel/projects/{organization_integration_id}` | GET | ⚠️ | supastack | Gets vercel projects with the given organization integration id | `GET .../vercel/projects/:organization_integration_id` (stub 200) |
| `/platform/integrations/{slug}` | GET | ⚠️ | supastack | List org integrations (empty) | `GET .../integrations/:slug` (stub) |

---

## Notifications

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/notifications` | GET | ✅ | supastack | List platform notifications (always empty — no notification store on self-hosted) | `GET /platform/notifications` → `[]` |
| `/platform/notifications` | PATCH | ✅ | supastack | Mark notifications as read (no-op — no notification store) | `PATCH /platform/notifications` → 204 |
| `/platform/notifications/archive-all` | PATCH | ✅ | supastack | Archive all notifications (no-op — no notification store) | `PATCH /platform/notifications/archive-all` → 204 |
| `/platform/notifications/summary` | GET | ✅ | supastack | Get notification counts (always zero — no notification store) | `GET /platform/notifications/summary` → `{ unread: 0 }` |

---

## Telemetry

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/telemetry/event` | POST | ⚠️ | supastack | Sends analytics server event | `POST .../telemetry/event` (stub 200) |
| `/platform/telemetry/feature-flags` | GET | ⚠️ | supastack | Get feature flag values | `GET /api/v1/platform/telemetry/feature-flags` (stub) |
| `/platform/telemetry/feature-flags/track` | POST | ⚠️ | supastack | Track feature flag called | `POST .../telemetry/feature-flags/track` (stub 200) |
| `/platform/telemetry/groups/identify` | POST | ⚠️ | supastack | Send analytics group identify event | `POST .../telemetry/groups/identify` (stub 200) |
| `/platform/telemetry/groups/reset` | POST | ⚠️ | supastack | Send analytics group reset event | `POST .../telemetry/groups/reset` (stub 200) |
| `/platform/telemetry/identify` | POST | ⚠️ | supastack | Send analytics identify event | `POST .../telemetry/identify` (stub 200) |
| `/platform/telemetry/reset` | POST | ⚠️ | supastack | Reset analytics | `POST .../telemetry/reset` (stub 200) |
| `/platform/telemetry/stream` | GET | ⚠️ | supastack | Stream telemetry events (local dev only) | `GET .../telemetry/stream` (stub empty) |

---

## Feedback

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/feedback/conversations/{conversation_id}/custom-fields` | PATCH | ⚠️ | supastack | Update feedback conversation fields | `PATCH .../conversations/:id/custom-fields` (stub) |
| `/platform/feedback/docs` | POST | ⚠️ | supastack | Send feedback on docs | `POST .../feedback/docs` (stub 200) |
| `/platform/feedback/downgrade` | POST | ⚠️ | supastack | Send downgrade feedback (no-op) | `POST .../feedback/downgrade` (stub) |
| `/platform/feedback/send` | POST | ⚠️ | supastack | Send general feedback (no-op) | `POST /api/v1/platform/feedback/send` (stub) |
| `/platform/feedback/upgrade` | POST | ⚠️ | supastack | Send upgrade feedback (no-op) | `POST .../feedback/upgrade` (stub) |

---

## Stripe

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/stripe/invoices/overdue` | GET | ⚠️ | mock | List overdue invoices | — |
| `/platform/stripe/projects/provisioning/account_requests/{id}` | GET | ⚠️ | supastack | Get account request details | `GET .../account_requests/:id` (stub 404 — correct self-hosted) |
| `/platform/stripe/projects/provisioning/account_requests/{id}/confirm` | POST | ⚠️ | supastack | Confirm account request (from Studio) | `POST .../account_requests/:id/confirm` (stub 400 — not supported self-hosted) |
| `/platform/stripe/setup-intent` | POST | ⚠️ | mock | Global Stripe setup intent | — |

---

## Plans

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/plans/features` | GET | ⚠️ | supastack | Plan Features — get plan features | `GET /platform/plans/features` (stub 200) |

---

## Status

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/status` | GET | ⚠️ | supastack | Get infrastructure status | `GET .../status` (stub — returns all-green) |

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
| `/platform/update-email` | POST | ✅ | supastack | Update account email _(not in platform.d.ts)_ — delegates to GoTrue admin user update + syncs `users` table | `POST /platform/update-email` (real — `updateGotrueUser` + DB sync) |
| `/platform/update-email` | PUT | ✅ | supastack | Updates a user email address (alias for POST — same handler) | `PUT /platform/update-email` (real — same as POST) |

---

## Projects — Resource Warnings

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/projects-resource-warnings` | GET | ⚠️ | supastack | Get resource warning alerts (empty) | `GET /api/v1/platform/projects-resource-warnings` (stub) |

---

## Cloud Marketplace

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/cloud-marketplace/buyers/{buyer_id}/contract-linking-eligibility` | GET | ⚠️ | supastack | Clazar — check contract linking eligibility | `GET .../buyers/:buyer_id/contract-linking-eligibility` (stub — not eligible) |
| `/platform/cloud-marketplace/buyers/{buyer_id}/onboarding-info` | GET | ⚠️ | supastack | Get info needed for AWS Marketplace onboarding | `GET .../buyers/:buyer_id/onboarding-info` (stub 404) |

---

## Workflow Runs

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/workflow-runs` | GET | ⚠️ | supastack | Get a list of workflow runs | `GET .../workflow-runs` (stub empty list) |
| `/platform/workflow-runs/{workflow_run_id}/logs` | GET | ⚠️ | supastack | Get the logs of a workflow run | `GET .../workflow-runs/:id/logs` (stub empty logs) |

---

## Vercel

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/vercel/redirect/{installation_id}` | GET | ⚠️ | supastack | Gets the Vercel redirect url | `GET .../vercel/redirect/:installation_id` (stub 400 — not supported self-hosted) |

---

## OAuth

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/oauth/apps/register` | POST | ⚠️ | supastack | Dynamically register an OAuth client (RFC-7591) | `POST .../oauth/apps/register` (stub 501 — not supported self-hosted) |
| `/platform/oauth/authorizations/{id}` | GET | ⚠️ | supastack | Get global OAuth authorization | `GET /platform/oauth/authorizations/:id` (stub) |

---

## CLI

| SUPABASE API | METHOD | COVERED | COVERED BY | WHAT IT DOES | SUPASTACK ENDPOINT |
|---|---|---|---|---|---|
| `/platform/cli/login/{session_id}` | GET | ✅ | supastack | Retrieve CLI login session | `GET /platform/cli/login/:session_id` |
| `/platform/cli/login` | POST | ⚠️ | supastack | Create CLI login session | `POST .../cli/login` (stub 501 — use supabase login directly) |

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
| `/v1/projects/:ref/api-keys/:id` | DELETE | ✅ | supastack | Delete custom API key — returns 404 not_found (self-hosted has no custom key store; correct REST semantics) | `DELETE /v1/projects/:ref/api-keys/:id` (real 404 — feature 111) |
| `/v1/projects/:ref/api-keys/:id` | PATCH | ✅ | supastack | Update key name/description — returns 404 not_found (self-hosted has no custom key store; correct REST semantics) | `PATCH /v1/projects/:ref/api-keys/:id` (real 404 — feature 111) |
| `/v1/projects/:ref/branches` | GET | ⚠️ | mock | List database branches | — |
| `/v1/projects/:ref/config/auth/signing-keys` | GET | ⚠️ | mock | List JWT signing keys | — |
| `/v1/projects/:ref/config/auth/third-party-auth` | GET | ⚠️ | mock | List third-party auth providers | — |
| `/v1/projects/:ref/custom-hostname` | GET | ⚠️ | mock | Get custom domain config | — |
| `/v1/projects/:ref/database/query` | POST | ✅ | supastack | Run ad-hoc SQL (CLI compat) | `POST /projects/:ref/database/query` |
| `/v1/projects/:ref/functions` | GET | ✅ | supastack | List edge functions | `GET /projects/:ref/functions` |
| `/v1/projects/:ref/functions` | POST | ⚠️ | supastack | Deploy edge function | `POST /projects/:ref/functions/deploy` |
| `/v1/projects/:ref/functions/:slug` | DELETE | ✅ | supastack | Delete function | `DELETE /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | GET | ✅ | supastack | Get function details | `GET /projects/:ref/functions/:slug` |
| `/v1/projects/:ref/functions/:slug` | PATCH | ✅ | supastack | Update function (name, verify_jwt) | `PATCH /projects/:ref/functions/:slug` (real — delegates to per-instance functions service) |
| `/v1/projects/:ref/functions/:slug/body` | GET | ✅ | supastack | Download function source | `GET /projects/:ref/functions/:slug/body` |
| `/v1/projects/:ref/functions/deployed-size` | GET | ⚠️ | mock | Get total deployed size | — |
| `/v1/projects/:ref/health` | GET | ✅ | supastack | Get service health statuses | `GET /instances/:ref/health` |
| `/v1/projects/:ref/network-bans` | DELETE | ✅ | supastack | Remove IP bans — platform DELETE delegates here, forwards verbatim | `DELETE /v1/projects/:ref/network-bans` (real — Tier 3b delegation target; feature 109) |
| `/v1/projects/:ref/network-bans` | GET | ✅ | supastack | List network bans — platform GET delegates here | `GET /v1/projects/:ref/network-bans` (real — Tier 3b delegation target; feature 109) |
| `/v1/projects/:ref/network-bans/retrieve` | POST | ⚠️ | mock | Get banned IP addresses | — |
| `/v1/projects/:ref/network-restrictions` | GET | ✅ | supastack | Get network firewall rules — platform GET delegates here | `GET /v1/projects/:ref/network-restrictions` (real — Tier 3b delegation target; feature 109) |
| `/v1/projects/:ref/network-restrictions/apply` | POST | ✅ | supastack | Apply firewall rules — platform POST delegates here | `POST /v1/projects/:ref/network-restrictions/apply` (real — Tier 3b delegation target; feature 109) |
| `/v1/projects/:ref/read-replicas` | GET | ⚠️ | mock | List read replicas (v1) | — |
| `/v1/projects/:ref/secrets` | DELETE | ✅ | supastack | Delete secrets | `DELETE /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | GET | ✅ | supastack | List secrets (SHA256 masked) | `GET /projects/:ref/secrets` |
| `/v1/projects/:ref/secrets` | POST | ✅ | supastack | Set / upsert secrets | `POST /projects/:ref/secrets` |
| `/v1/projects/:ref/upgrade/eligibility` | GET | ⚠️ | mock | Check upgrade eligibility | — |
| `/v1/projects/:ref/upgrade/status` | GET | ✅ | supastack | Get upgrade status — real DB: `{status: 'upgrading'\|'not_upgrading'}` (upgrading iff instance status='restoring') | `GET /platform/projects/:ref/upgrade/status` (real — org-membership join, 404 on unknown ref; feature 109) |
| `/verify` | POST | ✅ | gotrue | Verify OTP / magic link token | `→ GoTrue /auth/v1/verify` |
