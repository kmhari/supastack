# Feature Specification: db query + db dump endpoints

**Feature Branch**: `013-db-query-dump`

**Created**: 2026-05-26

**Status**: Draft

## Clarifications

### Session 2026-05-26

- Q: How should multi-statement queries (`SELECT 1; SELECT 2;`) be handled? → A: **Reject with 400 `multi_statement_not_supported`.** Matches upstream Cloud's behavior; predictable error beats silent "first wins" / "last wins" confusion. Operators wrap in a function or split client-side.
- Q: What's the default schema list for `db dump`? → A: **All non-internal schemas** (public, auth, storage, realtime, etc.) — skip only `pg_*` and `information_schema`. Restoring this gets you a working clone. `--schemas public` is supported for narrower dumps.
- Q: Should the audit log record the SQL text? → A: **Yes, full SQL text by default.** Auditability beats PII risk for a single-operator deployment. The actor already has admin PAT — knowing WHAT was done is the whole point. Revisit if multi-org / compliance ever lands.
- Q: Should per-request statement timeout override be allowed? → A: **No per-request override** — matches upstream Cloud (verified against the OpenAPI spec for `V1RunQueryBody` — no timeout field). Default behavior is the project's Postgres `statement_timeout` GUC, which operators can already set via `supabase postgres-config update --statement-timeout=…` (feature 009). Supastack will provision new projects with a sensible default (8s) in a separate small follow-up.
- (Discovery, not Q&A): The upstream `V1RunQueryBody` includes `parameters: any[]` (parameterized queries) and `read_only: boolean` (rejects writes when true). FR-002 updated to include both for wire compatibility. Response status is **201 Created**, not 200, per the upstream spec.

