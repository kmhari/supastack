# Research: Auth Hooks (hook_*) — pg-functions:// + HTTPS Dispatcher

## 1. GoTrue hook dispatch mechanism

**Decision**: Use GoTrue's native `pg-functions://` dispatch — no new supastack service needed.

**Rationale**: GoTrue natively handles `pg-functions://postgres/<schema>/<func_name>` URIs by calling the Postgres function directly over the existing database connection. The function receives a `jsonb` event payload and must return a `jsonb` response matching the expected shape per hook type. GoTrue handles everything; supastack only needs to pass the env vars through to the container.

**Evidence**: `infra/supabase-template/docker-compose.yml:459-475` already has all 7 hook env var groups commented out. `infra/supabase-template/CONFIG.md:621-637` documents all env var names and their types.

**Alternatives considered**: Building a supastack hook-router microservice — rejected because the issue explicitly notes "NO new selfbase-hosted services" and GoTrue handles this natively.

---

## 2. Field classification strategy in env-field-mapper.ts

**Decision**: Replace `ADD_STORED('hook_', ...)` at line 491 with 21 explicit `honored` entries (one per field), then enforce the `pg-functions://`-only scheme constraint at runtime inside `crossFieldValidate()`.

**Rationale**: The static `fieldStatus` map reflects whether a field can be propagated to the container env at all (structural capability). All 21 hook fields can be written to env vars — the restriction is on the *value* (URI scheme), not the field itself. Separating structural honoring from value validation matches how OAuth provider fields work (they're honored; cross-field validation rejects inconsistent credential combos).

**Evidence**: `apps/api/src/services/env-field-mapper.ts:485-497` shows `ADD_STORED` bulk-marks all `hook_*` fields. `apps/api/src/services/runtime-config-store.ts:266-293` shows `crossFieldValidate()` for OAuth providers — exact same pattern to follow.

**Alternatives considered**: Keeping `hook_*` as `stored_only` and returning 400 at a higher layer — rejected because it would misrepresent the field status to CLI users and not match what upstream Supabase Cloud returns.

---

## 3. GoTrue env var names for all 21 hook fields

Confirmed from `infra/supabase-template/docker-compose.yml` and `CONFIG.md`:

| Auth-config field | GoTrue env var |
|---|---|
| `hook_custom_access_token_enabled` | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_ENABLED` |
| `hook_custom_access_token_uri` | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_URI` |
| `hook_custom_access_token_secrets` | `GOTRUE_HOOK_CUSTOM_ACCESS_TOKEN_SECRETS` |
| `hook_mfa_verification_attempt_enabled` | `GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_ENABLED` |
| `hook_mfa_verification_attempt_uri` | `GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_URI` |
| `hook_mfa_verification_attempt_secrets` | `GOTRUE_HOOK_MFA_VERIFICATION_ATTEMPT_SECRETS` |
| `hook_password_verification_attempt_enabled` | `GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_ENABLED` |
| `hook_password_verification_attempt_uri` | `GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_URI` |
| `hook_password_verification_attempt_secrets` | `GOTRUE_HOOK_PASSWORD_VERIFICATION_ATTEMPT_SECRETS` |
| `hook_send_sms_enabled` | `GOTRUE_HOOK_SEND_SMS_ENABLED` |
| `hook_send_sms_uri` | `GOTRUE_HOOK_SEND_SMS_URI` |
| `hook_send_sms_secrets` | `GOTRUE_HOOK_SEND_SMS_SECRETS` |
| `hook_send_email_enabled` | `GOTRUE_HOOK_SEND_EMAIL_ENABLED` |
| `hook_send_email_uri` | `GOTRUE_HOOK_SEND_EMAIL_URI` |
| `hook_send_email_secrets` | `GOTRUE_HOOK_SEND_EMAIL_SECRETS` |
| `hook_before_user_created_enabled` | `GOTRUE_HOOK_BEFORE_USER_CREATED_ENABLED` |
| `hook_before_user_created_uri` | `GOTRUE_HOOK_BEFORE_USER_CREATED_URI` |
| `hook_before_user_created_secrets` | `GOTRUE_HOOK_BEFORE_USER_CREATED_SECRETS` |
| `hook_after_user_created_enabled` | `GOTRUE_HOOK_AFTER_USER_CREATED_ENABLED` |
| `hook_after_user_created_uri` | `GOTRUE_HOOK_AFTER_USER_CREATED_URI` |
| `hook_after_user_created_secrets` | `GOTRUE_HOOK_AFTER_USER_CREATED_SECRETS` |

---

## 4. Boolean transform for `_enabled` fields

**Decision**: Use the existing `boolToString` transform (or `(v) => String(v)`) — same as all other `_enabled` auth fields (e.g., `external_email_enabled` → `ENABLE_EMAIL_SIGNUP` with no transform, GoTrue reads `"true"/"false"`).

**Evidence**: `apps/api/src/services/env-field-mapper.ts:75` — `external_email_enabled: { kind: 'honored', envName: 'ENABLE_EMAIL_SIGNUP' }` has no explicit transform, relying on `defaultEnvValueTransform`. Checking `defaultEnvValueTransform` confirms it calls `String(v)` for booleans.

---

## 5. Secret masking for `_secrets` fields

**Decision**: Mark all 7 `hook_*_secrets` fields with `secret: true` in the honored entry — same as `smtp_pass` and OAuth `_secret` fields.

**Evidence**: `packages/shared/src/schemas/mgmt-api-auth-config.ts:35-41` already lists all 7 hook secrets in the `SECRET_FIELDS` set used by `getConfig` to mask values. The `env-field-mapper.ts` `secret: true` flag is the write-path complement.

---

## 6. Cross-field validation rules needed

Two new rules to add in `crossFieldValidate()`:

1. **URI scheme guard**: For every `hook_*_uri` field in the merged config that has a non-null/non-empty value, if the value does not start with `pg-functions://`, throw `ManagementApiError(400, 'HTTPS hook URIs are not yet supported. See issue #64 for progress.', 'hook_uri_scheme_unsupported', { field })`.

2. **Enabled-requires-URI guard**: For every `hook_*_enabled = true` in the merged config, if the corresponding `hook_*_uri` is null/undefined/empty string, throw `ManagementApiError(400, 'A URI is required when a hook is enabled.', 'hook_uri_required', { field })`.

---

## 7. docker-compose.yml activation

**Decision**: Uncomment the 21 `GOTRUE_HOOK_*` lines in `infra/supabase-template/docker-compose.yml`. But keep the format as `GOTRUE_HOOK_*: "${GOTRUE_HOOK_*:-}"` (using the env-file substitution pattern already in use) rather than hardcoded values, so values flow through from the `.env` file written by `applyEnvAndRestart`.

**Evidence**: The existing commented lines use literal values as examples — they need to be replaced with the `${VAR:-}` interpolation pattern used by all other GoTrue env vars in the compose file.

---

## 8. Dashboard page structure

**Decision**: New page `ProjectAuthHooks.tsx` at `/dashboard/project/:ref/auth/hooks`. Each of the 7 hook types renders as an expandable card or form group with: enabled toggle, URI text input, secrets text input. On Save, calls `useRestartToast` (same as Providers page). No drawer/sheet — hooks are simpler (3 fields per type, not a full OAuth config).

**Rationale**: Hooks have no callback URL or complex multi-field OAuth shape, so a flat form-per-hook layout is simpler than the Sheet drawer used for OAuth providers.

**Evidence**: `apps/web/src/pages/ProjectAuthProviders.tsx` shows the providers pattern. `apps/web/src/pages/auth-providers/use-restart-toast.ts` is already extracted for reuse.
