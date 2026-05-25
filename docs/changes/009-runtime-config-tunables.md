# Feature 009 — Runtime config tunables (`postgres-config` + `auth-config`)

**Closes**: Issue #11
**Status**: 🚧 in flight (this branch)
**Spec**: [specs/009-runtime-config-tunables/](../../specs/009-runtime-config-tunables/)
**Follow-up**: [issue #21](https://github.com/kmhari/selfbase/issues/21) — close the shape-vs-behavioral parity gap for stored-only auth-config fields

## What changed

Replaced the catch-all `501 not_implemented` response for four Supabase Management API surfaces:

| Method  | Path                             | Powers                                                  |
| ------- | -------------------------------- | ------------------------------------------------------- |
| `GET`   | `/v1/projects/<ref>/postgrest`   | direct HTTP / future `supabase config push` (issue #26) |
| `PATCH` | `/v1/projects/<ref>/postgrest`   | direct HTTP / future `supabase config push` (issue #26) |
| `GET`   | `/v1/projects/<ref>/config/auth` | direct HTTP / future `supabase config push` (issue #26) |
| `PATCH` | `/v1/projects/<ref>/config/auth` | direct HTTP / future `supabase config push` (issue #26) |

Today operators who want to change `jwt_exp`, add a schema to PostgREST, toggle an OAuth provider, or change SMTP creds SSH into the host and edit the per-instance `.env` by hand. After this feature, the HTTP API surface backs these knobs and the dashboard / curl / a future CLI shim can all consume it.

**CLI compatibility note**: the original spec assumed `supabase postgres-config update --max-rows N` and `supabase config update --auth-*` worked. CLI v2.72+ removed those imperative flags in favor of declarative `supabase config push` reading `config.toml`. `config push` needs 3 additional endpoints selfbase doesn't yet provide (`billing/addons`, `config/database/postgres`, `ssl-enforcement`). That work is tracked as [issue #26](https://github.com/kmhari/selfbase/issues/26). The HTTP endpoints in this feature are the stable contract — they work today via curl and will work via `config push` once issue #26 lands.

## How it works

```
                ┌─────────────────────────────────────────────────────────┐
PATCH ────────► │  per-project Redis lock (config-write-lock:<ref>, 60s)  │
                │      ↓                                                  │
                │  Zod schema validate (bounds match upstream OpenAPI)    │
                │      ↓                                                  │
                │  Load current snapshot (encrypted JSONB) + decrypt      │
                │      ↓                                                  │
                │  Merge body over current; resolve "***" sentinels for   │
                │    every SECRET_FIELDS entry → preserve existing value  │
                │      ↓                                                  │
                │  Cross-field validate (OAuth enabled needs credentials) │
                │      ↓                                                  │
                │  For each honored field: rewrite .env via upsertEnvEntry│
                │      ↓                                                  │
                │  UPSERT project_config_snapshots (re-encrypted)         │
                │      ↓                                                  │
                │  restartOrRollback(container) — on failure: restore     │
                │    .env from backup + revert snapshot + 500             │
                │      ↓                                                  │
                │  Emit audit_log entry (secret diffs redacted to ***)    │
                └─────────────────────────────────────────────────────────┘
GET ──► load snapshot → redact SECRET_FIELDS → return (no container hit)
```

## Honored vs stored-only fields (the gap to know about)

The PATCH endpoint accepts **the full upstream `UpdateAuthConfigBody` shape** (234 fields). Each field is one of:

- **Honored** — backed by a `GOTRUE_*` or `PGRST_*` env var that the per-instance `infra/supabase-template/docker-compose.yml` wires into the container. PATCH writes the env line, restarts the container, the value takes effect.
- **Stored-only** — accepted, validated, persisted in `project_config_snapshots`, returned on GET — but no container env var is wired today. The PATCH succeeds (so the unmodified CLI keeps working), but the runtime container behavior is unchanged.

Honored today (Phase 1 of this feature):

| Surface   | Field                                                                 | Env var                                                 |
| --------- | --------------------------------------------------------------------- | ------------------------------------------------------- |
| postgrest | `db_schema`                                                           | `PGRST_DB_SCHEMAS`                                      |
| postgrest | `db_extra_search_path`                                                | `PGRST_DB_EXTRA_SEARCH_PATH`                            |
| postgrest | `max_rows`                                                            | `PGRST_DB_MAX_ROWS`                                     |
| postgrest | `db_pool`                                                             | `PGRST_DB_POOL` (omitted when `null` ⇒ auto-configured) |
| auth      | `jwt_exp`                                                             | `JWT_EXPIRY`                                            |
| auth      | `site_url`                                                            | `SITE_URL`                                              |
| auth      | `uri_allow_list`                                                      | `ADDITIONAL_REDIRECT_URLS`                              |
| auth      | `disable_signup`                                                      | `DISABLE_SIGNUP`                                        |
| auth      | mailer + sms + smtp\_\*                                               | corresponding `GOTRUE_SMTP_*` / `ENABLE_*`              |
| auth      | 22 OAuth provider triples (`external_<p>_{enabled,client_id,secret}`) | `GOTRUE_EXTERNAL_<P>_*` ⚠                               |

⚠ The per-instance template has every `GOTRUE_EXTERNAL_*` provider line **commented out by default**. The mapper marks them honored (the env var name is the contract), but until the template is updated or operators uncomment manually, setting `external_<provider>_enabled: true` writes the env line but has no runtime effect. Tracked in [#21](https://github.com/kmhari/selfbase/issues/21).

Stored-only today: hook URIs and secrets (Cloud-only serverless hooks selfbase doesn't ship), SAML SSO (no SAML provisioning yet), `security_captcha_*` (operators bring their own keys), various MFA + rate-limit + session knobs not wired into the template. Full per-field inventory is the deliverable of issue #21.

## Security posture

- **PAT auth + RBAC** — 4 new actions mirror upstream Supabase FGA permissions: `data_api_config.{read,write}`, `auth_config.{read,write}`. Members get read; admins get write.
- **Secrets at rest** — the snapshot JSONB is encrypted via the master-key envelope (`@selfbase/crypto`), same as `projectSecrets.encryptedValue`. Plaintext secrets never appear in the snapshot column.
- **Secrets in GET** — every field in `SECRET_FIELDS` (35 entries: OAuth `_secret`s, SMTP password, hook secrets, captcha secret, SMS provider creds) is redacted to the literal `***` sentinel.
- **Secrets in audit** — even on a successful PATCH that rotates a secret, both `old` and `new` in the `audit_log.payload.diff` are `***`. The audit log records _that_ a secret changed; it does not record the values.
- **Secret round-trip** — on PATCH, if a SECRET_FIELDS value equals `***`, the merge preserves the existing value. This makes the CLI's `get → modify-one-field → patch-full-body` round-trip safe; CLI users won't accidentally clobber every secret with the literal string `***`.

## Per-project write serialization

Both surfaces share the per-instance `.env` file, so a concurrent PATCH on `/postgrest` + PATCH on `/config/auth` for the same project would race the file writer. Redis `SETNX` on `selfbase:config-write-lock:<ref>` (60s TTL) serializes per-project. The second writer gets `409 config_write_in_progress` with `details.lock_ttl_seconds` so the CLI can decide whether to retry.

## Rollback on container failure

If GoTrue/PostgREST refuses the new env (e.g. a malformed `uri_allow_list` regex that passes our shape validation but the container rejects on boot): the system atomically restores the `.env` from backup, restarts the container on the prior config (comes back healthy in ~5s typical), and returns `500 restart_failed`. The snapshot row is not advanced. GET continues to reflect the prior config.

## Files

- New: `apps/api/src/routes/management/{postgrest-config,auth-config}.ts`
- New: `apps/api/src/services/{runtime-config-store,env-field-mapper,container-reload}.ts`
- New: `packages/db/migrations/0009_project_config_snapshots.sql` + `packages/db/src/schema/project-config.ts`
- New: `packages/shared/src/schemas/mgmt-api-{postgrest,auth}-config.ts` (auth schema generated from upstream OpenAPI snapshot at `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json`)
- Edit: `packages/shared/src/rbac.ts` — 4 new actions
- Edit: `apps/api/src/services/secret-store.ts` — now delegates `restartOrRollback` to the extracted helper
- Edit: `apps/api/src/server.ts` — register the 2 new route modules before the `notImplementedRoutes` catch-all
- Tests: 3 unit (`apps/api/tests/unit/{env-field-mapper,mgmt-api-config-validation,runtime-config-store}.test.ts`) + 4 integration (`apps/api/tests/integration/management-api/{auth-config,postgrest-config,runtime-config-audit,runtime-config-not-501}.test.ts`)
- CLI e2e: **deferred** — see [issue #26](https://github.com/kmhari/selfbase/issues/26). The upstream `supabase` CLI evolved away from imperative flags between v2.41 and v2.72; full `supabase config push` compat requires 3 additional endpoints out of scope for this feature.
