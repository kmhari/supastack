# Feature Specification: Supabase CLI Management API — Tier 1 surface

**Feature Branch**: `006-cli-mgmt-tier1`

**Created**: 2026-05-23

**Status**: Draft

**Input**: User description: "push it and pick up issue #4" — picks up GitHub issue #4 (Expand Management API to support more Supabase CLI commands, P1 surface), specifically the Tier 1 endpoint group.

## Background

selfbase already implements the P0 subset of Supabase's Management API (shipped in feature 003): the endpoints the upstream Supabase CLI calls for `supabase login`, `supabase link`, `supabase functions deploy/list/download/delete`, and `supabase secrets set/list/unset`. Every other `/v1/*` route currently returns a structured `501 not_implemented` envelope.

GitHub issue #4 ranks the next wave of Supabase CLI commands by user demand. **Tier 1** comprises four endpoint groups that map to four CLI commands real users will reach for next, in order:

1. `supabase gen types typescript --project-id <ref>` — every Next.js/SvelteKit/etc. project that uses Supabase calls this in its build step.
2. `supabase domains create/get/delete/reverify` — custom hostname per project, with DNS verification.
3. `supabase postgres-config get/update` and `supabase auth-config get/update` — runtime PostgREST + GoTrue knobs.
4. `supabase ssl-enforcement get/update` — toggle whether the per-instance Postgres requires SSL.

Out of scope for this feature: branches (separate parent spec), all Tier-3 cloud-only endpoints, and any new dashboard UI for these settings.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Generate TypeScript types for a project (Priority: P1)

A developer is wiring up a TypeScript app against their self-hosted Supabase project. They want fully typed table/column access without hand-writing interfaces. They run `supabase gen types typescript --project-id <ref> --schema public > database.types.ts` from their project root, pointing the CLI at their selfbase instance, and get a TypeScript source file containing exact types for every table, view, enum, and function in the selected schema(s) — identical in shape to what Supabase Cloud emits, so the rest of the Supabase JS SDK type ergonomics work unchanged.

**Why this priority**: Highest user demand among all Tier 1 endpoints. Without it, every TypeScript-based Supabase project on selfbase loses static type safety on table access — a major regression from the Cloud experience.

**Independent Test**: Run `supabase gen types typescript --project-id <existing-ref>` against the test VM. Result must (a) exit 0, (b) emit valid TypeScript that compiles when fed to `tsc --noEmit`, (c) include a `Database` type whose `public` schema lists all user tables of that project.

**Acceptance Scenarios**:

1. **Given** a project exists with at least one user-defined table in `public`, **When** the CLI generates types, **Then** the emitted file declares that table under `Database.public.Tables.<tableName>` with the correct columns, types, nullability, and insert/update variants.
2. **Given** the developer passes `--schema public --schema auth`, **When** types are generated, **Then** both schemas appear in the emitted file under `Database.<schema>`.
3. **Given** an invalid project ref, **When** the CLI requests types, **Then** the response is a 404 with the standard error envelope and the CLI exits non-zero with a helpful message.
4. **Given** the requester is unauthenticated, **When** the endpoint is called without a valid PAT, **Then** the response is 401.

---

### User Story 2 — Attach a custom domain to a project (Priority: P2)

A team wants their project reachable at `api.acme.com` instead of `<ref>.<apex>`. They run `supabase domains create --project-ref <ref> --custom-hostname api.acme.com`, get back a TXT record to add at their DNS provider, add it, run `supabase domains reverify`, and within a few seconds their project's REST/auth/storage/realtime/edge-function endpoints are all reachable at `https://api.acme.com/...`. Later they can `supabase domains delete` to detach.

**Why this priority**: Major UX win — without custom domains, users either expose the raw `.<apex>` URL to their app's clients or run their own reverse proxy. It's also the highest-effort Tier 1 endpoint (DNS verification flow + Caddy host route generation), so worth shipping as its own slice.

**Independent Test**: From a developer machine, run the four `supabase domains *` subcommands end to end against a project with a real DNS-controlled domain. Result must: (a) accept the create, (b) display a TXT challenge, (c) after the challenge is satisfied, return verified=true on get/reverify, (d) make the project routable at the custom hostname with a valid TLS cert, (e) delete cleanly.

**Acceptance Scenarios**:

