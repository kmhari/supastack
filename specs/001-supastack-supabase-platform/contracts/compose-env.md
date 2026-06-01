# Contract — Per-instance `.env`

The complete contract for the per-instance `.env` file supastack writes into `/var/supastack/instances/<ref>/.env` before running `docker compose -p supastack-<ref> up -d`.

**Source of truth**: `infra/supabase-template/.env.example` — vendored from `supabase/supabase` `docker/.env.example` at a pinned commit. The compose templater asserts that **every** variable referenced anywhere in `infra/supabase-template/docker-compose.yml`, `kong.yml`, `vector.yml`, or `volumes/db/*.sql` is set in the emitted `.env` (with empty-string fallback for opt-outs). This is enforced at provision-time, not at runtime — a missing variable aborts the job before any container starts.

## Variable groups

### Identity (supastack-derived)

| Var | Source | Notes |
|---|---|---|
| `PROJECT_REF` | supastack | the `ref` (20 alphanumerics) |
| `STUDIO_DEFAULT_ORGANIZATION` | supastack | mirrors `name` |
| `STUDIO_DEFAULT_PROJECT` | supastack | mirrors `name` |

### Secrets (supastack-generated, decrypted from `encrypted_secrets`)

| Var | Generator | Constraint |
|---|---|---|
| `JWT_SECRET` | 40 random bytes, base64 | — |
| `ANON_KEY` | HS256 JWT signed with `JWT_SECRET`; payload `{role:'anon', iss:'supabase', iat, exp}` | — |
| `SERVICE_ROLE_KEY` | HS256 JWT signed with `JWT_SECRET`; payload `{role:'service_role', iss:'supabase', iat, exp}` | — |
| `POSTGRES_PASSWORD` | 32 random chars from `[A-Za-z0-9]` | **MUST NOT** contain `$`, `\`, backtick, or whitespace |
| `DASHBOARD_PASSWORD` | 16 random chars from `[A-Za-z0-9]` | same constraints |
| `SECRET_KEY_BASE` | 64 random bytes, base64 | required by upstream auth |
| `VAULT_ENC_KEY` | 32 random bytes, hex | required by Supabase Vault extension |
| `LOGFLARE_PUBLIC_ACCESS_TOKEN` | 32 random chars | analytics |
| `LOGFLARE_PRIVATE_ACCESS_TOKEN` | 32 random chars | analytics |
| `PG_META_CRYPTO_KEY` | 32 random bytes, base64 | required by pg-meta |
| `S3_PROTOCOL_ACCESS_KEY_ID` | 32 hex | per-instance MinIO if storage enabled |
| `S3_PROTOCOL_ACCESS_KEY_SECRET` | 64 hex | per-instance MinIO |
| `MINIO_ROOT_PASSWORD` | 32 hex | per-instance MinIO |

### Ports (supastack-allocated)

| Var | Source |
|---|---|
| `KONG_HTTP_PORT` | `port_kong` |
| `KONG_HTTPS_PORT` | unused externally (Caddy terminates TLS); set to a unique value anyway to avoid Compose collision |
| `STUDIO_PORT` | `port_studio` |
| `POSTGRES_PORT` | `port_postgres` |
| `POOLER_PROXY_PORT_TRANSACTION` | `port_pooler` |
| `LOGFLARE_PORT` / analytics port | `port_analytics` |

### URLs (supastack-derived from `ref` + `apex`)

| Var | Value |
|---|---|
| `SUPABASE_PUBLIC_URL` | `https://<ref>.<apex>` |
| `API_EXTERNAL_URL` | `https://<ref>.<apex>` |
| `SITE_URL` | `https://<ref>.<apex>` |
| `ADDITIONAL_REDIRECT_URLS` | empty |
| `NEXT_PUBLIC_BASE_PATH` | `/studio` (constant; baked into the Studio image as well, but Compose still passes it) |

### Auth/feature flags (from create-time form)

| Var | Source | Default |
|---|---|---|
| `DISABLE_SIGNUP` | inverse of `enableSignup` | `false` (i.e., signup enabled) |
| `JWT_EXPIRY` | `jwtExpirySec` | `3600` |
| `ENABLE_EMAIL_SIGNUP` | `'true'` | constant |
| `ENABLE_EMAIL_AUTOCONFIRM` | `'false'` | constant |
| `ENABLE_ANONYMOUS_USERS` | `'false'` | constant |
| `ENABLE_PHONE_SIGNUP` | `'false'` | constant |
| `ENABLE_PHONE_AUTOCONFIRM` | `'false'` | constant |

### SMTP (from create-time form, encrypted at rest)

| Var | Source | If unset |
|---|---|---|
| `SMTP_ADMIN_EMAIL` | form | empty |
| `SMTP_HOST` | form | empty |
| `SMTP_PORT` | form | empty |
| `SMTP_USER` | form | empty |
| `SMTP_PASS` | form (decrypted from `create_smtp_pass_encrypted`) | empty |
| `SMTP_SENDER_NAME` | form (or instance `name`) | the instance `name` |
| `MAILER_URLPATHS_INVITE` | constant | `/auth/v1/verify` |
| `MAILER_URLPATHS_CONFIRMATION` | constant | `/auth/v1/verify` |
| `MAILER_URLPATHS_RECOVERY` | constant | `/auth/v1/verify` |
| `MAILER_URLPATHS_EMAIL_CHANGE` | constant | `/auth/v1/verify` |

### Database settings (constant)

| Var | Value |
|---|---|
| `POSTGRES_HOST` | `db` (Docker network) |
| `POSTGRES_DB` | `postgres` |
| `POSTGRES_USER` | `postgres` |
| `PGRST_DB_SCHEMAS` | `public,storage,graphql_public` |
| `POOLER_DEFAULT_POOL_SIZE` | `20` |
| `POOLER_MAX_CLIENT_CONN` | `100` |
| `POOLER_TENANT_ID` | `<ref>` |

### Docker / system

| Var | Value |
|---|---|
| `DOCKER_SOCKET_LOCATION` | `/var/run/docker.sock` — **always set explicitly** (Multibase's `:/var/run/docker.sock:ro,z` failure was caused by leaving this empty) |
| `FUNCTIONS_VERIFY_JWT` | `false` |
| `IMGPROXY_ENABLE_WEBP_DETECTION` | `true` |

## Validation rules (enforced by the templater)

1. **Completeness**: every `${VAR}` referenced in the vendored template must be present in the emitted `.env` (empty-string allowed but key MUST exist).
2. **Forbidden characters in secrets**: `POSTGRES_PASSWORD`, `DASHBOARD_PASSWORD`, and any other field that lands inside `.env` MUST be `[A-Za-z0-9]+` only — no `$`, `\`, backtick, whitespace, or quote characters that would interact with Compose's variable substitution or shell escaping.
3. **Numeric values**: ports are integers in the configured range; `JWT_EXPIRY` is a positive integer.
4. **URL fields**: `SUPABASE_PUBLIC_URL` / `API_EXTERNAL_URL` / `SITE_URL` are valid URLs with scheme `https` (HTTP is rejected outside development mode).
5. **Round-trip check**: after writing `.env`, run `docker compose --env-file .env config -q` from the instance directory; non-zero exit aborts the provision and surfaces the parse error verbatim.

These checks live in `packages/docker-control/src/compose-template.ts` and are unit-tested with both the success case and the Multibase failure cases (variable-substitution password, missing variables, empty `DOCKER_SOCKET_LOCATION`).
