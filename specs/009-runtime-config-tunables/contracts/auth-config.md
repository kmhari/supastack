# Contract — `/v1/projects/<ref>/config/auth`

Mirrors upstream Supabase Management API. Source: `https://api.supabase.com/api/v1-json` operations `v1-get-auth-service-config` and `v1-update-auth-service-config`. Upstream's `UpdateAuthConfigBody` has ~234 properties; this contract documents the full shape but enumerates only the load-bearing ones inline. The complete field list with honored-vs-stored markers lives in `apps/api/src/services/env-field-mapper.ts::AUTH_CONFIG_MAP`.

## `GET /v1/projects/<ref>/config/auth`

**Auth**: PAT bearer; RBAC action `auth_config.read`.

**Response 200** (`application/json`): every property in upstream's auth-config response schema. Project's current value if set; upstream-documented default otherwise.

Representative subset:

```json
{
  "site_url": "https://example.com",
  "uri_allow_list": "https://example.com,https://example.com/*",
  "jwt_exp": 3600,
  "disable_signup": false,

  "mailer_autoconfirm": false,
  "mailer_otp_exp": 86400,
  "mailer_otp_length": 6,
  "sms_otp_exp": 60,
  "sms_otp_length": 6,
  "smtp_max_frequency": 60,
  "smtp_admin_email": "admin@example.com",
  "smtp_host": "smtp.example.com",
  "smtp_port": 587,
  "smtp_user": "smtp-user",
  "smtp_pass": "***",

  "external_email_enabled": true,
  "external_phone_enabled": false,

  "external_apple_enabled": false,
  "external_apple_client_id": "",
  "external_apple_secret": "***",
  "external_azure_enabled": false,
  "external_azure_client_id": "",
  "external_azure_secret": "***",
  "external_bitbucket_enabled": false,
  "external_bitbucket_client_id": "",
  "external_bitbucket_secret": "***",
  "external_discord_enabled": false,
  "external_discord_client_id": "",
  "external_discord_secret": "***",
  "external_facebook_enabled": false,
  "external_facebook_client_id": "",
  "external_facebook_secret": "***",
  "external_figma_enabled": false,
  "external_figma_client_id": "",
  "external_figma_secret": "***",
  "external_fly_enabled": false,
  "external_fly_client_id": "",
  "external_fly_secret": "***",
  "external_github_enabled": false,
  "external_github_client_id": "",
  "external_github_secret": "***",
  "external_gitlab_enabled": false,
  "external_gitlab_client_id": "",
  "external_gitlab_secret": "***",
  "external_google_enabled": true,
  "external_google_client_id": "abc.apps.googleusercontent.com",
  "external_google_secret": "***",
  "external_kakao_enabled": false,
  "external_kakao_client_id": "",
  "external_kakao_secret": "***",
  "external_keycloak_enabled": false,
  "external_keycloak_client_id": "",
  "external_keycloak_secret": "***",
  "external_linkedin_enabled": false,
  "external_linkedin_client_id": "",
  "external_linkedin_secret": "***",
  "external_notion_enabled": false,
  "external_notion_client_id": "",
  "external_notion_secret": "***",
  "external_slack_enabled": false,
  "external_slack_client_id": "",
  "external_slack_secret": "***",
  "external_snapchat_enabled": false,
  "external_snapchat_client_id": "",
  "external_snapchat_secret": "***",
  "external_spotify_enabled": false,
  "external_spotify_client_id": "",
  "external_spotify_secret": "***",
  "external_twitch_enabled": false,
  "external_twitch_client_id": "",
  "external_twitch_secret": "***",
  "external_twitter_enabled": false,
  "external_twitter_client_id": "",
  "external_twitter_secret": "***",
  "external_workos_enabled": false,
  "external_workos_client_id": "",
  "external_workos_secret": "***",
  "external_x_enabled": false,
  "external_x_client_id": "",
  "external_x_secret": "***",
  "external_zoom_enabled": false,
  "external_zoom_client_id": "",
  "external_zoom_secret": "***",

  "password_min_length": 6,

  "...": "...stored-only fields documented in env-field-mapper.ts (hook_*, saml_*, security_captcha_*, etc.)..."
}
```