1. **Given** a project with no custom domain, **When** the developer creates a custom hostname, **Then** the response includes the hostname, an `unverified` status, and a TXT record value the user can add at their DNS provider.
2. **Given** the developer has added the required TXT record, **When** they call reverify, **Then** the response transitions to `verified` and the project becomes reachable at the custom hostname over HTTPS within 60 seconds.
3. **Given** the TXT record is missing or wrong, **When** reverify is called, **Then** the response stays `unverified` with a diagnostic detail (which value was found vs expected).
4. **Given** a verified custom hostname, **When** the developer calls delete, **Then** the hostname stops resolving to the project within 60 seconds and the TLS cert is no longer served for that name.
5. **Given** two different projects try to attach the same custom hostname, **When** the second create is attempted, **Then** the response is a 409 conflict.

---

### User Story 3 — Get and update PostgREST / GoTrue runtime config (Priority: P2)

An operator notices their PostgREST is missing access to a custom schema, or wants to extend JWT expiry from the default 1 hour to 24 hours. They run `supabase postgres-config update --project-ref <ref> --statement-timeout 60s` or use the equivalent `--auth-jwt-expiry 86400` invocation. The change persists, the affected per-instance container picks it up within a few seconds, and the new behavior is observable on the next API call.

**Why this priority**: Lower demand than gen-types (most projects keep defaults), but blocks legitimate "we need to expose this extra schema" / "our sessions are too short" requests. Cheap to implement — the per-instance .env file already drives both containers.

**Independent Test**: Run `supabase postgres-config get` followed by `update` and re-`get`. Verify the field changed in the response and verify the change actually took effect by exercising the corresponding REST/auth behavior (e.g., a JWT issued after the update reflects the new expiry).

**Acceptance Scenarios**:

1. **Given** a project with default PostgREST config, **When** the operator GETs the config, **Then** the response contains all PostgREST settings supported by the upstream CLI (db_schema, db_extra_search_path, max_rows, etc.) with their current values.
2. **Given** the operator PATCHes the PostgREST config with new values for a subset of fields, **When** the next GET runs, **Then** the changed fields show the new values and unchanged fields retain their previous values.
3. **Given** an auth-config PATCH that sets jwt_exp to 86400, **When** a user signs in after the change takes effect, **Then** the issued JWT's expiry is approximately 86400 seconds in the future (±60s tolerance for container restart).
4. **Given** an invalid value (e.g., negative max_rows, jwt_exp below the minimum), **When** PATCH is called, **Then** the response is a 400 with a field-level validation error.

---

### User Story 4 — Toggle SSL enforcement on the per-instance Postgres (Priority: P3)

A security-conscious operator wants to require SSL on every direct Postgres connection to their project. They run `supabase ssl-enforcement update --project-ref <ref> --enabled true`. Subsequent attempts to connect with `sslmode=disable` are rejected; `sslmode=require` continues to work.

**Why this priority**: Real but narrow use case — most users will leave the default. Cheap to implement (a single ALTER SYSTEM + reload). Included in Tier 1 because issue #4 explicitly lists it and bundling it now avoids a separate spec for one small endpoint.

**Independent Test**: Toggle on, attempt `psql ... sslmode=disable` → must fail. Attempt `sslmode=require` → must succeed. Toggle off, both must succeed.

**Acceptance Scenarios**:

1. **Given** SSL enforcement is disabled (default), **When** the operator GETs the setting, **Then** the response shows `enforced: false`.
2. **Given** the operator PUTs `enforced: true`, **When** the next GET runs, **Then** the response shows `enforced: true`.
3. **Given** SSL enforcement is enabled, **When** a client tries to connect with `sslmode=disable`, **Then** the connection is refused with an SSL-required error.
4. **Given** SSL enforcement is enabled, **When** the same client retries with `sslmode=require`, **Then** the connection succeeds.

---

### Edge Cases

- **gen-types with no user tables**: must still emit a valid `Database` type (empty `public.Tables`) rather than a syntax-broken file.
- **gen-types schema not present**: requesting `--schema fakeschema` returns 400 with `{ schema: "not found" }`, not a 500.
- **gen-types against a paused project**: returns 409 with `project_not_running`. CLI should retry once the project is resumed.
- **domains with a wildcard hostname**: explicitly rejected (out of scope for v1 — wildcards make TLS issuance materially harder).
- **domains where DNS is hijacked mid-flight** (TXT verified, then removed): scheduled reverification should detect within 24h and flip status back to `unverified` without removing the route immediately, surfacing a warning on dashboard.
- **postgres-config setting an unknown field**: returns 400 with `unknown_field`, not silently dropped.
- **auth-config change that triggers GoTrue restart**: existing authenticated sessions must remain valid (no forced sign-out), only new sign-ins reflect the new config.
- **ssl-enforcement during an active session**: existing connections are not killed; the change applies to new connections only.

