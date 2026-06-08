# Supastack — Stub Endpoints

All `/platform/*` (and appendix non-platform) endpoints currently returning stub/mock responses. These are the remaining implementation gaps — converting any row to a real handler removes it from this list.

**Total stubs: 243 of 392 `/platform/*` rows**

**Last updated**: 2026-06-08 — synced from API-FULL-COMPARISON.md after feature 112 (realtime + pgbouncer config promoted to real).

**Legend:**
- `supastack` = a handler exists in `apps/api` but returns empty/static/config-disabled response
- `mock` = no real route — dev-mock catch-all only (Studio would 404 in production without the mock server)
- _(not in platform.d.ts)_ = called by Studio but absent from the canonical OpenAPI contract

**Priority guide:**
- 🔴 **self-hosted-relevant** — features operators or users will hit in normal use
- 🟡 **cloud-only / billing** — Stripe, plans, marketplace (intentionally N/A self-hosted; stubs are correct)
- ⚪ **cosmetic / low-traffic** — audit drains, documents, DPA, telemetry, feedback

---

## Profile (3 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/profile` | POST | supastack | 200 empty | ⚪ |
| `/platform/profile/audit` | GET | supastack | stub | ⚪ |
| `/platform/profile/audit-login` | POST | supastack | stub | ⚪ |

---

