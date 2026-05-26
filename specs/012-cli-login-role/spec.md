# Feature Specification: CLI login-role — passwordless `supabase db push`

**Feature Branch**: `012-cli-login-role`

**Created**: 2026-05-25

**Status**: Draft

**Input**: Filed as [issue #31](https://github.com/kmhari/selfbase/issues/31). The `supabase` CLI commands that connect directly to a project's Postgres (`db push`, `db pull`, `db diff`, `migration list/fetch/repair`, `inspect db`) currently require an operator to supply the per-project Postgres superuser password on **every** invocation against selfbase — either as `--password <pw>` or via the `SUPABASE_DB_PASSWORD` env var. Against Supabase Cloud the same workflow runs without supplying any DB password after the initial `supabase login`, because the CLI calls a control-plane endpoint that creates (or re-uses) a small dedicated Postgres role on the per-project database, rotates that role's password to a fresh random value with a 5-minute expiry, and returns the role+password to the caller. Selfbase doesn't offer that endpoint today, so operators must paste, store, or leak the long-lived superuser password into shells, CI secrets, and editor processes — and worse, our own E2E test (`tests/cli-e2e/db-push.sh`) currently has to repeat the `--password` flag six times in a single script to keep the harness working.

The capability being requested by this feature is therefore behavioural parity with Cloud's CLI experience: an operator who has authenticated the CLI once with `supabase login` (whether via PAT paste or via the device-code flow shipped in feature 011) MUST be able to run any of the direct-PG CLI commands against a selfbase project they administer without ever supplying a database password. The long-lived per-project Postgres superuser password remains available to operators as an escape hatch (existing flag and env-var continue to work, with documented precedence rules), so this is a purely additive change for both selfbase and any third-party CLI client that mirrors the upstream flow.

## Clarifications

### Session 2026-05-25

- **Q: What TTL should the endpoint return for the rotating password? → A: 300 seconds (5 min).** Verified against the upstream `supabase/cli` source — the implementation literally writes `valid until now() + interval '5 minutes'` ([`internal/utils/flags/queries/role.sql`](https://github.com/supabase/cli/pull/3885/files), merged July 2025) and the upstream link tests assert `TtlSeconds: 300`. Long enough that a multi-statement migration finishes inside the window without needing a refresh; short enough that a leaked password expires well before an attacker can pivot. The upstream CLI does not refresh — it opens one connection and rides it for the operation — so the value must comfortably exceed the longest realistic single CLI operation.

- **Q: How is the Postgres role provisioned — random ephemeral role per call, or persistent fixed role with rotating password? → A: Persistent fixed role with rotating password.** Verified against upstream PR #3885 (`feat: password-less database login`, merged 2025-07-21). The actual SQL the endpoint runs is idempotent: it checks `pg_roles` for a role named `cli_login_postgres` (read-write) — and `cli_login_supabase_read_only_user` for read-only (research.md Decision 4) — creating it with `NOINHERIT LOGIN NOREPLICATION IN ROLE postgres` if absent. The role persists across all CLI sessions on a given project; only the password rotates. Each call to the endpoint runs `ALTER ROLE "..." WITH PASSWORD '<new_random>' VALID UNTIL now() + interval '5 minutes'`. Authentication ceases at the `VALID UNTIL` boundary regardless of whether the role row is still physically present. The CLI itself detects connecting usernames starting with the `cli_login_` prefix (constant `CLI_LOGIN_PREFIX` in upstream `internal/utils/connect.go:201`) and automatically runs `SET SESSION ROLE postgres` after connect to assume the day-to-day owner role's privileges — the connecting `cli_login_*` role itself has no inherent privileges (`NOINHERIT`), so privilege escalation happens at runtime via `SET ROLE` rather than at role-creation time. This pattern is dramatically simpler than minting per-call ephemeral roles: no background reaper needed (the role is intended to persist; the password's `VALID UNTIL` is the security boundary, enforced by Postgres itself), no role-name entropy needed (the name is deterministic and is not a secret), and the per-project Postgres only ever holds two CLI-related roles (read-write + read-only) no matter how many CLI commands an operator runs.

- **Q: What rate limit should the create endpoint apply? → A: 30 calls per minute, per PAT, per project.** Cloud's OpenAPI declares the `429 Rate limit exceeded` response shape but does not publish the exact ceiling, so selfbase picks its own. 30/min/PAT/project gives ~3–6× headroom over a typical parallel-CI migration job (5–10 concurrent operations against the same project); it is tight enough that a compromised PAT cannot rotate the `cli_login_*` password thousands of times per second to spray pg_authid; and it is per-project so a noisy script against project A does not starve project B. PAT (not IP) is the rate-limit subject because PAT identity is the actual security boundary — IP-based limits would either be too loose (shared NAT egress) or too strict (mobile networks).

- **Q: How should the create endpoint record each successful password rotation for operator audit/observability? → A: Structured log line via the existing api-container logger.** A single log event per successful rotation: `{event: 'cli_login_role_rotated', pat_id, project_ref, scope, requester_ip, at}`. Operators query it through whatever log pipeline they already use for other selfbase API events; no new DB table, no new dashboard UI, no growth-management story. Cloud's audit posture for this endpoint is opaque (not in any public artifact); selfbase opts for the lightest-touch consistent with how the rest of the api container already records PAT-authenticated actions.

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator runs `supabase db push` against selfbase with zero database password input (Priority: P1) MVP

A developer-operator with a freshly cloned project repository wants to push a new SQL migration to a selfbase project they own. They have already authenticated the CLI once (the PAT lives in `~/.supabase/access-token`). They have not memorised, stored, or pasted the project's Postgres password anywhere on the machine.

1. They run `supabase link --project-ref <ref>` once. The CLI uses only the bearer PAT — no `--password` flag, no `SUPABASE_DB_PASSWORD` env var, no interactive prompt for a database password. Behind the scenes, selfbase ensures the per-project Postgres has a `cli_login_postgres` role provisioned, rotates that role's password to a fresh random 5-min-expiring value, and returns the role + password to the CLI.
2. They run `supabase db push`. The CLI uses only the bearer PAT. Same exchange happens again (fresh password, same role). The CLI connects as `cli_login_postgres`, immediately runs `SET SESSION ROLE postgres`, and proceeds with the migration.
3. The migration is applied to the per-project Postgres. The CLI prints the same success output Cloud would print.
4. Every subsequent CLI invocation that needs a direct Postgres connection (`db pull`, `db diff`, `migration list`, `migration fetch`, `inspect db`) works the same way — bearer PAT is the only credential the operator supplies.

**Why this priority**: This IS the feature. Until this works, selfbase's CLI compatibility story has a permanent papercut for every developer migrating from Cloud, and our own automated test suite has to carry the long-lived superuser password through six different command invocations as test fixture. Closing this gap is what "CLI parity with Cloud" actually means in practice.

**Independent Test**: On a workstation with an empty `~/.supabase/access-token` and no environment variables containing the Postgres password, run `supabase login` (paste a fresh PAT) followed by `supabase link --project-ref <ref>` and `supabase db push --include-all` against a selfbase deployment. Confirm the migration succeeds and the migration row appears in `migration list`. No `--password` flag is passed at any point; no `SUPABASE_DB_PASSWORD` is set in the shell at any point; no interactive prompt asks for a database password. Inspect the per-project Postgres `pg_roles` view afterwards: a single `cli_login_postgres` role exists, regardless of how many CLI commands were run; its `rolvaliduntil` is in the past (within a few minutes of the last CLI invocation).

**Acceptance Scenarios**:

1. **Given** an operator has a valid selfbase PAT in `~/.supabase/access-token` and no Postgres password stored anywhere on the machine, **When** they run `supabase link --project-ref <ref>` followed by `supabase db push --include-all`, **Then** both commands complete successfully and the new migration row is visible at the per-project Postgres in `supabase_migrations.schema_migrations`.

2. **Given** an operator has just successfully run `supabase db push` with no password, **When** they immediately run `supabase db pull --schema public -f schema.sql`, **Then** the schema dump file is produced with the same content the per-project Postgres would emit to a `postgres`-owner session.

3. **Given** an operator has just successfully run `supabase db push` with no password, **When** they immediately run `supabase migration list`, **Then** the most recently pushed migration version appears in the output exactly as it would against Supabase Cloud.

4. **Given** the CLI has just completed a `db push`, **When** the operator inspects the per-project Postgres `pg_roles` view, **Then** exactly one `cli_login_postgres` role exists (regardless of how many prior CLI calls there were), and its `rolvaliduntil` timestamp is in the past (because the 5-minute window has elapsed and no recent call refreshed it). The push left no permanent privileged footprint — the role is unusable for authentication until the next endpoint call rotates its password.

5. **Given** an operator has done `supabase link --project-ref <wrong-ref>` against a project they do NOT administer (i.e., RBAC denies them), **When** they run `supabase db push`, **Then** the CLI exits non-zero with a clear authorization error and at no point does the selfbase backend mint or rotate a CLI role on the operator's behalf.

---

### User Story 2 — Existing operators who pass `--password` continue to work unchanged (Priority: P1)

An existing operator has scripts, CI pipelines, or muscle-memory built around passing `--password "$SELFBASE_DB_PASSWORD"` to every CLI command. They MUST NOT be forced to migrate to the new flow on day one.

1. They keep their existing `--password "$SELFBASE_DB_PASSWORD"` (or `SUPABASE_DB_PASSWORD` env var) flow.
2. Every command they were running before the feature continues to behave identically afterwards.
3. The selfbase backend never refuses to honour a direct connection that authenticates with the long-lived superuser password.
4. The new endpoint is never called by such invocations — the CLI's own resolution logic (`flag > env > endpoint > prompt`) short-circuits before the endpoint exchange.

**Why this priority**: A backwards-incompatible change to CLI authentication would break every operator's CI pipeline overnight. Cloud itself supports both flows simultaneously (long-lived password OR CLI-managed role); selfbase MUST do the same. Equal priority with US1 because shipping US1 without US2 is unacceptable.

**Independent Test**: Take any historical `tests/cli-e2e/db-push.sh` invocation from before this feature, re-run it against a deployment that has shipped the feature, and confirm every step still passes byte-identical to its pre-feature behaviour. Confirm via `pg_roles` inspection that no `cli_login_postgres` role was created on the per-project Postgres as a side effect.

**Acceptance Scenarios**:

1. **Given** the feature has been deployed to selfbase, **When** an operator runs the legacy flow (`supabase link --password "$PW"` then `supabase db push --password "$PW"` then `supabase migration list --password "$PW"` ...), **Then** every command completes successfully and the network-visible behaviour (which Postgres user is connected, which grants are exercised) is identical to the pre-feature behaviour.

2. **Given** an operator passes BOTH `--password` AND has a valid PAT, **When** the CLI connects to Postgres, **Then** the operator-supplied password is honoured (precedence: explicit flag > env var > CLI's automatic exchange), and the password-rotation endpoint is NOT called — so no `cli_login_postgres` role is provisioned or rotated as a side effect.

---

### User Story 3 — Operator restricts a CLI invocation to read-only data access (Priority: P2) *(DEFERRED — endpoint returns 501; see FR-004)*

An operator wants to run a read-only inspection command (e.g., `supabase db pull`, `supabase inspect db`) and wants the Postgres role used for that inspection to be denied write access at the database level — not just "the command is read-only by convention", but actually enforced by Postgres role grants. This matches Cloud's `read_only: true` option on the upstream login-role endpoint.

1. The CLI calls the endpoint with `read_only: true`.
2. Selfbase ensures a second persistent role exists on the per-project Postgres, granted `IN ROLE supabase_read_only_user` (which itself has `pg_read_all_data` + `BYPASSRLS` from the upstream `supabase/postgres` image's init scripts).
3. That role's password is rotated to a fresh random 5-min-expiring value and returned to the CLI.
4. The CLI connects as that role and auto-escalates to `supabase_read_only_user` via `SET SESSION ROLE supabase_read_only_user` (the existing upstream CLI does this when the username matches the `cli_login_` prefix).
5. The command completes successfully (reads work).
6. If the operator somehow caused the same connection to attempt a write within its TTL window, Postgres refuses the write with a permission error because the active role lacks INSERT/UPDATE/DELETE/CREATE.

**Why this priority**: Defense-in-depth. Today our long-lived superuser password gives the CLI full DDL power for every command, even when the command itself only reads. Shipping read-only enforcement at the role level is a meaningful posture improvement and matches Cloud's published API. Lower priority than US1/US2 because the immediate UX win (no password prompt) doesn't depend on it, but it's the strongest justification for not just "persisting the superuser password to the keyring" as the design.

**Independent Test**: From a shell with only a valid PAT, run `supabase db pull --schema public` against a selfbase project. While the command is running, capture the active Postgres connection's user and inspect what role it has switched to via `SET SESSION ROLE`. Confirm the active role is `supabase_read_only_user` (or an inherited role with equivalent grants). After the command finishes, attempt to manually open a Postgres connection using the same role+password the CLI was just observed using; if the connection still works (TTL not yet expired), attempt a `CREATE TABLE` and confirm it is refused with a permission error.

**Acceptance Scenarios**:

1. **Given** the CLI calls the endpoint with `read_only: true`, **When** the connection's effective role is inspected in Postgres while the CLI command is running, **Then** the active role is `supabase_read_only_user` (or equivalent), which has SELECT + BYPASSRLS but no write/DDL grants.

2. **Given** a read-only CLI command is in progress, **When** anything (operator-side or a bug in the CLI) attempts a write through the same connection, **Then** the write is refused by Postgres with permission error code 42501 and the row is not modified.

---

### Edge Cases

- **Operator's PAT is valid but RBAC denies them direct-Postgres access on this project**: the endpoint MUST fail closed (no role provisioned or rotated, no Postgres connection opened on their behalf) and the CLI MUST surface a clear authorization error that does not leak any hint about the project's existence beyond what the PAT-holder already knows.

- **Operator's PAT has been revoked between `supabase login` and `supabase db push`**: the endpoint MUST fail with the same authentication error shape the upstream CLI already understands so its existing retry/re-login logic kicks in unchanged.

- **The per-project Postgres is unreachable, stopped, or being provisioned**: the endpoint MUST fail with a distinct error class (different from "rotation failed") so the CLI can surface a useful operator-facing message ("project not running" vs "permission denied").

- **Two CLI processes for the same operator race on `supabase db push` at the same instant**: both calls hit the endpoint, both `ALTER ROLE` statements run, only the second-written password remains valid in `pg_authid` (Postgres stores one password per role). The first CLI process attempting to authenticate with its now-stale password will receive a SCRAM auth failure; the upstream CLI's existing backoff/retry logic in `initPoolerLogin` (visible at `internal/utils/flags/db_url.go:198`) handles this transient case. The race window is sub-second in practice and converges within one or two retries.

- **An operator's machine clock is wrong**: the password's expiry is enforced server-side (by Postgres `VALID UNTIL` plus the absolute timestamp the endpoint set), so client clock skew does not let an attacker extend the password's lifetime.

- **An operator passes BOTH `--password` AND has a valid PAT**: the explicit `--password` wins; the endpoint is never called; no `cli_login_*` role is provisioned or rotated as a side effect (the upstream CLI's resolution logic in `NewDbConfigWithPassword` short-circuits before the endpoint call).

- **A project is deleted while a `cli_login_*` role is still present in its Postgres**: the project-teardown path (existing selfbase logic that drops the per-project Postgres data directory) reclaims the role implicitly. No special handling needed because the entire database is gone.

- **An operator manually drops the `cli_login_postgres` role from the per-project Postgres**: the next endpoint call re-creates it (the SQL is idempotent — `IF NOT EXISTS` on `pg_roles`). The next CLI command works without operator intervention beyond that single endpoint call.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: Selfbase MUST expose a control-plane endpoint that an authenticated CLI client can invoke (using only its bearer PAT) to obtain a project-scoped pair of `(postgres_role, postgres_password)` plus a `ttl_seconds` integer. The endpoint's request body, response body, status codes, and OAuth scope MUST match the shape the upstream `supabase` CLI already speaks (`POST /v1/projects/{ref}/cli/login-role`, body `{ read_only: boolean }`, response `{ role, password, ttl_seconds }`) so the existing CLI binary works without modification. The `role` field is a deterministic, per-project, per-scope name (`cli_login_postgres` for read-write; a stable analogue for read-only); it is reused across all CLI invocations and is not a secret.

- **FR-002**: Selfbase MUST also expose the matching delete endpoint at the **same path as the create endpoint, distinguished by HTTP method** (`DELETE /v1/projects/{ref}/cli/login-role` — singular; verified against `api.supabase.com/api/v1-json`, which mounts `v1-create-login-role` (POST) and `v1-delete-login-roles` (DELETE) on the same path object). It invalidates the password of the calling project's CLI roles immediately (by setting `VALID UNTIL` to the past, or equivalent), so an operator who wants to lock out CLI access mid-window can do so via the CLI's own DELETE call without waiting for the 5-minute timer.

- **FR-003**: On each successful call to the create endpoint, selfbase MUST ensure the relevant `cli_login_*` role exists on the per-project Postgres (creating it idempotently if absent with `NOINHERIT LOGIN NOREPLICATION` + `IN ROLE` linked to the appropriate target role) and MUST rotate that role's password to a fresh random value with `VALID UNTIL now() + 5 minutes`. Authentication MUST be refused by Postgres itself (via the `VALID UNTIL` mechanism in `pg_authid`) after that 5-minute window elapses, regardless of whether the role row is still physically present.

- **FR-004** *(deferred in initial shipping — returns HTTP 501)*: When the client requests `read_only: true`, the endpoint currently returns `501 not_implemented` with `details.reason = "read_only_scope_reserved_by_supautils"`. Two structural blockers prevent a clean implementation in this PR: (1) Postgres' `supautils` extension reserves membership in `supabase_read_only_user` (only the true superuser `supabase_admin` can grant it, but the api container connects as `postgres`); (2) the upstream CLI's `AfterConnect` callback hardcodes `SET SESSION ROLE postgres` for any `cli_login_*` username, defeating any RO scope. The upstream `supabase` CLI hardcodes `ReadOnly: false` in `initLoginRole` so no normal CLI invocation hits this path. Follow-up scope. See [docs/changes/012-cli-login-role.md](../../docs/changes/012-cli-login-role.md) for the technical rationale.

- **FR-005**: When the client requests `read_only: false`, the role returned MUST be granted `IN ROLE postgres` (the day-to-day project owner role, the same role operators connect as today with `--password`). The upstream CLI's auto-`SET SESSION ROLE postgres` post-connect handler MUST cause the connection to operate with `postgres`-owner privileges, which is precisely the privilege envelope `--password` already gives today — no privilege expansion versus the status quo.

- **FR-006**: The endpoint MUST authenticate the caller using the existing PAT bearer scheme that selfbase already serves under `/v1/*`, MUST require an RBAC permission equivalent to write access on the project's database (so PAT-holders who can only read project metadata cannot mint write-capable role passwords), and MUST surface authentication and authorization failures with the same response shape the upstream CLI's error handler already understands.

- **FR-007**: The rotated password returned by the endpoint MUST be unguessable by external parties (sufficient entropy that a brute-force attempt against the per-project Postgres exposed on `db.<ref>.<apex>:5432` is computationally infeasible within the 5-minute TTL window). The role name itself is not a secret and does not require entropy.

- **FR-008**: When a project is deleted, the existing project-teardown path reclaims any `cli_login_*` roles implicitly because the per-project Postgres is gone. No separate background reaper is needed under steady-state operation — the password's `VALID UNTIL` is the only authentication-relevant boundary, and it is enforced by Postgres itself without any control-plane involvement.

- **FR-009**: When an operator explicitly provides `--password` to the CLI (or sets `SUPABASE_DB_PASSWORD`), the CLI's own resolution logic causes it to NOT call the new endpoint. Selfbase MUST NOT regress this behaviour: it MUST NOT refuse direct Postgres connections that authenticate with the long-lived per-project superuser password, and MUST NOT force-rotate `cli_login_*` passwords when the CLI doesn't ask for one.

- **FR-010**: The endpoint's network-visible behaviour (response shape, status codes, OAuth scope advertised in `WWW-Authenticate` on 401, presence of `429` for rate-limiting) MUST be close enough to Cloud's that the upstream CLI binary's existing telemetry, error formatting, and retry logic require no awareness of which backend they're talking to. Specifically, the endpoint MUST rate-limit at **30 calls per minute, per PAT, per project**, returning HTTP 429 with the same response envelope the CLI already understands when the limit is exceeded. Any deliberate divergence from Cloud's behaviour MUST be documented as such.

- **FR-011**: The CLI's existing `tests/cli-e2e/db-push.sh` test MUST be restructured to run the full 8-step push/pull/diff/migration-list/inspect/cleanup script TWICE against the same project — once with `--password "$SELFBASE_DB_PASSWORD"` passed to every command (current behaviour, regression guard for US2) and once with `--password` dropped from every command and `SUPABASE_DB_PASSWORD` unset (US1's new path). Both passes MUST exit zero in CI for the feature to ship. The password-less pass MUST also verify (via psql inspection after the script) that exactly one `cli_login_postgres` role exists with an expired `rolvaliduntil`, confirming the rotation pattern.

- **FR-012**: Operator documentation MUST be updated to (a) describe the new automatic flow as the default, (b) document the precedence rules between `--password`, `SUPABASE_DB_PASSWORD`, and the new endpoint, (c) describe how an operator can manually expire CLI access via the DELETE endpoint or by directly `ALTER ROLE`-ing the password in an emergency, and (d) describe the security posture trade-off versus distributing the long-lived per-project superuser password — short version: the CLI role's password rotates every call, is valid for at most 5 minutes, and is never persisted on the operator's machine.

- **FR-013**: On each successful password rotation, the api container MUST emit a structured log event of shape `{event: 'cli_login_role_rotated', pat_id, project_ref, scope, requester_ip, at}` through the existing api-container logger. The log MUST be sufficient to answer "which PAT touched which project's CLI role at what time" without requiring operators to query the per-project Postgres. No new control-plane table is introduced for this audit trail (operators rely on the existing log-pipeline tooling); future dashboard surfacing of this audit is out of scope.

### Key Entities *(include if feature involves data)*

- **Persistent CLI auth role** (`cli_login_postgres` for read-write; analogous deterministic name for read-only): A long-lived per-project Postgres role with `NOINHERIT LOGIN NOREPLICATION` and `IN ROLE <target>` (where target is `postgres` for write or `supabase_read_only_user` for read-only). Created idempotently the first time the create endpoint is called for a given project + scope; persists thereafter. Attributes that vary across calls: only the password (rotated every call) and `rolvaliduntil` (refreshed to `now() + 5 min` every call). Privilege envelope at rest: none — the role inherits nothing, has no grants. Privilege envelope at runtime: whatever the connecting CLI client switches to via `SET SESSION ROLE`. Lifecycle: created on first endpoint call, persists until project deletion. Source of truth: `pg_authid` on the per-project Postgres; no control-plane row.

- **PAT-to-role authorization decision**: A point-in-time RBAC check: "is this PAT allowed to trigger a password rotation on the project's CLI roles?". Inputs: PAT identity, project ref, requested scope (read-only vs read-write). Output: allow / deny. No persistent storage; computed from the existing RBAC matrix in `packages/shared/src/rbac.ts` plus the existing PAT-to-user-to-project ownership chain.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator with only a valid PAT on their machine (no Postgres password anywhere) can complete the full Cloud-equivalent workflow against selfbase — `supabase login` → `supabase link` → `supabase db push` → `supabase migration list` — without any of those commands prompting for, accepting, or requiring a database password. Verified by `tests/cli-e2e/db-push.sh` Pass B (the password-less pass) exiting zero in CI.

- **SC-002**: Operators with existing scripts that pass `--password` on every command see exactly zero behavioural change after the feature is deployed. Verified by `tests/cli-e2e/db-push.sh` Pass A (the legacy pass) exiting zero in CI byte-identical to its pre-feature behaviour, AND verified by post-run inspection of `pg_roles` showing zero `cli_login_*` roles were created during the legacy pass (the endpoint was never called).

- **SC-003**: After the password-less E2E pass completes, the per-project Postgres has exactly one `cli_login_postgres` role (or two if the read-only path was exercised). Its `rolvaliduntil` is in the past (last call's 5-minute window has elapsed). The role has no inherent grants and is unusable for authentication until the next endpoint call rotates its password. Verified by an automated `psql` check appended to the E2E test.

- **SC-004**: A read-only CLI command's connection to Postgres is refused by Postgres if it attempts a write — verified by an integration test that calls the endpoint with `read_only: true`, manually opens a connection with the returned creds, runs `SET SESSION ROLE supabase_read_only_user`, and confirms `CREATE TABLE` is refused with permission error code 42501.

- **SC-005**: An attacker who observes the public selfbase API surface (i.e., knows the apex, can list projects with no PAT) cannot, with feasible effort within the 5-minute password TTL window, brute-force a valid password for a `cli_login_*` role on the `db.<ref>.<apex>:5432` endpoint. Verified by entropy analysis of the password generator (target: ≥128 bits of entropy in the returned password).

- **SC-006**: Selfbase's operator-facing dashboard or CLI does not need any new credential-management UI for this feature — operators continue to manage only the per-project Postgres superuser password (already exposed) and PATs (already exposed). No new "CLI tokens" surface is added by this feature.

- **SC-007**: The feature does not regress any currently shipped `supabase migration *` subcommand's behaviour. Specifically:
  - **Control-plane-touching commands** (`migration list`, `migration fetch`, `migration repair --status applied|reverted`) — buildable verification required in both flows. Verified by extending `tests/cli-e2e/db-push.sh` to exercise `migration list` + `migration fetch` + `migration repair` round-trip in both Pass A (legacy `--password`) and Pass B (password-less). Wire-level behaviour against the control-plane API MUST be unchanged in Pass A.
  - **`migration up`** — already a thin wrapper around `db push` (per feature 006's research); covered transitively by the existing `db push` step of `db-push.sh` in both passes.
  - **Pure-local commands** (`migration new`, `migration squash`, `migration down`) — do not touch selfbase at all (they operate on local files or the local `supabase start` DB), so this feature is inherently incapable of regressing them. No buildable verification needed.

## Assumptions

- Operators authenticate the CLI with a PAT that selfbase mints (either via `supabase login --token` pasted from the dashboard, or via the device-code flow shipped in feature 011). PATs continue to be the only client-side credential needed for HTTPS to the control plane; this feature does not introduce any new client-side credential type.

- The per-project Postgres is reachable from the selfbase control-plane API container (already true today — `per-instance-pg.ts` connects there for migrations and pg-meta forwarding). No new network paths are required.

- The upstream `supabase` CLI binary's existing logic for resolving the database password (env var → flag → call `cli/login-role` endpoint → prompt interactively) is the source of truth for client-side behaviour. The CLI also already handles the post-connect `SET SESSION ROLE` step automatically when it detects a username with the `cli_login_` prefix (constant `CLI_LOGIN_PREFIX` in upstream `internal/utils/connect.go:201`). Selfbase's job is to make the `cli/login-role` step return a valid `(role, password, ttl_seconds)` triple; we do not modify, fork, or wrap the upstream CLI.

- The `supabase_read_only_user` role (used for `read_only: true`) and the `postgres` role (used for `read_only: false`) both already exist on every selfbase per-instance Postgres because they are shipped by the upstream `supabase/postgres` image in `migrations/db/init-scripts/00000000000000-initial-schema.sql` and `00000000000003-post-setup.sql`. This feature does not need to provision either of them.

- The new RBAC permission gating who can trigger password rotation maps to the same set of users who can today reset the per-project Postgres password — i.e., project owners. Read-only rotation may be permitted to a broader set in a follow-up; this feature does not need to invent a new permission tier.

- The CLI's `supabase link` command uses the same `NewDbConfigWithPassword` resolution path as `db push`. Once the new endpoint exists, `supabase link` becomes password-less automatically as a side effect — operators can run `supabase link --project-ref <ref>` with no `--password` flag and no `SUPABASE_DB_PASSWORD` env var, and the CLI will obtain the DB credentials via the new endpoint exactly as it does for `db push`. This feature does not address `link`'s UX separately because there is nothing separate to address.

- Spec 011 (CLI device-code login, recently merged) is a prerequisite for the Cloud-equivalent UX claim in US1 — without 011 the operator has to manually paste a PAT first. This feature does not depend on 011 at the implementation level (an operator who pastes a PAT manually still benefits), but the marketing claim "works like Cloud out of the box" needs both.

- Features 004 (wildcard TLS) and 005 (Postgres public endpoint) are already in production, so `db.<ref>.<apex>:5432` is the address the CLI will use after the exchange. This feature does not introduce any new network listener.

- Selfbase's top-level Supavisor pooler (`pooler.<apex>:6543`) authenticates against the per-project Postgres on demand, so a freshly rotated password becomes usable through the pooler without explicit cache invalidation. Any sub-second propagation lag is absorbed by the CLI's existing retry/backoff (see Edge Cases — concurrent-race section for the same mechanism in a different framing).
