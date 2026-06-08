# API Endpoint Coverage: `api.d.ts` vs `platform.d.ts`

> Compares `/v1/*` Management API endpoints (`api.d.ts`) with `/platform/*` Studio endpoints (`platform.d.ts`).
> Matching accounts for structural path differences (e.g. `/v1/projects/{ref}/config/auth` ↔ `/platform/auth/{ref}/config`).

## Summary

| Category | Count |
|----------|-------|
| Matched — appear in both | 37 |
| api.d.ts only — no platform.d.ts equivalent | 125 |
| platform.d.ts only — no api.d.ts equivalent | 318 |
| **Total api.d.ts** | **162** |
| **Total platform.d.ts** | **355** |

---

## 1. Matched — Appear in Both

| api.d.ts (`/v1/*`) | platform.d.ts (`/platform/*`) |
|--------------------|-------------------------------|
| `DELETE /v1/projects/{ref}` | `DELETE /platform/projects/{ref}` |
| `DELETE /v1/projects/{ref}/billing/addons/{addon_variant}` | `DELETE /platform/projects/{ref}/billing/addons/{addon_variant}` |
| `GET /v1/organizations` | `GET /platform/organizations` |
| `GET /v1/organizations/{slug}` | `GET /platform/organizations/{slug}` |
| `GET /v1/organizations/{slug}/entitlements` | `GET /platform/organizations/{slug}/entitlements` |
| `GET /v1/organizations/{slug}/members` | `GET /platform/organizations/{slug}/members` |
| `GET /v1/organizations/{slug}/projects` | `GET /platform/organizations/{slug}/projects` |
| `GET /v1/profile` | `GET /platform/profile` |
| `GET /v1/projects` | `GET /platform/projects` |
| `GET /v1/projects/available-regions` | `GET /platform/projects/available-regions` |
| `GET /v1/projects/{ref}` | `GET /platform/projects/{ref}` |
| `GET /v1/projects/{ref}/analytics/endpoints/functions.combined-stats` | `GET /platform/projects/{ref}/analytics/endpoints/functions.combined-stats` |
| `GET /v1/projects/{ref}/analytics/endpoints/logs.all` | `GET /platform/projects/{ref}/analytics/endpoints/logs.all` |
| `GET /v1/projects/{ref}/analytics/endpoints/usage.api-counts` | `GET /platform/projects/{ref}/analytics/endpoints/usage.api-counts` |
| `GET /v1/projects/{ref}/analytics/endpoints/usage.api-requests-count` | `GET /platform/projects/{ref}/analytics/endpoints/usage.api-requests-count` |
| `GET /v1/projects/{ref}/billing/addons` | `GET /platform/projects/{ref}/billing/addons` |
| `GET /v1/projects/{ref}/config/auth` | `GET /platform/auth/{ref}/config` |
| `GET /v1/projects/{ref}/config/database/pgbouncer` | `GET /platform/projects/{ref}/config/pgbouncer` |
| `GET /v1/projects/{ref}/config/realtime` | `GET /platform/projects/{ref}/config/realtime` |
| `GET /v1/projects/{ref}/config/storage` | `GET /platform/projects/{ref}/config/storage` |
| `GET /v1/projects/{ref}/database/backups` | `GET /platform/database/{ref}/backups` |
| `GET /v1/projects/{ref}/postgrest` | `GET /platform/projects/{ref}/config/postgrest` |
| `GET /v1/projects/{ref}/storage/buckets` | `GET /platform/storage/{ref}/buckets` |
| `PATCH /v1/projects/{ref}` | `PATCH /platform/projects/{ref}` |
| `PATCH /v1/projects/{ref}/config/auth` | `PATCH /platform/auth/{ref}/config` |
| `PATCH /v1/projects/{ref}/config/database/pooler` | `PATCH /platform/projects/{ref}/config/pgbouncer` |
| `PATCH /v1/projects/{ref}/config/realtime` | `PATCH /platform/projects/{ref}/config/realtime` |
| `PATCH /v1/projects/{ref}/config/storage` | `PATCH /platform/projects/{ref}/config/storage` |
| `PATCH /v1/projects/{ref}/database/password` | `PATCH /platform/projects/{ref}/db-password` |
| `PATCH /v1/projects/{ref}/postgrest` | `PATCH /platform/projects/{ref}/config/postgrest` |
| `POST /v1/organizations` | `POST /platform/organizations` |
| `POST /v1/projects` | `POST /platform/projects` |
| `POST /v1/projects/{ref}/config/realtime/shutdown` | `POST /platform/projects/{ref}/config/realtime/shutdown` |
| `POST /v1/projects/{ref}/database/backups/restore` | `POST /platform/database/{ref}/backups/restore` |
| `POST /v1/projects/{ref}/database/backups/restore-pitr` | `POST /platform/database/{ref}/backups/pitr` |
| `POST /v1/projects/{ref}/pause` | `POST /platform/projects/{ref}/pause` |
| `POST /v1/projects/{ref}/restore` | `POST /platform/projects/{ref}/restore` |