**Secret redaction (FR-003)**: every field whose name matches `*_secret`, `*_pass`, `*_password`, `hook_*_secrets` MUST be returned as the literal string `***`. The set is enumerated in `packages/shared/src/schemas/mgmt-api-auth-config.ts::SECRET_FIELDS`. Plaintext secret values MUST NOT appear in any GET response.

**Error responses**: identical to postgrest contract (401 / 403 / 404 / 409).

## `PATCH /v1/projects/<ref>/config/auth`

**Auth**: PAT bearer; RBAC action `auth_config.write`.

**Request body**: full upstream `UpdateAuthConfigBody` shape (any subset). Fields absent from the body retain their existing values.

**Validation** (`packages/shared/src/schemas/mgmt-api-auth-config.ts`):

| Field | Type | Bounds |
|---|---|---|
| `jwt_exp` | integer | 0–604,800 |
| `mailer_otp_exp` | integer | 0–2,147,483,647 |
| `sms_otp_exp` | integer | 0–2,147,483,647 |
| `mailer_otp_length` | integer | 6–10 |
| `password_min_length` | integer | 6–32,767 |
| `smtp_max_frequency` | integer | 0–32,767 |
| `sms_max_frequency` | integer | 0–32,767 |
| `mfa_phone_max_frequency` | integer | 0–32,767 |
| `rate_limit_*` | integer | 1–2,147,483,647 |
| `external_<provider>_enabled` | boolean | (no bounds) |
| `external_<provider>_client_id` | string | (no bounds) |
| `external_<provider>_secret` | string | (`***` sentinel = "leave unchanged"; any other string = replace) |
| `site_url`, `uri_allow_list`, `smtp_*` | string | (no bounds) |
| `mailer_autoconfirm`, `disable_signup`, etc. | boolean | (no bounds) |
| ... | ... | (full table in Zod schema; bounds match upstream OpenAPI exactly) |

Any field not present in upstream's `UpdateAuthConfigBody` schema → 400 `validation_failed` with `error.details.<field> = "unknown_field"`.

**Cross-field validation**:
- For each OAuth provider: if `external_<provider>_enabled: true` AND (`external_<provider>_client_id` is empty OR resolved secret is empty after sentinel-merge), reject 400 with `error.details.external_<provider> = "missing_credentials"`. (Spec Edge Case + FR-005.)

**Secret sentinel merge (FR-004 + Q5)**: for every field in `SECRET_FIELDS`, if the incoming PATCH value is `===` to `REDACTED_SECRET` (`'***'`), the existing persisted value is kept. Otherwise the incoming value replaces it.

**Response 200**: full post-merge config (same shape as GET, with secrets redacted).

**Side effects**:
1. Acquire Redis lock `supastack:config-write-lock:<ref>` (TTL 60s); 409 `config_write_in_progress` if held.
2. Validate via Zod → 400 on any field error.
3. Load current snapshot (decrypt with master key) → merge body → sentinel-resolve secrets → cross-field validate → 400 on missing_credentials.
4. For every honored field in the post-merge config: `upsertEnvEntry` into per-instance `.env`.
5. INSERT or UPDATE `project_config_snapshots` row for `(ref, 'auth')`, re-encrypting the post-merge JSON.
6. `docker restart supastack-<ref>-auth-1` → `waitContainerHealthy(5000)`.
7. On failure after step 4: rollback `.env` from backup, revert snapshot row, return 500 `restart_failed`.
8. Emit `audit_log` entry `action='mgmt_api.auth_config.update'`. Secret-typed fields appear in `diff` with both `old` and `new` redacted to `***` — the audit log MUST NOT leak plaintext secrets.
9. Release Redis lock.

## CLI invocations covered

```bash
supabase config get --project-ref <ref>
supabase config update --project-ref <ref> --auth-jwt-expiry 86400
supabase config update --project-ref <ref> --auth-site-url https://example.com
supabase config update --project-ref <ref> --auth-disable-signup
supabase config update --project-ref <ref> --auth-google-enabled true \
  --auth-google-client-id abc.apps.googleusercontent.com \
  --auth-google-secret <plaintext>
```

The OAuth-related flag set covers all 22 providers listed in spec FR-003.