**Input**: Filed as [issue #36](https://github.com/kmhari/supastack/issues/36). The upstream supabase CLI exposes two database-shaped commands that supastack doesn't implement today — `supabase db query --linked "<SQL>"` and `supabase db dump --linked [--data-only|--schema-only] [--dry-run]`. Both currently return `501 not_implemented` against supastack. Operators fall back to ssh + `docker exec supastack-<ref>-db-1 psql …` (for query) or `docker exec … pg_dump …` (for dump), which leaks VM-shell access to anyone who needs to inspect data and breaks the "manage your project from your laptop" expectation that the CLI sets. The same `database/query` endpoint also unblocks 3 MCP tools (`execute_sql`, `list_tables`, fully-correct `apply_migration`) tracked in companion [issue #37](https://github.com/kmhari/supastack/issues/37).

## User Scenarios & Testing *(mandatory)*

### User Story 1 — Operator runs ad-hoc SQL against a project from their laptop (Priority: P1) 🎯 MVP

An operator (admin role) is debugging a data issue in production and needs to check the current state of a table. They open a terminal on their laptop, run:

```bash
supabase db query --linked "SELECT id, created_at, status FROM jobs WHERE status = 'failed' ORDER BY created_at DESC LIMIT 10"
```

The CLI prints a tabular result of the 10 most recent failed jobs. No ssh. No `docker exec`. Same UX as Cloud.

**Why this priority**: This is the single highest-impact gap in the management surface for day-to-day operator workflows. It also unblocks 3 separate MCP tools that AI editors (Claude Code etc.) use, multiplying the value beyond CLI alone.

**Independent Test**: With supastack deployed and a project linked, an operator with an admin PAT runs `supabase db query --linked "SELECT 1 as one, 'hello' as greeting"` and sees a 1-row result with columns `one=1`, `greeting=hello`. They run a malformed query and see the Postgres error message verbatim. They run a query as a member-role user and see a 403 forbidden.

**Acceptance Scenarios**:

1. **Given** an operator with an admin PAT and a linked project, **When** they run `supabase db query --linked "SELECT 1 as x"`, **Then** the CLI prints a 1-row table with column `x=1` and exits 0.
2. **Given** the same operator, **When** they run a query that returns 1000 rows, **Then** the CLI prints all 1000 rows (or the user's `--limit` if specified) without truncation surprises, completing in under 10 seconds for a typical query.
3. **Given** the operator, **When** they run a malformed SQL (`SELECT * FROM nonexistent_table`), **Then** the CLI exits non-zero with the Postgres error message ("relation does not exist") visible in stderr.
4. **Given** the operator with a member-role PAT (not admin), **When** they run any `db query`, **Then** the CLI exits non-zero with a 403 forbidden message.
5. **Given** the operator runs a long query that exceeds the platform statement timeout, **When** the timeout fires, **Then** the CLI exits non-zero with a clear "statement timeout exceeded" message and the running query is canceled in the database.
6. **Given** the operator runs a destructive query (`DELETE FROM users`), **When** they have admin PAT, **Then** the query executes (no soft-guard — admin has full superuser-equivalent access) and the affected row count is reported.

---

### User Story 2 — Operator exports a project's data for backup or migration (Priority: P2)

An operator wants to take a snapshot of a project's data before applying a risky migration, or move data into a staging environment. They run:

```bash
supabase db dump --linked --data-only > backup-$(date +%s).sql
```

The CLI streams a pg_dump-style output file to disk. The operator can later `psql` that file into another database and get an equivalent dataset.

Two variants matter:
- `--data-only` — just INSERT statements (no schema)
- `--schema-only` — just DDL (no data)
- `--dry-run` — produces the dump but writes it to /dev/null; useful for size estimates + dry-run confidence

**Why this priority**: Critical for backups + dev/staging seeding, but lower volume than `db query`. Backed by an existing workaround (`docker exec pg_dump`) so operators aren't blocked, just inconvenienced.

**Independent Test**: Operator runs `supabase db dump --linked --data-only --dry-run`. The CLI streams pg_dump output to stdout (or /dev/null in dry-run). Operator runs the non-dry version → file on disk is non-empty + parseable as SQL. Operator then runs `psql -f <file>` into a fresh database with the schema already applied → all rows land + row counts match.

**Acceptance Scenarios**:

1. **Given** an operator with admin PAT, **When** they run `supabase db dump --linked --data-only`, **Then** stdout contains pg_dump-formatted SQL (INSERT statements, COPY blocks, or equivalent) covering all rows in the project's `public` schema.
2. **Given** the same operator, **When** they run `--schema-only`, **Then** stdout contains DDL for all tables/views/functions in the project's `public` schema and NO INSERT/COPY data lines.
3. **Given** the operator runs `--dry-run`, **When** the command completes, **Then** the CLI reports the dump completed (with size summary) but no real output file is produced.
4. **Given** the operator runs with no flag (full dump), **When** the command runs, **Then** both schema + data are emitted (default pg_dump behavior).
5. **Given** a member-role PAT, **When** they attempt any dump, **Then** the CLI exits non-zero with 403 forbidden.
6. **Given** a very large database (>100MB dump), **When** the command runs, **Then** output streams continuously without buffering the whole dump in memory; the operator can pipe the output to a file or another process without the api process OOM-ing.

---

### Edge Cases

- **Query returns zero rows**: The CLI prints "(0 rows)" or equivalent; exits 0. No special handling needed.
- **Query is multi-statement (`SELECT 1; SELECT 2;`)**: Rejected at the api with 400 `multi_statement_not_supported` (clarified Session 2026-05-26 Q1).
- **Query takes 10+ minutes**: Statement timeout kicks in at the platform default; query is canceled; CLI sees a clear "timeout" error. No half-completed transactions left on the database.
- **Dump fails partway through** (e.g., a table dropped during dump): pg_dump exits non-zero; the API surfaces that exit code + stderr to the CLI; the partial output stops mid-stream (operators can detect this from the missing pg_dump trailer).
- **Operator runs `db query "DROP TABLE users"`**: Allowed (admin = superuser-equivalent); no soft-guard against destructive operations in v1. (Operators wanting safety should use Studio's confirmation dialogs or write queries with explicit `BEGIN; … ROLLBACK;` wrappers.)
- **Network interruption during dump streaming**: TCP closes; pg_dump on the server side gets SIGPIPE and exits; partial output on the operator's side is detectably truncated (no pg_dump trailer). Operator re-runs.
- **Operator queries a system catalog (`pg_*` tables)**: Allowed. Some MCP tools (`list_tables`) explicitly need this.
- **Concurrent `db query` from multiple operators**: Independent — each gets its own short-lived Postgres connection. No serialization needed.
- **Project is paused or in `provisioning` state**: API returns 409 `project_not_runnable`; CLI surfaces it.
- **Operator passes credentials in SQL** (e.g., `SELECT 'sbp_…'`): Result lands in CLI stdout. Not supastack's job to redact arbitrary string values; operators should not paste secrets into queries.

## Requirements *(mandatory)*

### Functional Requirements

#### Endpoint 1 — `POST /v1/projects/<ref>/database/query`

- **FR-001**: System MUST expose `POST /v1/projects/<ref>/database/query` matching the upstream Supabase Management API path so the unmodified upstream `supabase` CLI invokes it without configuration changes.
- **FR-002**: The endpoint MUST accept a JSON body matching the upstream `V1RunQueryBody`: `{ query: string (min length 1), parameters?: unknown[], read_only?: boolean }`. When `parameters` is supplied, the SQL MUST be executed as a parameterized query (placeholders `$1`, `$2`, …). When `read_only: true`, any write operation MUST be rejected at the Postgres level (the connection is set to `default_transaction_read_only = on`). Multi-statement queries MUST be rejected with `400 multi_statement_not_supported`.
- **FR-003**: The endpoint MUST require PAT authentication via `Authorization: Bearer sbp_…`. Anonymous requests MUST return 401 `unauthenticated`.
- **FR-004**: The endpoint MUST enforce admin-only access (or equivalent existing privileged action like the one used for `reset-pg-password`). Non-admin PATs MUST return 403 `forbidden`.
- **FR-005**: On success the endpoint MUST return **201 Created** (matches upstream Management API spec) with a JSON body containing the result rows. The body shape MUST match the upstream Management API's response so the unmodified `supabase` CLI and the upstream Supabase MCP server consume it without modification.
- **FR-006**: On Postgres errors (syntax, permission, missing table, etc.) the endpoint MUST return 400 with the Postgres error message in the response so operators can debug their SQL without needing the raw API response. The error details shape is pinned in `contracts/db-query-endpoint.md` (`{ severity, code, position?, hint? }`).
- **FR-007**: The endpoint MUST honor the project's Postgres `statement_timeout` GUC for the duration of the query. There is NO per-request timeout override (matches upstream Cloud). Operators wanting different timeouts use `supabase postgres-config update --statement-timeout=…` (feature 009). New projects SHOULD be provisioned with a sensible default (8 seconds — covers typical ad-hoc queries while preventing runaway holds) in a separate follow-up to supastack's provision flow (tracked as deferred task T025). Existing projects keep their current GUC.
- **FR-008**: When the project is not in a queryable state (paused, stopped, deleting, provisioning, failed) the endpoint MUST return 409 `project_not_runnable` without touching the project's Postgres.
- **FR-009**: The endpoint MUST emit an audit log entry on every successful invocation. The log MUST include the actor PAT id, the ref, AND the full SQL text (including `parameters` if supplied, with values hex-truncated if any single param exceeds 256 bytes to bound row size). The log MUST NOT include result-set rows (could be unbounded; could leak PII via result columns). Audit action: `instance.db.query.executed`.

#### Endpoint 2 — `POST /v1/projects/<ref>/database/dump`

- **FR-010**: System MUST expose `POST /v1/projects/<ref>/database/dump` matching the upstream Management API path.
- **FR-011**: The endpoint MUST accept a JSON body with optional fields: `data_only` (boolean), `schema_only` (boolean), `dry_run` (boolean), and `schemas` (string array). Default `schemas` is all non-internal user schemas in the project's Postgres — explicitly: every schema NOT in `pg_*` AND NOT `information_schema`. The operator can override with an explicit list (e.g., `{ schemas: ["public"] }` for a narrow dump).
- **FR-012**: The endpoint MUST require admin PAT auth (same as the query endpoint, FR-003 + FR-004).
- **FR-013**: On success the endpoint MUST stream pg_dump-formatted output as the response body with `Content-Type: application/octet-stream` (binary-safe; matches `contracts/db-dump-endpoint.md`). The stream MUST NOT buffer the entire dump in memory — large databases (>1GB) MUST complete without exhausting the api process memory.
- **FR-014**: When `dry_run: true`, the endpoint MUST execute the dump operation but discard the output, returning a small JSON summary (`{ bytes_estimated: <number>, dry_run: true }`) instead of streaming dump data.
- **FR-015**: When the project is not runnable (paused etc.), return 409 (same as FR-008).
- **FR-016**: The endpoint MUST emit an audit log entry `instance.db.dump` per invocation (without dump contents). Includes actor + ref + flag summary (data_only/schema_only/dry_run).
- **FR-017**: The endpoint MUST honor client disconnect — if the operator's CLI process exits or the TCP connection drops mid-stream, the underlying pg_dump MUST be canceled (no zombie pg_dump processes left running).

#### Cross-cutting

- **FR-018**: Both endpoints MUST be reachable via the existing Caddy routing at `api.<apex>` with no infrastructure changes — they fall under the existing `api.<apex>` reverse-proxy mount.
- **FR-019**: The existing `database/migrations` family of endpoints (feature 006) MUST continue to work unchanged.
- **FR-020**: Both endpoints MUST reuse the existing project-resolution + RBAC machinery used by other `/v1/projects/<ref>/*` routes (no new auth plugin work).

### Key Entities

- **Query result** (transient response shape, no persistence): an array of row objects keyed by column name, with PG types coerced to JSON-compatible scalars (timestamps as ISO8601 strings, numerics as numbers, etc.). Matches upstream Management API shape.
- **Dump output** (streamed, no persistence): UTF-8 text matching `pg_dump` output for the requested mode. No new storage on the supastack side.
- **Audit log entries** (new action values): `instance.db.query.executed`, `instance.db.dump`. Extend the existing audit_log table; no schema change required (the existing `action` column is unconstrained `text`).

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: An operator with an admin PAT can run `supabase db query --linked "SELECT 1"` against any running project and receive a row back in under 2 seconds end-to-end. (US1)
- **SC-002**: For 100% of queries returning ≤1000 rows from tables ≤10MB total, the response completes in under 5 seconds. (US1)
- **SC-003**: A query exceeding the platform statement timeout MUST be canceled at the database; no orphan transactions remain after the CLI sees the timeout error. (US1, FR-007)
- **SC-004**: An operator can run `supabase db dump --linked --data-only` against a project with 100MB+ of data and receive the dump as a continuously streamed response — the api process memory MUST NOT spike above 200MB during the dump. (US2, FR-013)
- **SC-005**: For 100% of `--dry-run` invocations, no actual dump bytes leave the api process; the response is a JSON summary returned within 30 seconds. (US2)
- **SC-006**: Non-admin PATs receive 403 for both endpoints in 100% of attempts; no SQL is executed, no dump bytes are produced. (FR-004, FR-012)
- **SC-007**: The 3 MCP tools that depend on `database/query` (`execute_sql`, `list_tables`, fully-correct `apply_migration`) work against supastack via the upstream Supabase MCP server with NO changes to that server — they hit the new endpoint and Just Work. (cross-feature, [issue #37](https://github.com/kmhari/supastack/issues/37))
- **SC-008**: Zero plaintext PAT values or SQL result data appear in api or web logs across a full query → dump workflow, verified by inspecting log output for `sbp_[0-9a-f]{40}` and other secret-pattern matches. (FR-009)

## Assumptions

- The upstream Supabase Management API's `POST /v1/projects/<ref>/database/query` request/response shape is stable and supastack mirrors it byte-for-byte. Any deviation breaks the unmodified upstream CLI + MCP server, which is the whole point of feature 003's cli-compat surface.
- The per-project Postgres `postgres` role is SUPERUSER (verified during feature 010 work — confirmed in `supabase/postgres:15.8.1.085` image). The endpoint uses it directly. No new role provisioning.
- The query endpoint connects via `host.docker.internal:<port_db_direct>` (the per-instance Postgres port already exposed for tools like supavisor). Reuses the connection pattern established by `vault-client.ts` / `pg-password-reset.ts`.
- The dump endpoint shells `pg_dump` inside the per-instance `db` container via Docker socket exec (same pattern as `pg-password-reset.ts`). Avoids needing pg_dump in the api container's image.
- Statement timeout is sourced from the project's Postgres `statement_timeout` GUC (no per-request override; matches upstream Cloud). Default of 8 seconds for new projects is provisioned via a separate follow-up to supastack's provision flow. Operators already needing different timeouts can use `supabase postgres-config update --statement-timeout=…` shipped in feature 009.
- No tabular formatting on the CLI side — the upstream CLI already handles printing the result; supastack just returns JSON in the shape it expects.
- Audit log retention follows existing project conventions; no special retention for query/dump entries.
- Out of scope: a soft-guard or confirmation prompt for destructive queries (`DROP TABLE`, `TRUNCATE`); operators with admin PATs already have superuser-equivalent power via existing endpoints (e.g., `reset-pg-password`).
- Out of scope: streaming query results (i.e., `EXPLAIN ANALYZE` of huge result sets) — v1 buffers result rows in memory before returning. Acceptable because admins use targeted queries with `LIMIT`.
- Out of scope: `supabase db diff` (requires `database/schema/diff` endpoints — separate feature if/when needed).
- Out of scope: redacting secret-looking values in query results (e.g., a column named `password`). Operators control their own queries.
- Out of scope: per-actor query history / replay UI in the dashboard. Audit log captures the fact of execution; the SQL text is intentionally not stored (PII risk).