---

## 2. api.d.ts Only — No `platform.d.ts` Equivalent

These Management API (`/v1/*`) endpoints exist only in `api.d.ts`.

- `DELETE /v1/branches/{branch_id_or_ref}`
- `DELETE /v1/projects/{ref}/api-keys/{id}`
- `DELETE /v1/projects/{ref}/branches`
- `DELETE /v1/projects/{ref}/claim-token`
- `DELETE /v1/projects/{ref}/cli/login-role`
- `DELETE /v1/projects/{ref}/config/auth/signing-keys/{id}`
- `DELETE /v1/projects/{ref}/config/auth/sso/providers/{provider_id}`
- `DELETE /v1/projects/{ref}/config/auth/third-party-auth/{tpa_id}`
- `DELETE /v1/projects/{ref}/custom-hostname`
- `DELETE /v1/projects/{ref}/database/jit/{user_id}`
- `DELETE /v1/projects/{ref}/database/migrations`
- `DELETE /v1/projects/{ref}/functions/{function_slug}`
- `DELETE /v1/projects/{ref}/network-bans`
- `DELETE /v1/projects/{ref}/secrets`
- `DELETE /v1/projects/{ref}/vanity-subdomain`
- `GET /v1/branches/{branch_id_or_ref}`
- `GET /v1/branches/{branch_id_or_ref}/diff`
- `GET /v1/oauth/authorize`
- `GET /v1/oauth/authorize/project-claim`
- `GET /v1/organizations/{slug}/project-claim/{token}`
- `GET /v1/projects/{ref}/actions`
- `GET /v1/projects/{ref}/actions/{run_id}`
- `GET /v1/projects/{ref}/actions/{run_id}/logs`
- `GET /v1/projects/{ref}/advisors/performance`
- `GET /v1/projects/{ref}/advisors/security`
- `GET /v1/projects/{ref}/api-keys`
- `GET /v1/projects/{ref}/api-keys/legacy`
- `GET /v1/projects/{ref}/api-keys/{id}`
- `GET /v1/projects/{ref}/branches`
- `GET /v1/projects/{ref}/branches/{name}`
- `GET /v1/projects/{ref}/claim-token`
- `GET /v1/projects/{ref}/config/auth/signing-keys`
- `GET /v1/projects/{ref}/config/auth/signing-keys/legacy`
- `GET /v1/projects/{ref}/config/auth/signing-keys/{id}`
- `GET /v1/projects/{ref}/config/auth/sso/providers`
- `GET /v1/projects/{ref}/config/auth/sso/providers/{provider_id}`
- `GET /v1/projects/{ref}/config/auth/third-party-auth`
- `GET /v1/projects/{ref}/config/auth/third-party-auth/{tpa_id}`
- `GET /v1/projects/{ref}/config/database/pooler`
- `GET /v1/projects/{ref}/config/database/postgres`
- `GET /v1/projects/{ref}/config/disk`
- `GET /v1/projects/{ref}/config/disk/autoscale`
- `GET /v1/projects/{ref}/config/disk/util`
- `GET /v1/projects/{ref}/custom-hostname`
- `GET /v1/projects/{ref}/database/backups/restore-point`
- `GET /v1/projects/{ref}/database/context`
- `GET /v1/projects/{ref}/database/jit`
- `GET /v1/projects/{ref}/database/jit/list`
- `GET /v1/projects/{ref}/database/migrations`
- `GET /v1/projects/{ref}/database/migrations/{version}`
- `GET /v1/projects/{ref}/database/openapi`
- `GET /v1/projects/{ref}/functions`
- `GET /v1/projects/{ref}/functions/{function_slug}`
- `GET /v1/projects/{ref}/functions/{function_slug}/body`
- `GET /v1/projects/{ref}/health`
- `GET /v1/projects/{ref}/jit-access`
- `GET /v1/projects/{ref}/network-restrictions`
- `GET /v1/projects/{ref}/pgsodium`
- `GET /v1/projects/{ref}/readonly`
- `GET /v1/projects/{ref}/restore`
- `GET /v1/projects/{ref}/secrets`
- `GET /v1/projects/{ref}/ssl-enforcement`
- `GET /v1/projects/{ref}/types/typescript`
- `GET /v1/projects/{ref}/upgrade/eligibility`
- `GET /v1/projects/{ref}/upgrade/status`
- `GET /v1/projects/{ref}/vanity-subdomain`
- `GET /v1/snippets`
- `GET /v1/snippets/{id}`
- `HEAD /v1/projects/{ref}/actions`
- `PATCH /v1/branches/{branch_id_or_ref}`
- `PATCH /v1/projects/{ref}/actions/{run_id}/status`
- `PATCH /v1/projects/{ref}/api-keys/{id}`
- `PATCH /v1/projects/{ref}/billing/addons`
- `PATCH /v1/projects/{ref}/config/auth/signing-keys/{id}`
- `PATCH /v1/projects/{ref}/database/migrations/{version}`
- `PATCH /v1/projects/{ref}/functions/{function_slug}`
- `PATCH /v1/projects/{ref}/network-restrictions`
- `POST /v1/branches/{branch_id_or_ref}/merge`
- `POST /v1/branches/{branch_id_or_ref}/push`
- `POST /v1/branches/{branch_id_or_ref}/reset`
- `POST /v1/branches/{branch_id_or_ref}/restore`
- `POST /v1/oauth/revoke`
- `POST /v1/oauth/token`
- `POST /v1/organizations/{slug}/project-claim/{token}`
- `POST /v1/projects/{ref}/api-keys`
- `POST /v1/projects/{ref}/branches`
- `POST /v1/projects/{ref}/claim-token`
- `POST /v1/projects/{ref}/cli/login-role`
- `POST /v1/projects/{ref}/config/auth/signing-keys`
- `POST /v1/projects/{ref}/config/auth/signing-keys/legacy`
- `POST /v1/projects/{ref}/config/auth/sso/providers`
- `POST /v1/projects/{ref}/config/auth/third-party-auth`
- `POST /v1/projects/{ref}/config/disk`
- `POST /v1/projects/{ref}/custom-hostname/activate`
- `POST /v1/projects/{ref}/custom-hostname/initialize`
- `POST /v1/projects/{ref}/custom-hostname/reverify`
- `POST /v1/projects/{ref}/database/backups/restore-point`
- `POST /v1/projects/{ref}/database/backups/undo`
- `POST /v1/projects/{ref}/database/jit`
- `POST /v1/projects/{ref}/database/migrations`
- `POST /v1/projects/{ref}/database/query`
- `POST /v1/projects/{ref}/database/query/read-only`
- `POST /v1/projects/{ref}/database/webhooks/enable`
- `POST /v1/projects/{ref}/functions`
- `POST /v1/projects/{ref}/functions/deploy`
- `POST /v1/projects/{ref}/network-bans/retrieve`
- `POST /v1/projects/{ref}/network-bans/retrieve/enriched`
- `POST /v1/projects/{ref}/network-restrictions/apply`
- `POST /v1/projects/{ref}/read-replicas/remove`
- `POST /v1/projects/{ref}/read-replicas/setup`
- `POST /v1/projects/{ref}/readonly/temporary-disable`
- `POST /v1/projects/{ref}/restore/cancel`
- `POST /v1/projects/{ref}/secrets`
- `POST /v1/projects/{ref}/upgrade`
- `POST /v1/projects/{ref}/vanity-subdomain/activate`
- `POST /v1/projects/{ref}/vanity-subdomain/check-availability`
- `PUT /v1/projects/{ref}/api-keys/legacy`
- `PUT /v1/projects/{ref}/config/auth/sso/providers/{provider_id}`
- `PUT /v1/projects/{ref}/config/database/postgres`
- `PUT /v1/projects/{ref}/database/jit`
- `PUT /v1/projects/{ref}/database/migrations`
- `PUT /v1/projects/{ref}/functions`
- `PUT /v1/projects/{ref}/jit-access`
- `PUT /v1/projects/{ref}/pgsodium`
- `PUT /v1/projects/{ref}/ssl-enforcement`