## Organizations (71 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/organizations/:slug/oauth/apps/:id` | GET | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/organizations/:slug/oauth/authorizations/:id` | GET | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/organizations/cloud-marketplace` | POST | mock | — | 🟡 |
| `/platform/organizations/confirm-subscription` | POST | mock | — | 🟡 |
| `/platform/organizations/onboarding-survey` | POST | supastack | 200 | ⚪ |
| `/platform/organizations/preview-creation` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | GET | supastack | empty list | ⚪ |
| `/platform/organizations/{slug}/analytics/audit-log-drains` | POST | supastack | 201 | ⚪ |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | DELETE | supastack | 204 | ⚪ |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PATCH | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/analytics/audit-log-drains/{token}` | PUT | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/apps` | GET | supastack | empty list | ⚪ |
| `/platform/organizations/{slug}/apps` | POST | supastack | 201 | ⚪ |
| `/platform/organizations/{slug}/apps/installations` | GET | supastack | empty list | ⚪ |
| `/platform/organizations/{slug}/apps/installations` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | DELETE | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/apps/installations/{installation_id}` | PATCH | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}` | DELETE | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}` | GET | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}` | PATCH | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/apps/{app_id}/signing-keys/{key_id}` | DELETE | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/billing/credits/balance` | GET | supastack | zero balance | 🟡 |
| `/platform/organizations/{slug}/billing/credits/preview` | POST | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/billing/credits/redeem` | POST | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/billing/credits/top-up` | POST | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/billing/invoices` | GET | supastack | empty list | 🟡 |
| `/platform/organizations/{slug}/billing/invoices/upcoming` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}` | GET | supastack | 404 (correct self-hosted) | 🟡 |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/payment-link` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/invoices/{invoice_id}/receipt` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/plans` | GET | supastack | Free only | 🟡 |
| `/platform/organizations/{slug}/billing/subscription` | GET | supastack | always Free | 🟡 |
| `/platform/organizations/{slug}/billing/subscription` | PUT | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/subscription/confirm` | POST | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/subscription/preview` | POST | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/billing/upgrade-request` | POST | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/cloud-marketplace/link` | PUT | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/cloud-marketplace/redirect` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/customer` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/customer` | PUT | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/documents/dpa` | POST | supastack | 400 not supported | ⚪ |
| `/platform/organizations/{slug}/documents/dpa-signed` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/documents/iso27001-certificate` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/documents/soc2-type-2-report` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/documents/standard-security-questionnaire` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/oauth/apps` | GET | supastack | stub (real OAuth clients at `/v1/oauth/*`) | ⚪ |
| `/platform/organizations/{slug}/oauth/apps` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | GET | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets/{secret_id}` | DELETE | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{id}` | DELETE | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{id}` | PUT | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/oauth/apps/{id}/revoke` | POST | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | DELETE | supastack | 204 | ⚪ |
| `/platform/organizations/{slug}/oauth/authorizations/{id}` | POST | supastack | 200 | ⚪ |
| `/platform/organizations/{slug}/payments` | DELETE | supastack | 204 | 🟡 |
| `/platform/organizations/{slug}/payments` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/payments/default` | PUT | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/payments/setup-intent` | POST | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/sso` | DELETE | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/sso` | GET | mock | — | 🟡 |
| `/platform/organizations/{slug}/sso` | POST | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/sso` | PUT | supastack | 400 not supported | 🟡 |
| `/platform/organizations/{slug}/tax-ids` | DELETE | supastack | 204 | 🟡 |
| `/platform/organizations/{slug}/tax-ids` | GET | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/tax-ids` | PUT | supastack | 200 | 🟡 |
| `/platform/organizations/{slug}/usage` | GET | supastack | stub | 🔴 |
| `/platform/organizations/{slug}/usage/daily` | GET | supastack | stub | 🔴 |

---

## Projects (58 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/:ref/api` | GET | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/projects/:ref/api-keys/temporary` | GET | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/projects/:ref/content` | POST | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/projects/:ref/custom-hostname` | GET | supastack | stub _(not in platform.d.ts)_ | ⚪ |
| `/platform/projects/:ref/subdomain` | GET | supastack | stub _(not in platform.d.ts)_ | 🔴 |
| `/platform/projects/{ref}/advisor-rules-exceptions` | GET | supastack | empty list | ⚪ |
| `/platform/projects/{ref}/auth/config` | GET | supastack | stub _(not in platform.d.ts)_ | 🔴 |
| `/platform/projects/{ref}/auth/config` | PATCH | supastack | stub _(not in platform.d.ts)_ | 🔴 |
| `/platform/projects/{ref}/billing/addons` | POST | supastack | 400 not supported | 🟡 |
| `/platform/projects/{ref}/billing/addons/{addon_variant}` | DELETE | supastack | 400 not supported | 🟡 |
| `/platform/projects/{ref}/config/pgbouncer/status` | GET | supastack | partial (pooler status) | 🔴 |
| `/platform/projects/{ref}/config/storage` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/config/storage` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/content` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/content` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/content` | PATCH | supastack | stub | ⚪ |
| `/platform/projects/{ref}/content` | PUT | supastack | stub | ⚪ |
| `/platform/projects/{ref}/content/move` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/custom-hostname` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/custom-hostname` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/custom-hostname/activate` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/custom-hostname/reverify` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/database/extensions` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/extensions` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/hooks` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/hooks` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/hooks` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/hooks` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/publications` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/publications` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/publications` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/publications` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/roles` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/roles` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/roles` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/schemas` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/schemas` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/edge-functions/limits` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/edge-functions/secrets` | DELETE | supastack | stub _(not in platform.d.ts)_ | 🔴 |
| `/platform/projects/{ref}/functions` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/functions` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/github` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/github` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/github` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/infra-monitoring` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/network-bans/bulk` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/private-endpoint-commands` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/query-performance` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/resources` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/storage-limits` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/subdomain` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/subdomain` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/subdomain/check-availability` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/transfer` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/vanity-subdomain` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/vanity-subdomain` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/vanity-subdomain` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/vanity-subdomain/check-availability` | POST | supastack | stub | ⚪ |

---

## Database (5 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/{ref}/api/graphql` | POST | supastack | 200 | 🔴 |
| `/platform/projects/{ref}/database/pooler` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/pooler` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/pooler` | PUT | supastack | stub | 🔴 |
| `/platform/projects/{ref}/database/pooler/config` | GET | supastack | stub | 🔴 |

---

## Storage (11 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/{ref}/storage/buckets` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/storage/buckets` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/storage/config` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/storage/config` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/storage/config/image-transformations` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/image-transformations` | PATCH | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/s3-connection` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/s3-connection` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/s3-connection` | POST | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/s3-connection/credentials` | DELETE | supastack | stub | ⚪ |
| `/platform/projects/{ref}/storage/config/s3-connection/credentials` | POST | supastack | stub | ⚪ |

---

## Replication (33 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/{ref}/replication/destinations` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}/disable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}/enable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}/tables` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/destinations/{destination_id}/tables` | PUT | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/disable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/enable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/errors` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/metrics` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/tables` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/pipelines/{pipeline_id}/tables` | PUT | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}` | DELETE | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}` | PATCH | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}/disable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}/enable` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}/tables` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}/tables` | PUT | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/sources/{source_id}/test-connection` | POST | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/tables` | GET | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/tables` | PUT | supastack | stub | 🔴 |
| `/platform/projects/{ref}/replication/tables/{table_id}` | GET | supastack | stub | 🔴 |

---

## Integrations (22 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/integrations/github` | GET | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}` | DELETE | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}` | PATCH | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/branches` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/branches` | PUT | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/branches/{branchId}` | DELETE | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/branches/{branchId}` | PATCH | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/pull-requests` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/pull-requests/{prId}` | GET | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/pull-requests/{prId}/logs` | GET | supastack | stub | ⚪ |
| `/platform/integrations/github/connections/{connectionId}/repositories` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/github/installations` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/github/token` | GET | supastack | stub | ⚪ |
| `/platform/integrations/vercel` | GET | supastack | stub | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}` | DELETE | supastack | stub | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}` | PATCH | supastack | stub | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}/projects` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}/projects` | PATCH | supastack | stub | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}/projects` | POST | supastack | stub | ⚪ |
| `/platform/integrations/vercel/connections/{connectionId}/projects/{foreign_project_id}` | DELETE | supastack | stub | ⚪ |
| `/platform/integrations/vercel/installations` | GET | supastack | empty list | ⚪ |
| `/platform/integrations/vercel/token` | GET | supastack | stub | ⚪ |

---

## Telemetry (8 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/telemetry/event` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/identify` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/pageview` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/screen` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/survey` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/track` | POST | supastack | stub | ⚪ |
| `/platform/telemetry/track` | PUT | supastack | stub | ⚪ |
| `/platform/telemetry/unidentify` | POST | supastack | stub | ⚪ |

---

## Feedback (5 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/feedback/cancel` | POST | supastack | stub | ⚪ |
| `/platform/feedback/downgrade` | POST | supastack | stub | ⚪ |
| `/platform/feedback/send` | POST | supastack | stub | ⚪ |
| `/platform/feedback/support` | POST | supastack | stub | ⚪ |
| `/platform/feedback/unsubscribe` | POST | supastack | stub | ⚪ |

---

## Stripe (4 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/stripe/lead-gen` | POST | supastack | stub | 🟡 |
| `/platform/stripe/setup-intent` | POST | supastack | stub | 🟡 |
| `/platform/stripe/taxes` | GET | supastack | stub | 🟡 |
| `/platform/stripe/trial` | POST | supastack | stub | 🟡 |

---

## Plans (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/plans` | GET | supastack | Free only | 🟡 |

---

## Status (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/status` | GET | supastack | stub | ⚪ |

---

## Signup (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/signup` | POST | supastack | stub | ⚪ |

---

## Projects — Resource Warnings (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/{ref}/resource-warnings` | GET | supastack | stub | 🔴 |

---

## Cloud Marketplace (2 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/cloud-marketplace/callback` | GET | supastack | stub | 🟡 |
| `/platform/cloud-marketplace/redirect` | GET | supastack | stub | 🟡 |

---

## Workflow Runs (2 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/projects/{ref}/workflow-runs` | GET | supastack | stub | ⚪ |
| `/platform/projects/{ref}/workflow-runs/{id}` | GET | supastack | stub | ⚪ |

---

## Vercel (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/integrations/vercel/bare-token` | GET | supastack | stub | ⚪ |

---

## OAuth (2 stubs)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/organizations/{slug}/oauth/apps/{id}/authorizations` | GET | supastack | stub | ⚪ |
| `/platform/organizations/{slug}/oauth/authorizations` | GET | supastack | stub | ⚪ |

---

## CLI (1 stub)

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/platform/cli/login/status` | GET | supastack | stub | ⚪ |

---

## Appendix — Non-`/platform` surfaces (11 stubs)

Management API (`/v1/*`) and other routes that are stubs or not yet real:

| ENDPOINT | METHOD | COVERED BY | STUB BEHAVIOUR | PRIORITY |
|---|---|---|---|---|
| `/v1/projects/{ref}/config/auth` | GET | supastack | partial (stored config only, no live GoTrue sync) | 🔴 |
| `/v1/projects/{ref}/config/auth` | PATCH | supastack | partial (persists but some fields stored-only) | 🔴 |
| `/v1/projects/{ref}/database/webhooks` | GET | supastack | stub | 🔴 |
| `/v1/projects/{ref}/database/webhooks` | POST | supastack | stub | 🔴 |
| `/v1/projects/{ref}/database/webhooks/{id}` | DELETE | supastack | stub | 🔴 |
| `/v1/projects/{ref}/database/webhooks/{id}` | GET | supastack | stub | 🔴 |
| `/v1/projects/{ref}/database/webhooks/{id}` | PATCH | supastack | stub | 🔴 |
| `/v1/projects/{ref}/pg-meta/roles` | GET | supastack | stub | 🔴 |
| `/v1/projects/{ref}/secrets` | DELETE | supastack | stub | ⚪ |
| `/v1/projects/{ref}/vanity-subdomain/activate` | POST | supastack | stub | ⚪ |
| `/v1/projects/{ref}/vanity-subdomain/check-availability` | GET | supastack | stub | ⚪ |

---

## Summary by Priority

| Priority | Count | Description |
|---|---|---|
| 🔴 self-hosted-relevant | ~72 | Features operators/users hit in normal use |
| 🟡 cloud-only / billing | ~47 | Stripe, plans, marketplace — stubs are intentionally correct |
| ⚪ cosmetic / low-traffic | ~124 | Audit drains, documents, telemetry, integrations, OAuth apps |
