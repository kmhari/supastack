# Data Model: Auth Hooks (hook_*) — pg-functions:// + HTTPS Dispatcher

## Overview

This feature introduces no new database tables or columns. All hook configuration is persisted as part of the existing `project_config_snapshots` encrypted JSON payload (surface `auth`), which already stores all auth-config fields. The 21 hook fields are already defined in the auth-config Zod schema (`packages/shared/src/schemas/mgmt-api-auth-config.ts:192-212`).

## Existing Schema (unchanged)

### `project_config_snapshots` table (packages/db)

| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `instance_ref` | text FK → instances.ref | Per-project |
| `surface` | text | `'auth'` or `'postgrest'` |
| `encrypted_payload` | bytea | AES-GCM encrypted JSON blob |
| `updated_at` | timestamptz | |

The `auth` surface payload is a flat JSON object of all `AuthConfigPatch` fields. Hook fields are already included in the Zod schema and are stored/retrieved as part of this blob.

## Hook Configuration Shape (within auth config payload)

Per hook type, three fields are stored:

```typescript
// Per hook type (7 types × 3 fields = 21 fields total)
hook_<type>_enabled:  boolean | null   // Whether GoTrue dispatches this hook
hook_<type>_uri:      string  | null   // pg-functions://postgres/<schema>/<func_name>
hook_<type>_secrets:  string  | null   // v1,whsec_<base64> (signature verification key)
```

Where `<type>` is one of:
- `custom_access_token`
- `mfa_verification_attempt`
- `password_verification_attempt`
- `send_sms`
- `send_email`
- `before_user_created`
- `after_user_created`

## Validation Rules (enforced at PATCH time)

| Rule | Condition | Error |
|---|---|---|
| URI scheme | `hook_*_uri` value does not start with `pg-functions://` | 400 `hook_uri_scheme_unsupported` |
| Enabled-requires-URI | `hook_*_enabled = true` AND `hook_*_uri` is null/empty | 400 `hook_uri_required` |

## Secret Masking

Hook secrets (`hook_*_secrets`) are included in the `SECRET_FIELDS` set in `packages/shared/src/schemas/mgmt-api-auth-config.ts`. `GET /v1/projects/:ref/config/auth` returns them as `"***"`. `GET /v1/projects/:ref/config/auth/reveal` returns plaintext.

## Container Environment Mapping

Each of the 21 fields maps to a GoTrue env var in the per-project `.env` file written by `applyEnvAndRestart`. No new storage; env vars flow through the existing `upsertEnvEntry`/`removeEnvEntry` mechanism.

See `research.md` §3 for the full field → env var mapping table.