## Requirements *(mandatory)*

### Functional Requirements

#### Gen types

- **FR-001**: System MUST expose `GET /v1/projects/<ref>/types/typescript` returning a JSON envelope `{ types: <string> }` whose `types` value is a TypeScript source representation of the project's schema, byte-compatible with what Supabase Cloud's same endpoint returns for the same schema shape.
- **FR-002**: The endpoint MUST accept an optional repeatable `schemas` query parameter (`?schemas=public&schemas=auth`); when omitted, default to `public` only — matching upstream CLI default.
- **FR-003**: The endpoint MUST require a valid Personal Access Token (same auth as existing P0 endpoints), and MUST reject requests for refs the PAT's owner does not have access to with a 403.
- **FR-004**: System MUST return 404 for unknown refs and 409 for refs whose project is not `running`, with the standard error envelope.

#### Custom hostname

- **FR-005**: System MUST expose `GET /v1/projects/<ref>/custom-hostname` returning the current custom hostname (if any), verification status, the TXT record name + value the user needs to add, observed DNS state, and TLS cert status.
- **FR-006**: System MUST expose `POST /v1/projects/<ref>/custom-hostname` (creates or replaces) accepting `{ custom_hostname }`; on success returns the same shape as GET with `verification_status: 'pending'`.
- **FR-007**: System MUST expose `POST /v1/projects/<ref>/custom-hostname/reverify` which actively re-queries DNS and returns the latest status.
- **FR-008**: System MUST expose `DELETE /v1/projects/<ref>/custom-hostname` which removes the route, releases the TLS cert, and detaches the hostname.
- **FR-009**: When verification succeeds, the system MUST add a route in the HTTP reverse proxy so requests to the custom hostname reach the same per-instance Kong as the default `<ref>.<apex>` route, with a valid TLS cert issued automatically within 60 seconds of verification.
- **FR-010**: The system MUST reject attempts by a second project to claim a hostname already attached to another project, with a 409 conflict.
- **FR-011**: A background reverification job MUST run at least daily for every verified custom hostname; if the required TXT record disappears for >24h, the system MUST set verification_status back to `unverified` and surface the change in audit logs without immediately tearing down the route.

#### Postgres / Auth config

- **FR-012**: System MUST expose `GET /v1/projects/<ref>/postgrest` returning the current PostgREST runtime config: `db_schema`, `db_extra_search_path`, `max_rows`, `db_pool` — matching the upstream Cloud response shape.
- **FR-013**: System MUST expose `PATCH /v1/projects/<ref>/postgrest` accepting any subset of the same fields and persisting them to the per-instance PostgREST container's environment, with the container reloaded within 30 seconds.
- **FR-014**: System MUST expose `GET /v1/projects/<ref>/config/auth` returning the current GoTrue runtime config: `site_url`, `uri_allow_list`, `jwt_exp`, `disable_signup`, `external_email_enabled`, `external_phone_enabled`, `mailer_autoconfirm`, `mailer_otp_exp`, `sms_otp_exp` (and the small set of equivalent OAuth provider toggles the CLI surfaces by default).
- **FR-015**: System MUST expose `PATCH /v1/projects/<ref>/config/auth` accepting any subset of the same fields; the change MUST take effect (new sign-ins, new emails sent) within 30 seconds of acknowledgement.
- **FR-016**: Validation MUST reject negative numbers, JWT expiries shorter than 60s or longer than 30 days, and unknown fields, with 400 + per-field detail.
- **FR-017**: Existing authenticated sessions MUST remain valid across a config change that triggers a container restart (no forced sign-outs).

#### SSL enforcement

- **FR-018**: System MUST expose `GET /v1/projects/<ref>/ssl-enforcement` returning `{ current_config: { database: { enforced: boolean } }, applied_successfully: boolean }` — matching upstream Cloud shape.
- **FR-019**: System MUST expose `PUT /v1/projects/<ref>/ssl-enforcement` accepting `{ requested_config: { database: { enforced: boolean } } }` and applying it to the per-instance Postgres within 10 seconds.
- **FR-020**: When `enforced: true`, the per-instance Postgres MUST reject any TCP connection that does not negotiate SSL during STARTTLS, with the standard PG `SSL is required` error; connections that do negotiate SSL MUST continue to succeed.
- **FR-021**: Toggling SSL enforcement MUST NOT terminate existing connections; the change applies to new connections only.