---

## 3. platform.d.ts Only — No `api.d.ts` Equivalent

These Studio Platform (`/platform/*`) endpoints exist only in `platform.d.ts`.

- `DELETE /platform/auth/{ref}/users/{id}`
- `DELETE /platform/auth/{ref}/users/{id}/factors`
- `DELETE /platform/integrations/github/authorization`
- `DELETE /platform/integrations/github/connections/{connection_id}`
- `DELETE /platform/integrations/vercel/connections/{connection_id}`
- `DELETE /platform/organizations/{slug}`
- `DELETE /platform/organizations/{slug}/analytics/audit-log-drains/{token}`
- `DELETE /platform/organizations/{slug}/apps/installations/{installation_id}`
- `DELETE /platform/organizations/{slug}/apps/{app_id}`
- `DELETE /platform/organizations/{slug}/apps/{app_id}/signing-keys/{key_id}`
- `DELETE /platform/organizations/{slug}/members/invitations/{id}`
- `DELETE /platform/organizations/{slug}/members/{gotrue_id}`
- `DELETE /platform/organizations/{slug}/members/{gotrue_id}/roles/{role_id}`
- `DELETE /platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets/{secret_id}`
- `DELETE /platform/organizations/{slug}/oauth/apps/{id}`
- `DELETE /platform/organizations/{slug}/oauth/authorizations/{id}`
- `DELETE /platform/organizations/{slug}/payments`
- `DELETE /platform/organizations/{slug}/sso`
- `DELETE /platform/organizations/{slug}/tax-ids`
- `DELETE /platform/profile/access-tokens/{id}`
- `DELETE /platform/profile/scoped-access-tokens/{id}`
- `DELETE /platform/projects/{ref}/analytics/log-drains/{token}`
- `DELETE /platform/projects/{ref}/content`
- `DELETE /platform/projects/{ref}/content/folders`
- `DELETE /platform/projects/{ref}/notifications/advisor/exceptions`
- `DELETE /platform/projects/{ref}/privatelink/associations/aws-account/{aws_account_id}`
- `DELETE /platform/replication/{ref}/destinations-pipelines/{destination_id}/{pipeline_id}`
- `DELETE /platform/replication/{ref}/destinations/{destination_id}`
- `DELETE /platform/replication/{ref}/pipelines/{pipeline_id}`
- `DELETE /platform/replication/{ref}/sources/{source_id}/publications/{publication_name}`
- `DELETE /platform/replication/{ref}/tenants`
- `DELETE /platform/storage/{ref}/analytics-buckets/{id}`
- `DELETE /platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}`
- `DELETE /platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables/{table}`
- `DELETE /platform/storage/{ref}/buckets/{id}`
- `DELETE /platform/storage/{ref}/buckets/{id}/objects`
- `DELETE /platform/storage/{ref}/credentials/{id}`
- `DELETE /platform/storage/{ref}/vector-buckets/{id}`
- `DELETE /platform/storage/{ref}/vector-buckets/{id}/indexes/{indexName}`
- `GET /platform/auth/{ref}/templates/{template}`
- `GET /platform/cli/login/{session_id}`
- `GET /platform/cloud-marketplace/buyers/{buyer_id}/contract-linking-eligibility`
- `GET /platform/cloud-marketplace/buyers/{buyer_id}/onboarding-info`
- `GET /platform/database/{ref}/backups/downloadable-backups`
- `GET /platform/database/{ref}/clone`
- `GET /platform/database/{ref}/clone/status`
- `GET /platform/integrations`
- `GET /platform/integrations/github/authorization`
- `GET /platform/integrations/github/connections`
- `GET /platform/integrations/github/repositories`
- `GET /platform/integrations/github/repositories/{repository_id}/branches`
- `GET /platform/integrations/github/repositories/{repository_id}/branches/{branch_name}`
- `GET /platform/integrations/private-link/{slug}`
- `GET /platform/integrations/vercel/connections/project/{ref}`
- `GET /platform/integrations/vercel/projects/{organization_integration_id}`
- `GET /platform/integrations/{slug}`
- `GET /platform/notifications`
- `GET /platform/notifications/summary`
- `GET /platform/oauth/authorizations/{id}`
- `GET /platform/organizations/{slug}/analytics/audit-log-drains`
- `GET /platform/organizations/{slug}/apps`
- `GET /platform/organizations/{slug}/apps/installations`
- `GET /platform/organizations/{slug}/apps/installations/{installation_id}`
- `GET /platform/organizations/{slug}/apps/{app_id}`
- `GET /platform/organizations/{slug}/apps/{app_id}/signing-keys`
- `GET /platform/organizations/{slug}/audit`
- `GET /platform/organizations/{slug}/billing/credits/balance`
- `GET /platform/organizations/{slug}/billing/invoices`
- `GET /platform/organizations/{slug}/billing/invoices/upcoming`
- `GET /platform/organizations/{slug}/billing/invoices/{invoice_id}`
- `GET /platform/organizations/{slug}/billing/invoices/{invoice_id}/payment-link`
- `GET /platform/organizations/{slug}/billing/invoices/{invoice_id}/receipt`
- `GET /platform/organizations/{slug}/billing/plans`
- `GET /platform/organizations/{slug}/billing/subscription`
- `GET /platform/organizations/{slug}/cloud-marketplace/redirect`
- `GET /platform/organizations/{slug}/customer`
- `GET /platform/organizations/{slug}/documents/dpa-signed`
- `GET /platform/organizations/{slug}/documents/iso27001-certificate`
- `GET /platform/organizations/{slug}/documents/soc2-type-2-report`
- `GET /platform/organizations/{slug}/documents/standard-security-questionnaire`
- `GET /platform/organizations/{slug}/members/invitations`
- `GET /platform/organizations/{slug}/members/invitations/{token}`
- `GET /platform/organizations/{slug}/members/mfa/enforcement`
- `GET /platform/organizations/{slug}/members/reached-free-project-limit`
- `GET /platform/organizations/{slug}/oauth/apps`
- `GET /platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets`
- `GET /platform/organizations/{slug}/payments`
- `GET /platform/organizations/{slug}/roles`
- `GET /platform/organizations/{slug}/sso`
- `GET /platform/organizations/{slug}/tax-ids`
- `GET /platform/organizations/{slug}/usage`
- `GET /platform/organizations/{slug}/usage/daily`
- `GET /platform/pg-meta/{ref}/column-privileges`
- `GET /platform/pg-meta/{ref}/extensions`
- `GET /platform/pg-meta/{ref}/foreign-tables`
- `GET /platform/pg-meta/{ref}/materialized-views`
- `GET /platform/pg-meta/{ref}/policies`
- `GET /platform/pg-meta/{ref}/publications`
- `GET /platform/pg-meta/{ref}/tables`
- `GET /platform/pg-meta/{ref}/triggers`
- `GET /platform/pg-meta/{ref}/types`
- `GET /platform/pg-meta/{ref}/views`
- `GET /platform/plans/features`
- `GET /platform/profile/access-tokens`
- `GET /platform/profile/access-tokens/{id}`
- `GET /platform/profile/audit`
- `GET /platform/profile/permissions`
- `GET /platform/profile/scoped-access-tokens`
- `GET /platform/profile/scoped-access-tokens/{id}`
- `GET /platform/projects-resource-warnings`
- `GET /platform/projects/{ref}/analytics/endpoints/auth.metrics`
- `GET /platform/projects/{ref}/analytics/endpoints/functions.req-stats`
- `GET /platform/projects/{ref}/analytics/endpoints/functions.resource-usage`
- `GET /platform/projects/{ref}/analytics/endpoints/logs.all.otel`
- `GET /platform/projects/{ref}/analytics/endpoints/project.metrics`
- `GET /platform/projects/{ref}/analytics/endpoints/service-health`
- `GET /platform/projects/{ref}/analytics/log-drains`
- `GET /platform/projects/{ref}/api/rest`
- `GET /platform/projects/{ref}/config/pgbouncer/status`
- `GET /platform/projects/{ref}/config/secrets/update-status`
- `GET /platform/projects/{ref}/config/supavisor`
- `GET /platform/projects/{ref}/content`
- `GET /platform/projects/{ref}/content/count`
- `GET /platform/projects/{ref}/content/folders`
- `GET /platform/projects/{ref}/content/folders/{id}`
- `GET /platform/projects/{ref}/content/item/{id}`
- `GET /platform/projects/{ref}/daily-stats`
- `GET /platform/projects/{ref}/databases`
- `GET /platform/projects/{ref}/databases-statuses`
- `GET /platform/projects/{ref}/disk`
- `GET /platform/projects/{ref}/disk/custom-config`
- `GET /platform/projects/{ref}/disk/util`
- `GET /platform/projects/{ref}/infra-monitoring`
- `GET /platform/projects/{ref}/load-balancers`
- `GET /platform/projects/{ref}/members`
- `GET /platform/projects/{ref}/notifications/advisor/exceptions`
- `GET /platform/projects/{ref}/pause/status`
- `GET /platform/projects/{ref}/privatelink/associations`
- `GET /platform/projects/{ref}/restore/versions`
- `GET /platform/projects/{ref}/run-lints`
- `GET /platform/projects/{ref}/run-lints/leaked-service-key`
- `GET /platform/projects/{ref}/run-lints/no-backup-admin`
- `GET /platform/projects/{ref}/run-lints/{name}`
- `GET /platform/projects/{ref}/service-versions`
- `GET /platform/projects/{ref}/settings`
- `GET /platform/projects/{ref}/status`
- `GET /platform/replication/{ref}/destinations`
- `GET /platform/replication/{ref}/destinations/{destination_id}`
- `GET /platform/replication/{ref}/pipelines`
- `GET /platform/replication/{ref}/pipelines/{pipeline_id}`
- `GET /platform/replication/{ref}/pipelines/{pipeline_id}/replication-status`
- `GET /platform/replication/{ref}/pipelines/{pipeline_id}/status`
- `GET /platform/replication/{ref}/pipelines/{pipeline_id}/version`
- `GET /platform/replication/{ref}/sources`
- `GET /platform/replication/{ref}/sources/{source_id}/publications`
- `GET /platform/replication/{ref}/sources/{source_id}/tables`
- `GET /platform/status`
- `GET /platform/storage/{ref}/analytics-buckets`
- `GET /platform/storage/{ref}/analytics-buckets/{id}/namespaces`
- `GET /platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables`
- `GET /platform/storage/{ref}/archive`
- `GET /platform/storage/{ref}/buckets/{id}`
- `GET /platform/storage/{ref}/credentials`
- `GET /platform/storage/{ref}/vector-buckets`
- `GET /platform/storage/{ref}/vector-buckets/{id}`
- `GET /platform/storage/{ref}/vector-buckets/{id}/indexes`
- `GET /platform/stripe/invoices/overdue`
- `GET /platform/stripe/projects/provisioning/account_requests/{id}`
- `GET /platform/telemetry/feature-flags`
- `GET /platform/telemetry/stream`
- `GET /platform/vercel/redirect/{installation_id}`
- `GET /platform/workflow-runs`
- `GET /platform/workflow-runs/{workflow_run_id}/logs`
- `HEAD /platform/organizations/{slug}/billing/invoices`
- `PATCH /platform/auth/{ref}/config/hooks`
- `PATCH /platform/auth/{ref}/users/{id}`
- `PATCH /platform/feedback/conversations/{conversation_id}/custom-fields`
- `PATCH /platform/integrations/github/connections/{connection_id}`
- `PATCH /platform/integrations/vercel/connections/{connection_id}`
- `PATCH /platform/notifications`
- `PATCH /platform/notifications/archive-all`
- `PATCH /platform/organizations/{slug}`
- `PATCH /platform/organizations/{slug}/analytics/audit-log-drains/{token}`
- `PATCH /platform/organizations/{slug}/apps/installations/{installation_id}`
- `PATCH /platform/organizations/{slug}/apps/{app_id}`
- `PATCH /platform/organizations/{slug}/members/mfa/enforcement`
- `PATCH /platform/organizations/{slug}/members/{gotrue_id}`
- `PATCH /platform/profile`
- `PATCH /platform/projects/{ref}/analytics/log-drains/{token}`
- `PATCH /platform/projects/{ref}/config/secrets`
- `PATCH /platform/projects/{ref}/content/folders/{id}`
- `PATCH /platform/projects/{ref}/notifications/advisor/exceptions/{id}`
- `PATCH /platform/projects/{ref}/settings/sensitivity`
- `PATCH /platform/storage/{ref}/buckets/{id}`
- `POST /platform/auth/{ref}/invite`
- `POST /platform/auth/{ref}/magiclink`
- `POST /platform/auth/{ref}/otp`
- `POST /platform/auth/{ref}/recover`
- `POST /platform/auth/{ref}/templates/{template}/reset`
- `POST /platform/auth/{ref}/users`
- `POST /platform/auth/{ref}/validate/spam`
- `POST /platform/cli/login`
- `POST /platform/database/{ref}/backups/download`
- `POST /platform/database/{ref}/backups/enable-physical-backups`
- `POST /platform/database/{ref}/backups/restore-physical`
- `POST /platform/database/{ref}/clone`
- `POST /platform/database/{ref}/hook-enable`
- `POST /platform/feedback/docs`
- `POST /platform/feedback/downgrade`
- `POST /platform/feedback/send`
- `POST /platform/feedback/upgrade`
- `POST /platform/integrations/github/authorization`
- `POST /platform/integrations/github/connections`
- `POST /platform/integrations/partners/{ref}/{listing_slug}`
- `POST /platform/integrations/vercel`
- `POST /platform/integrations/vercel/connections`
- `POST /platform/integrations/vercel/connections/{connection_id}/sync-envs`
- `POST /platform/oauth/apps/register`
- `POST /platform/organizations/cloud-marketplace`
- `POST /platform/organizations/confirm-subscription`
- `POST /platform/organizations/onboarding-survey`
- `POST /platform/organizations/preview-creation`
- `POST /platform/organizations/{slug}/analytics/audit-log-drains`
- `POST /platform/organizations/{slug}/apps`
- `POST /platform/organizations/{slug}/apps/installations`
- `POST /platform/organizations/{slug}/apps/{app_id}/signing-keys`
- `POST /platform/organizations/{slug}/available-versions`
- `POST /platform/organizations/{slug}/billing/credits/preview`
- `POST /platform/organizations/{slug}/billing/credits/redeem`
- `POST /platform/organizations/{slug}/billing/credits/top-up`
- `POST /platform/organizations/{slug}/billing/subscription/confirm`
- `POST /platform/organizations/{slug}/billing/subscription/preview`
- `POST /platform/organizations/{slug}/billing/upgrade-request`
- `POST /platform/organizations/{slug}/documents/dpa`
- `POST /platform/organizations/{slug}/members/invitations`
- `POST /platform/organizations/{slug}/members/invitations/{token}`
- `POST /platform/organizations/{slug}/oauth/apps`
- `POST /platform/organizations/{slug}/oauth/apps/{app_id}/client-secrets`
- `POST /platform/organizations/{slug}/oauth/apps/{id}/revoke`
- `POST /platform/organizations/{slug}/oauth/authorizations/{id}`
- `POST /platform/organizations/{slug}/payments/setup-intent`
- `POST /platform/organizations/{slug}/sso`
- `POST /platform/pg-meta/{ref}/query`
- `POST /platform/profile`
- `POST /platform/profile/access-tokens`
- `POST /platform/profile/audit-login`
- `POST /platform/profile/scoped-access-tokens`
- `POST /platform/projects/{ref}/analytics/endpoints/logs.all`
- `POST /platform/projects/{ref}/analytics/endpoints/logs.all.otel`
- `POST /platform/projects/{ref}/analytics/log-drains`
- `POST /platform/projects/{ref}/api-keys/temporary`
- `POST /platform/projects/{ref}/api/graphql`
- `POST /platform/projects/{ref}/billing/addons`
- `POST /platform/projects/{ref}/content/folders`
- `POST /platform/projects/{ref}/disk`
- `POST /platform/projects/{ref}/disk/custom-config`
- `POST /platform/projects/{ref}/notifications/advisor/exceptions`
- `POST /platform/projects/{ref}/privatelink/associations/aws-account`
- `POST /platform/projects/{ref}/resize`
- `POST /platform/projects/{ref}/restart`
- `POST /platform/projects/{ref}/restart-services`
- `POST /platform/projects/{ref}/transfer`
- `POST /platform/projects/{ref}/transfer/preview`
- `POST /platform/replication/{ref}/destinations`
- `POST /platform/replication/{ref}/destinations-pipelines`
- `POST /platform/replication/{ref}/destinations-pipelines/{destination_id}/{pipeline_id}`
- `POST /platform/replication/{ref}/destinations/validate`
- `POST /platform/replication/{ref}/destinations/{destination_id}`
- `POST /platform/replication/{ref}/pipelines`
- `POST /platform/replication/{ref}/pipelines/validate`
- `POST /platform/replication/{ref}/pipelines/{pipeline_id}`
- `POST /platform/replication/{ref}/pipelines/{pipeline_id}/rollback-tables`
- `POST /platform/replication/{ref}/pipelines/{pipeline_id}/start`
- `POST /platform/replication/{ref}/pipelines/{pipeline_id}/stop`
- `POST /platform/replication/{ref}/pipelines/{pipeline_id}/version`
- `POST /platform/replication/{ref}/sources`
- `POST /platform/replication/{ref}/sources/{source_id}/publications`
- `POST /platform/replication/{ref}/sources/{source_id}/publications/{publication_name}`
- `POST /platform/replication/{ref}/tenants-sources`
- `POST /platform/reset-password`
- `POST /platform/signup`
- `POST /platform/storage/{ref}/analytics-buckets`
- `POST /platform/storage/{ref}/analytics-buckets/{id}/namespaces`
- `POST /platform/storage/{ref}/analytics-buckets/{id}/namespaces/{namespace}/tables`
- `POST /platform/storage/{ref}/archive`
- `POST /platform/storage/{ref}/buckets`
- `POST /platform/storage/{ref}/buckets/{id}/empty`
- `POST /platform/storage/{ref}/buckets/{id}/objects/copy`
- `POST /platform/storage/{ref}/buckets/{id}/objects/list`
- `POST /platform/storage/{ref}/buckets/{id}/objects/list-v2`
- `POST /platform/storage/{ref}/buckets/{id}/objects/move`
- `POST /platform/storage/{ref}/buckets/{id}/objects/public-url`
- `POST /platform/storage/{ref}/buckets/{id}/objects/sign`
- `POST /platform/storage/{ref}/buckets/{id}/objects/sign-multi`
- `POST /platform/storage/{ref}/credentials`
- `POST /platform/storage/{ref}/vector-buckets`
- `POST /platform/storage/{ref}/vector-buckets/{id}/indexes`
- `POST /platform/stripe/projects/provisioning/account_requests/{id}/confirm`
- `POST /platform/stripe/setup-intent`
- `POST /platform/telemetry/event`
- `POST /platform/telemetry/feature-flags/track`
- `POST /platform/telemetry/groups/identify`
- `POST /platform/telemetry/groups/reset`
- `POST /platform/telemetry/identify`
- `POST /platform/telemetry/reset`
- `PUT /platform/integrations/private-link/{slug}`
- `PUT /platform/organizations/{slug}/analytics/audit-log-drains/{token}`
- `PUT /platform/organizations/{slug}/billing/subscription`
- `PUT /platform/organizations/{slug}/cloud-marketplace/link`
- `PUT /platform/organizations/{slug}/customer`
- `PUT /platform/organizations/{slug}/members/{gotrue_id}/roles/{role_id}`
- `PUT /platform/organizations/{slug}/oauth/apps/{id}`
- `PUT /platform/organizations/{slug}/payments/default`
- `PUT /platform/organizations/{slug}/sso`
- `PUT /platform/organizations/{slug}/tax-ids`
- `PUT /platform/projects/{ref}/analytics/log-drains/{token}`
- `PUT /platform/projects/{ref}/content`
- `PUT /platform/update-email`
