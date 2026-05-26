# Feature 013 — `db query` + `db dump` Management API endpoints

**Branch**: `013-db-query-dump`
**Closes**: [#36](https://github.com/kmhari/selfbase/issues/36) — unblocks 1 CLI command + 3 MCP tools per [#37](https://github.com/kmhari/selfbase/issues/37)
**Spec**: [specs/013-db-query-dump/spec.md](../../specs/013-db-query-dump/spec.md)
**Plan**: [specs/013-db-query-dump/plan.md](../../specs/013-db-query-dump/plan.md)

## What changed

Two new Management API endpoints, both admin-PAT-gated, both mounted under the existing `/v1/*` Supabase-CLI compat surface:

- **`POST /v1/projects/<ref>/database/query`** — runs ad-hoc SQL against the per-project Postgres and returns the rows as JSON. Wire-compatible with upstream `V1RunQueryBody`. Backs `supabase db query --linked "<SQL>"` from the laptop, plus 3 MCP tools (`execute_sql`, `list_tables`, fully-correct `apply_migration`) without any server-side MCP changes.
- **`POST /v1/projects/<ref>/database/dump`** — streams `pg_dump` output for the project's Postgres. Backs `supabase db dump --linked …`. Honors `data_only` / `schema_only` / `schemas` / `dry_run` flags. Output is `application/octet-stream` with chunked transfer encoding — bounded api memory regardless of dump size (SC-004).

Both endpoints require RBAC action `database.write` (admin-only). Both emit `audit_log` rows (`instance.db.query.{executed,failed}` and `instance.db.dump`) on every terminating path — including 403s, multi-statement rejects, and PG errors — so security review can spot enumeration patterns.

## Operator usage

```bash
# Run a query
supabase db query --linked "SELECT id, email FROM auth.users LIMIT 10"

# Or directly via curl
curl -X POST "https://api.<apex>/v1/projects/<ref>/database/query" \
  -H "Authorization: Bearer sbp_..." \
  -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1"}'

# Dump
supabase db dump --linked --data-only > backup.sql

# Dry-run for size estimate
supabase db dump --linked --dry-run
```

## Audit log

Every query (success or failure) inserts a row:

| Action                       | Payload                                                                           |
| ---------------------------- | --------------------------------------------------------------------------------- |
| `instance.db.query.executed` | `{ ref, query, parameters?, read_only?, row_count, duration_ms }`                 |
| `instance.db.query.failed`   | `{ ref, query, parameters?, read_only?, error_code, error_message, duration_ms }` |
| `instance.db.dump`           | `{ ref, data_only?, schema_only?, schemas, dry_run, bytes_streamed }`             |

**The full SQL text is logged by default** (clarification Q3 — auditability beats PII risk for a single-operator deployment). Parameters > 256 bytes are replaced with `{ truncated: true, original_size: <n> }` in the payload to bound row size. Result-set rows are NOT logged (could be unbounded; would leak PII via columns).

For compliance review: this is a deliberate trade-off. Revisit if a multi-org / regulated deployment lands.

## Statement timeout

There is **no per-request timeout override** — matches upstream Cloud (clarification Q4, FR-007). Operators control the effective timeout via the project's Postgres `statement_timeout` GUC:

```bash
supabase postgres-config update --statement-timeout='8s'
```

(`postgres-config update` is feature 009.) New projects are NOT yet provisioned with an 8s default — that lands in a follow-up to the provision pipeline (task T025, separate PR).

Existing projects keep their current setting (PG default `0` = unlimited unless previously changed).

## Restore-from-dump recipe

```bash
# 1. Dump the source
supabase db dump --linked --no-owner --no-privileges > /tmp/source.sql

# 2. Provision a fresh selfbase project (via dashboard or /api/v1/instances)

# 3. Restore via direct PG connection to the new project
NEW_REF=<new-ref>
NEW_PW=$(grep POSTGRES_PASSWORD /var/selfbase/instances/${NEW_REF}/.env | cut -d= -f2)
psql "postgresql://postgres:${NEW_PW}@db.${NEW_REF}.<apex>:5432/postgres" -f /tmp/source.sql
```

## Troubleshooting

| Symptom                                             | Likely cause                                         | Fix                                                                                                  |
| --------------------------------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `400 multi_statement_not_supported`                 | SQL contains `SELECT 1; SELECT 2;`                   | Submit one statement at a time, or wrap in `CREATE FUNCTION`                                         |
| `400 read_only_violation` (SQLSTATE 25006)          | `read_only: true` set + write attempted              | Drop `read_only` if write is intentional                                                             |
| `400 pg_error` SQLSTATE 57014 (`statement timeout`) | Query exceeded `statement_timeout` GUC               | Optimize the query, OR raise the GUC via `supabase postgres-config update --statement-timeout=…`     |
| `409 project_not_runnable`                          | Project is paused / provisioning / failed            | Wait for status `running` (visible on dashboard)                                                     |
| `502 pg_dump_failed`                                | pg_dump exited non-zero — see `error.details.stderr` | Usually a transient container issue; retry. If persistent, ssh and `docker logs selfbase-<ref>-db-1` |
| `503 pg_connect_failed`                             | Couldn't reach per-project Postgres                  | Check project status; check api container can reach `host.docker.internal:<port>`                    |

## Implementation notes

- **`apps/api/src/services/multi-statement-detect.ts`** — pure state-machine SQL parser. Aware of string literals, double-quoted identifiers, line + (nestable) block comments, and dollar-quoted strings. Unit tests cover 20 edge cases.
- **`apps/api/src/services/per-instance-pg.ts`** — extended with `readOnly` + `timeoutMs: null` options. Pre-existing helper; reused rather than duplicated as originally planned in research.md Decision 2.
- **`apps/api/src/services/pg-dump-exec.ts`** — Docker socket exec wrapper that streams pg_dump stdout to a Fastify Reply via the multiplexed Docker frame protocol (8-byte header + payload demux). On `AbortSignal.abort` (client disconnect), `pkill -f pg_dump` inside the container. No zombies (FR-017).
- **`apps/api/src/routes/management/db-query.ts`** — audit emit wrapper covers ALL paths (success, 403, multi-statement reject, PG error, invalid body) per remediation U2.
- **`apps/api/src/routes/management/db-dump.ts`** — `reply.hijack()` for the streaming path so Fastify's serializer doesn't buffer the dump; dry-run path keeps the JSON envelope via `reply.send`.

## MCP tools unblocked (SC-007)

The upstream Supabase MCP server's `execute_sql`, `list_tables`, and corrected `apply_migration` tools point at `POST /v1/projects/<ref>/database/query`. With this feature deployed, all three work against selfbase via the unmodified MCP server — no fork, no shim. Verified via Claude Code editor smoke (task T026).

## Wire-shape contract

Snapshot: `apps/api/tests/contract/__snapshots__/v1-run-query-body.json` — pinned against `https://api.supabase.com/api/v1-json` as of 2026-05-26. Refresh procedure documented in `apps/api/tests/contract/db-query.contract.test.ts` header.

Response status: **201 Created** (NOT 200) per upstream spec. Body: `{ result: Array<Record<string, unknown>> }`.

## Files

```
apps/api/src/services/multi-statement-detect.ts     NEW
apps/api/src/services/pg-dump-exec.ts                NEW
apps/api/src/services/per-instance-pg.ts             MODIFIED (readOnly + timeoutMs:null opts)
apps/api/src/routes/management/db-query.ts           NEW
apps/api/src/routes/management/db-dump.ts            NEW
apps/api/src/server.ts                               MODIFIED (route registration)
packages/shared/src/mgmt-api-schemas.ts              MODIFIED (DbQueryBodySchema, DbDumpBodySchema, …)
packages/shared/src/rbac.ts                          MODIFIED (database.write action)
apps/api/tests/unit/multi-statement-detect.test.ts   NEW (20 cases)
apps/api/tests/unit/db-query.test.ts                 NEW (12 cases)
apps/api/tests/unit/db-dump.test.ts                  NEW (7 cases)
apps/api/tests/unit/pg-dump-exec.test.ts             NEW (5 cases)
apps/api/tests/contract/db-query.contract.test.ts    NEW (7 cases)
apps/api/tests/contract/__snapshots__/v1-run-query-body.json  NEW
apps/api/tests/contract/rbac.test.ts                 MODIFIED (snapshot for database.write)
tests/cli-e2e/db-query-dump.sh                       NEW (live-VM E2E)
docs/changes/013-db-query-dump.md                    NEW (this file)
```