#### Cross-cutting (all endpoints in this feature)

- **FR-022**: All four endpoint groups MUST authenticate via the existing PAT mechanism shipped in feature 003. No new auth surface is introduced.
- **FR-023**: All four endpoint groups MUST use the existing structured error envelope (`{ error: { code, message, details? } }`) and HTTP status conventions already in use across `/v1/*`.
- **FR-024**: All four endpoint groups MUST emit an audit log entry on every write (create/update/delete/patch/put), capturing actor (user_id), project ref, endpoint, old + new value (or a diff for large objects).
- **FR-025**: Each implemented endpoint MUST replace its previous `501 not_implemented` response. Endpoints outside the scope of this feature MUST continue to return `501 not_implemented`.

### Key Entities

- **Custom hostname**: a row keyed by project ref, holding `custom_hostname`, `verification_status` (pending/verified/unverified), `expected_txt_record_value`, `last_verified_at`, `last_verification_attempt_at`, `last_verification_error`, `created_at`, `updated_at`. There is at most one custom hostname per project; globally, a hostname can be attached to at most one project.
- **Project config snapshot**: not a separate entity; PostgREST + GoTrue config lives in the per-instance `.env`, and SSL enforcement lives in the per-instance `postgresql.conf`. These are read on GET and written + reloaded on PATCH/PUT.
- **Audit log entry**: existing entity from feature 003; this feature adds new `event_type` values for `mgmt_api.custom_hostname.*`, `mgmt_api.postgrest.*`, `mgmt_api.auth_config.*`, `mgmt_api.ssl_enforcement.*`.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: `supabase gen types typescript --project-id <ref>` against a selfbase instance completes in under 10 seconds for a project with up to 100 tables, and the emitted file passes `tsc --noEmit` with no errors against the official `@supabase/supabase-js` peer types.
- **SC-002**: For 100% of selected schemas/tables, the emitted types match the actual DB shape verified by automated comparison against `information_schema`.
- **SC-003**: A custom hostname goes from `supabase domains create` to fully reachable over HTTPS within 60 seconds of the user adding the correct TXT record (measured from successful reverify to first 200 response at the custom hostname).
- **SC-004**: For 100% of write operations across the four endpoint groups, an audit log entry is recorded that allows reconstructing who changed what when.
- **SC-005**: After `supabase postgres-config update` or `supabase auth-config update` returns 200, the new config is observable in container behavior within 30 seconds.
- **SC-006**: After `supabase ssl-enforcement update --enabled true` returns 200, all new direct-Postgres connections without SSL are rejected within 10 seconds. Existing connections are not interrupted.
- **SC-007**: All four CLI commands listed in Background are operable end-to-end against a fresh selfbase install with zero `not_implemented` errors.
- **SC-008**: Existing P0 CLI commands (`login`, `link`, `functions *`, `secrets *`) continue to pass their existing integration tests with zero regressions.

## Assumptions

- The upstream Supabase CLI's request/response shapes for these endpoints are the source of truth — selfbase matches them byte-for-byte where reasonable so the CLI doesn't need a selfbase-specific build. Where shapes have changed across CLI versions, we target the current stable CLI release at feature start.
- Custom-hostname TLS issuance reuses the same ACME machinery shipped in features 004 (wildcard via DNS-01) + 005 Phase 7 (per-project via HTTP-01). No new cert flow is introduced — custom hostnames use HTTP-01 just like per-instance `db.<ref>.<apex>` does.
- The per-instance PostgREST + GoTrue containers already read their config from environment variables and respond to a container reload (this is how feature 003's secrets endpoint already works). Extending to additional fields is purely additive.
- SSL enforcement is a per-instance Postgres setting (`ssl = on` already; we add `pg_hba.conf` host-line `hostssl` enforcement). The per-instance Postgres is already TLS-capable via the wildcard cert shared by the entire instance stack.
- Existing PAT auth, RBAC ownership checks, and the rate-limit envelope from feature 003 are reused unchanged — this feature does not introduce a new auth or rate-limit surface.
- The dashboard UI for these settings is explicitly out of scope. CLI compatibility is the primary deliverable; a dashboard surface follows in a separate effort (issue #8-style follow-up could group it with the pooler health panel).
- DNS reverification for custom hostnames uses simple A/CNAME + TXT lookups against the system resolver. Operators behind split-horizon DNS may see false negatives — out of scope for v1.
