# Feature Specification: Runtime config tunables (postgres-config + auth-config) via Supabase CLI

**Feature Branch**: `009-runtime-config-tunables`

**Created**: 2026-05-25

**Status**: Draft

**Input**: User description: "read issue 11" — picks up GitHub issue #11 (postgres-config + auth-config runtime tunables, split from issue #4 Tier 1 after gen-types shipped as feature 006).

## Clarifications

### Session 2026-05-25

- Q: Which OAuth provider set is in scope for the auth-config GET/PATCH endpoints? → A: All 22 providers wired in the per-instance `.env` template (apple, azure, bitbucket, discord, facebook, figma, fly, github, gitlab, google, kakao, keycloak, linkedin, notion, slack, snapchat, spotify, twitch, twitter, workos, x, zoom) — no curated subset.
- Q: What RBAC action names guard the four endpoints? → A: Mirror upstream Supabase Management API FGA permissions — `data_api_config.read` (GET postgrest), `data_api_config.write` (PATCH postgrest), `auth_config.read` (GET config/auth), `auth_config.write` (PATCH config/auth). Four new actions added to `packages/shared/src/rbac.ts`.
- Q: What numeric validation bounds apply to non-jwt_exp fields? → A: Match upstream Supabase OpenAPI bounds exactly — `max_rows` 0–1,000,000; `db_pool` 0–1,000 nullable (null means auto-configured); `jwt_exp` 0–604,800 (7 days); `mailer_otp_exp` and `sms_otp_exp` 0–2,147,483,647; `mailer_otp_length` 6–10; `password_min_length` 6–32,767; `smtp_max_frequency`/`sms_max_frequency`/`mfa_phone_max_frequency` 0–32,767. Zero divergence from Cloud's accept/reject behavior on a given request body.
- Q: How much of upstream's 234-field auth-config body is in scope? → A: Full shape parity, partial behavioral parity. The PATCH endpoint accepts the full upstream `UpdateAuthConfigBody` shape and persists every field. Fields backed by the per-instance template's GoTrue env vars are honored end-to-end. Fields backed by infra selfbase does not ship (Cloud-only hooks, SAML SSO infra, Cloud-provided captcha, etc.) are stored and returned on GET as-supplied but do not change container behavior. CLI compatibility is preserved (no 400s on typical CLI bodies). A separate GH issue (#21) tracks closing the gap field-by-field, with #11 linked as the originator.
- Q: How does PATCH handle secret fields whose value matches the redaction sentinel `***`? → A: The sentinel `***` on PATCH means "leave the existing secret value unchanged" — PATCH only writes a secret field when the incoming value is a non-redacted plaintext string. Makes the `GET → modify one field → PATCH full body` round-trip safe (CLI users won't clobber every secret with `***`). Applies to: OAuth `external_<provider>_secret`, SMTP password, hook secrets, and any other field GET redacts.

## Background

selfbase currently returns `501 not_implemented` for the Supabase CLI's `postgres-config` and `config` (auth section) commands. Operators who need to change runtime knobs — extend JWT expiry past the default 1 hour, expose a custom schema in PostgREST, change a site URL, toggle signups — must SSH into the host, edit the per-instance `.env` by hand, and `docker-compose restart` the affected container. This feature exposes those knobs through the existing Management API so the upstream `supabase` CLI works against selfbase for these two commands.

Most projects keep defaults; this is a low-volume but important surface for the operators who do need it. Implementation is additive — the per-instance `.env` already drives both PostgREST and GoTrue containers; we add field validation, persistence, and a reload trigger.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Extend JWT expiry on a selfbase project (Priority: P1)

A team's mobile app sessions are timing out after 1 hour because GoTrue defaults to `JWT_EXP=3600`. The operator runs `supabase config update --project-ref <ref> --auth-jwt-expiry 86400` against their selfbase instance. The change persists, the per-instance GoTrue container picks it up within a few seconds, and new sign-ins issue JWTs with a 24-hour expiry. Existing signed-in users are not signed out.

**Why this priority**: Most-cited real demand from the issue. Today this requires manual `.env` editing on the host, which most teams can't do safely. Single-field change with high value.

**Independent Test**: `supabase config get --project-ref <ref>` shows `jwt_exp: 3600`. Run update to 86400. Re-`get` shows `jwt_exp: 86400`. Sign a user in; decode their JWT; verify `exp - iat ≈ 86400 ±60s`. Existing pre-update session continues to work until its original expiry.

**Acceptance Scenarios**:

1. **Given** a project with default auth config, **When** the operator GETs `/v1/projects/<ref>/config/auth`, **Then** the response contains every field listed in FR-003 with current values.
2. **Given** the operator PATCHes `/v1/projects/<ref>/config/auth` with `{ jwt_exp: 86400 }`, **When** a user signs in after the change has propagated (<30s), **Then** the issued JWT's `exp - iat` is approximately 86400 seconds (±60s for container restart timing).
3. **Given** a user already had an active session before the PATCH, **When** they make API calls after the GoTrue container restarts, **Then** their existing JWT is still accepted until its original expiry (no forced sign-out).
4. **Given** the operator PATCHes with `{ jwt_exp: 30 }` (below 60s minimum), **When** the request is evaluated, **Then** the response is 400 with `{ error: { details: { jwt_exp: "must be between 60 and 2592000" } } }` and no config change is persisted.

---

### User Story 2 — Expose a custom Postgres schema through PostgREST (Priority: P1)

A team has built their API surface in an `app_v2` schema and wants PostgREST to expose it alongside `public`. The operator runs `supabase postgres-config update --project-ref <ref> --db-schema "public,app_v2"`. The per-instance PostgREST container restarts within ~30s, and `GET /<ref>.<apex>/rest/v1/app_v2.some_table` returns 200 instead of the prior 404.

**Why this priority**: Second-most-cited real demand. Today this needs manual `.env` editing. Single-field change; same plumbing as Story 1 but against PostgREST instead of GoTrue.

**Independent Test**: GET PostgREST config shows `db_schema: "public"`. Update to `"public,app_v2"`. Re-GET shows new value. Call `/rest/v1/app_v2.some_table` against the project — must return 200 once it would have previously returned 404.

**Acceptance Scenarios**:

1. **Given** a project with default PostgREST config, **When** the operator GETs `/v1/projects/<ref>/postgrest`, **Then** the response contains `db_schema`, `db_extra_search_path`, `max_rows`, `db_pool` with current values.
2. **Given** the operator PATCHes with `{ db_schema: "public,app_v2" }`, **When** a request hits `/rest/v1/app_v2.<table>` after PostgREST reloads (<30s), **Then** the request is served (no longer 404 for "schema not exposed").
3. **Given** the operator PATCHes only `{ max_rows: 5000 }`, **When** the next GET runs, **Then** `max_rows` is `5000` and `db_schema`, `db_extra_search_path`, `db_pool` retain their previous values.
4. **Given** the operator PATCHes with `{ max_rows: -1 }`, **When** the request is evaluated, **Then** the response is 400 with `{ error: { details: { max_rows: "must be a non-negative integer" } } }`.

---

### Edge Cases

- **Unknown field in PATCH body** (typo, e.g. `jwt_expiry` instead of `jwt_exp`): the request MUST be rejected 400 with `{ error: { details: { <field>: "unknown_field" } } }`. Unknown fields are never silently dropped.
- **Container fails to restart with the new config** (e.g. operator sets a malformed regex in `uri_allow_list` that passes our shape validation but GoTrue rejects on boot): the previous `.env` MUST be restored, the container MUST come back on the old config, and the API call MUST return 500 with a diagnostic indicating the container refused the new value. The on-disk state and the API view MUST remain consistent.
- **Concurrent PATCHes to the same project**: writes are serialized per project via a short-TTL distributed lock. The first writer acquires the lock and proceeds; a second writer arriving while the lock is held is rejected immediately with `409 config_write_in_progress` (its `error.details` MUST include the lock TTL so a CLI client can decide whether to retry). The lock spans both surfaces (`postgrest` and `auth`) because they share the per-instance `.env` file. Once the first writer completes (success or rollback), the lock is released and subsequent PATCHes proceed normally.
- **Project not in `running` state**: GET returns the persisted last-known config (no container hit). PATCH returns 409 `project_not_running`.
- **PATCH with empty body `{}`**: treated as a no-op; returns 200 with the current config and triggers no container restart.
- **OAuth provider toggle that requires a missing client secret**: PATCH that sets `external_<provider>_enabled: true` without a corresponding client_id+secret already set MUST be rejected 400 with `{ external_<provider>: "missing credentials" }`.
- **PATCH attempted by an actor without write access to the project**: 403, no state change, no audit log entry (per existing RBAC conventions).

## Requirements *(mandatory)*

### Functional Requirements

#### PostgREST runtime config

- **FR-001**: System MUST expose `GET /v1/projects/<ref>/postgrest` returning the current PostgREST runtime config as `{ db_schema, db_extra_search_path, max_rows, db_pool }`, matching the upstream Cloud response shape so the unmodified `supabase` CLI parses it.
- **FR-002**: System MUST expose `PATCH /v1/projects/<ref>/postgrest` accepting any subset of `{ db_schema, db_extra_search_path, max_rows, db_pool }`. Fields not present in the body MUST retain their existing values. On success the per-instance PostgREST container MUST be reloaded with the new env within 30 seconds, and the response MUST return the resulting full config (post-merge).

#### Auth (GoTrue) runtime config

- **FR-003**: System MUST expose `GET /v1/projects/<ref>/config/auth` returning the current GoTrue runtime config in the exact response shape of upstream Supabase's `/v1/projects/{ref}/config/auth` GET — every property in upstream's auth-config response schema MUST appear in the response, with the project's current value (or the upstream-documented default if not set). This includes at minimum: `site_url`, `uri_allow_list`, `jwt_exp`, `disable_signup`; all mailer fields (`mailer_autoconfirm`, `mailer_otp_exp`, `mailer_otp_length`, `smtp_max_frequency`, SMTP server settings); all SMS fields (`sms_otp_exp`, `sms_otp_length`, `sms_max_frequency`); MFA settings, password strength settings, session timeouts, rate-limit knobs; and for every OAuth provider wired in the per-instance `.env` template (`apple`, `azure`, `bitbucket`, `discord`, `facebook`, `figma`, `fly`, `github`, `gitlab`, `google`, `kakao`, `keycloak`, `linkedin`, `notion`, `slack`, `snapchat`, `spotify`, `twitch`, `twitter`, `workos`, `x`, `zoom`) the trio `external_<provider>_enabled`, `external_<provider>_client_id`, `external_<provider>_secret`. Any secret-typed field (OAuth client secrets, SMTP password, hook secrets) MUST be redacted in the GET response (e.g. `***` or omitted); plaintext secret values MUST NOT appear in any GET response.
- **FR-004**: System MUST expose `PATCH /v1/projects/<ref>/config/auth` accepting the full upstream `UpdateAuthConfigBody` shape (any subset thereof). Fields not present in the body MUST retain their existing values. Every accepted field MUST be persisted. Fields whose value is backed by an environment variable the per-instance template wires into the GoTrue container MUST take effect within 30 seconds via container reload. Fields whose value is not backed by per-instance infra selfbase ships (e.g. Cloud-only hooks, SAML SSO, Cloud-provided captcha) MUST be stored and returned on subsequent GET as-supplied but MAY NOT change container behavior; the gap is tracked as a separate follow-up issue. The PATCH response MUST return the resulting full config (post-merge).

  Secret round-trip rule: for any field GET redacts (OAuth `external_<provider>_secret`, SMTP password, hook secrets, and other secret-typed fields), if the value supplied in the PATCH body equals the redaction sentinel `***`, the existing persisted secret MUST be preserved unchanged — the sentinel is interpreted as "leave alone," not as the literal string `***`. This makes `GET → modify one field → PATCH full body` round-trips safe. A non-redacted plaintext value replaces the existing secret as usual. Applies to PATCH `/v1/projects/<ref>/config/auth` only (no secret fields exist in the postgrest config surface).

#### Validation

- **FR-005**: PATCH on either endpoint MUST reject the entire request 400 with per-field detail under `error.details` when any field is out of bounds, an unknown field is present, or an OAuth provider is being enabled without its required credentials already present. Numeric bounds MUST match the upstream Supabase Management API OpenAPI exactly: `max_rows` 0–1,000,000; `db_pool` 0–1,000 (nullable, `null` ⇒ auto-configured); `jwt_exp` 0–604,800; `mailer_otp_exp` and `sms_otp_exp` 0–2,147,483,647; `mailer_otp_length` 6–10; `password_min_length` 6–32,767; `smtp_max_frequency`, `sms_max_frequency`, `mfa_phone_max_frequency` 0–32,767. No partial writes occur — if any field fails validation, none are persisted.

#### Lifecycle behavior

- **FR-006**: A successful PATCH that triggers a container reload MUST NOT terminate existing authenticated user sessions. JWTs issued before the change MUST remain valid until their original `exp`. Only new sign-ins reflect new auth-config values; only new HTTP requests reflect new PostgREST values.
- **FR-007**: If the per-instance container fails to come up on the new config, the system MUST roll back the `.env` to the prior value, restart the container on the prior config, and return 500 with a diagnostic identifying the rejected field where possible. The persisted state and the GET response MUST agree at all times.

#### Cross-cutting

- **FR-008**: Both endpoints MUST authenticate via the existing PAT mechanism. RBAC MUST be enforced via four new actions added to `packages/shared/src/rbac.ts` mirroring upstream Supabase Management API FGA permissions: `data_api_config.read` (GET `/v1/projects/<ref>/postgrest`), `data_api_config.write` (PATCH `/v1/projects/<ref>/postgrest`), `auth_config.read` (GET `/v1/projects/<ref>/config/auth`), `auth_config.write` (PATCH `/v1/projects/<ref>/config/auth`). Callers lacking the required action MUST receive 403 with the standard error envelope.
- **FR-009**: Both endpoints MUST use the existing `/v1/*` structured error envelope (`{ error: { code, message, details? } }`) shipped with prior Management API features.
- **FR-010**: Every successful PATCH MUST emit one audit log entry capturing actor (user_id), project ref, endpoint, the set of fields changed, and old + new value for each changed field. Unchanged fields MUST NOT appear in the audit entry. No audit entry is emitted for GET, no-op PATCH, or rejected PATCH.
- **FR-011**: Each implemented endpoint MUST replace its current `501 not_implemented` response. No other `/v1/*` endpoint's behavior changes.

#### CLI compatibility verification

- **FR-012**: A `tests/cli-e2e/postgres-config-and-auth-config.sh` script MUST exercise the upstream `supabase` CLI binary against a live selfbase project covering: `postgres-config get`, `postgres-config update` (single-field and multi-field), `config get` (auth section), `config update --auth-*` (jwt expiry change), a rejected validation case, and a re-`get` that confirms the change persisted. Every invocation MUST exit 0 (or the expected non-zero for the validation case), and the script MUST assert the changed field appears in the post-update `get` output. Script follows the same shape as the existing `tests/cli-e2e/*.sh` scripts from features 003 and 006.
- **FR-013**: The script in FR-012 MUST declare the upstream `supabase` CLI version it was validated against (pinned in a comment at the top), so a future CLI upgrade that changes flag names or response parsing is caught by the test rather than silently passing.

### Key Entities

- **PostgREST config snapshot**: not a new persistent entity. Source of truth is the per-instance `.env` consumed by the PostgREST container. GET reads from `.env`; PATCH writes to `.env` and restarts the container. The Drizzle schema is unchanged for this surface.
- **Auth config snapshot**: same shape as above but against the GoTrue container's `.env`.
- **Audit log entry**: existing entity. This feature adds `event_type` values `mgmt_api.postgrest.update` and `mgmt_api.auth_config.update`. Schema for audit log itself is unchanged.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: After `supabase config update --project-ref <ref> --auth-jwt-expiry 86400` returns 200, a sign-in within 60 seconds issues a JWT whose `exp - iat` is 86400 ±60s.
- **SC-002**: After `supabase postgres-config update --project-ref <ref> --db-schema "public,app_v2"` returns 200, an HTTP request to a table in the newly added schema is served (not 404 for "schema not exposed") within 30 seconds.
- **SC-003**: 100% of PATCH requests that fail validation are rejected with a per-field error envelope and no `.env` write, no container restart, no audit log entry.
- **SC-004**: 100% of successful PATCH requests produce exactly one audit log entry that records actor, project ref, endpoint, and the field-level old/new diff sufficient to reconstruct the change.
- **SC-005**: For 100% of PATCH requests that trigger a container restart, every JWT issued before the PATCH remains accepted by the project's auth endpoint until its original `exp` (zero forced sign-outs).
- **SC-006**: For 100% of PATCH requests where the per-instance container refuses to start on the new config, the system rolls back to the prior `.env`, the container comes back on the prior config within 60 seconds, and the GET endpoint reflects the prior (not the rejected) config.
- **SC-007**: `supabase postgres-config get/update` and `supabase config get/update --auth-*` operate end-to-end against a fresh selfbase install with zero `not_implemented` errors.
- **SC-008**: Other Management API endpoints implemented in prior features (gen-types, secrets, functions, login/link) pass their existing integration tests unchanged.
- **SC-009**: `tests/cli-e2e/postgres-config-and-auth-config.sh` runs green against a fresh selfbase install and against the production VM, exercising both endpoints through the real upstream `supabase` CLI binary (not raw HTTP), with explicit assertions on every CLI exit code and on the persisted post-update config.

## Assumptions

- The upstream Supabase CLI's request/response shapes for `postgres-config` and `config --auth-*` are the source of truth; selfbase matches them where reasonable so the unmodified CLI works.
- Per-instance PostgREST and GoTrue containers already read their configuration from environment variables in `infra/supabase-template/`. Extending the set of fields is additive — no new container is introduced, no docker-compose template change beyond the existing env wiring.
- Container reload uses `docker-control` (`docker compose up -d <service>`) — the same mechanism already used by feature 003's secrets endpoint and feature 008's pooler reconciler. No new orchestration primitive is required.
- PAT authentication, the `/v1/*` error envelope, RBAC checks via `app.authorize`, and audit log emission are all reused unchanged from features 003 and 006.
- "Reload within 30 seconds" is the steady-state target on the production VM. On a fully busy host, container restart can take longer; the success criterion accepts that 30s is the typical observed time, not a hard SLA.
- No dashboard UI surface is added for these settings in this feature. CLI compatibility is the only deliverable. A dashboard panel can be added in a follow-up if demand exists.
- Existing sessions remain valid because GoTrue's JWT verification only requires the shared signing secret, which does not change across an `.env`-only edit. JWT-rotation scenarios (rotating the signing secret) are out of scope for this feature.
- The `supabase config update --auth-*` CLI command in current stable upstream maps to `PATCH /v1/projects/<ref>/config/auth`. If a future CLI version splits these into multiple endpoints, that's a follow-up.
