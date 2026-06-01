# Implementation Plan: db query + db dump endpoints

**Branch**: `013-db-query-dump` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)

## Summary

Two new Management API endpoints matching upstream Supabase byte-for-byte:

- `POST /v1/projects/<ref>/database/query` — execute SQL, return rows. Accepts upstream `V1RunQueryBody` (`{ query, parameters?, read_only? }`). Returns 201 with result rows. Multi-statement rejected with 400. Statement timeout sourced from the project's Postgres `statement_timeout` GUC (no per-request override; same as Cloud).
- `POST /v1/projects/<ref>/database/dump` — stream `pg_dump` output. Accepts `{ data_only?, schema_only?, dry_run?, schemas? }`. Default schemas = all non-internal (skip `pg_*` + `information_schema`). Streams to bound memory; honors client disconnect.

Both endpoints require admin PAT (same RBAC as `reset-pg-password`). Connect to the per-project Postgres as `postgres` (SUPERUSER) via `host.docker.internal:<port_db_direct>`, reusing the connection pattern established by `vault-client.ts`. Dump shells `pg_dump` inside the per-instance `db` container via Docker socket exec (pattern from `pg-password-reset.ts`).

One shipped endpoint (`database/query`) unblocks 3 MCP tools (`execute_sql`, `list_tables`, fully-correct `apply_migration`) per companion [issue #37](https://github.com/kmhari/supastack/issues/37) — SC-007 in the spec makes this explicit.

## Technical Context

**Language/Version**: TypeScript on Node 20 (api process)

**Primary Dependencies**: Fastify (api), `pg` client (per-project Postgres access — already in `apps/api/package.json` from feature 010's vault-client), Drizzle ORM (control-plane DB), `node:http` for Docker socket exec (already used by `pg-password-reset.ts`)

**Storage**:
- **Per-project Postgres** — read/write target for query; read-only target for dump. Connected as `postgres` (SUPERUSER) via `host.docker.internal:<port_db_direct>`
- **Control-plane DB** — `audit_log` table extended with two new action values (`instance.db.query.executed`, `instance.db.dump`); no schema change required

**Testing**: Vitest unit tests for the SQL helpers + route handlers (mocked pg.Client + mocked Docker socket); live-VM shell script in `tests/cli-e2e/` for the end-to-end happy path through both endpoints.

**Target Platform**: Single Linux VM Docker compose stack. Same as the rest of supastack. VM: `ubuntu@148.113.1.164`, apex `supaviser.dev`.

**Project Type**: Web application monorepo — extends `apps/api`. No web/worker changes.

**Performance Goals**:
- `db query` returning ≤1000 rows from ≤10MB tables completes in <5s end-to-end (SC-002)
- `db dump` of 100MB+ database completes without api process memory exceeding 200MB (SC-004); streaming, not buffering
- Polling endpoint adds <100ms overhead per query (mostly: pg connect + execute + serialize)

**Constraints**:
- Wire-contract LOCK against upstream `V1RunQueryBody` and `database/query` response shape — must match byte-for-byte so the unmodified CLI + MCP server work (SC-007). No deviation.
- Response status 201 (not 200) — upstream-spec compat
- Admin PAT only (same RBAC as `reset-pg-password`); no new action needed
- Statement timeout NOT request-overridable — sourced from project's PG GUC (clarification Q4)
- Multi-statement queries REJECTED at the api (clarification Q1) — operators wrap in a function or split
- Dump streams via TCP — client disconnect must cancel the underlying `pg_dump` (no zombie processes)

**Scale/Scope**:
- ~10s of projects per VM, ~10s of operator queries/day; the endpoints are operator-facing, not application-traffic
- Single-VM session store + audit log; no cross-region replication
- Dump output bounded only by the project's actual DB size; streaming keeps api memory flat

## Constitution Check

*GATE: N/A — project constitution at `.specify/memory/constitution.md` is the unfilled template (no ratified principles, consistent with prior features 010/011).*

No constraints to gate against. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/013-db-query-dump/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications session 2026-05-26)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── db-query-endpoint.md     # POST /v1/projects/<ref>/database/query
│   └── db-dump-endpoint.md      # POST /v1/projects/<ref>/database/dump
├── checklists/
│   └── requirements.md  # From /speckit-specify (all items pass)
└── tasks.md             # (Phase 2 — /speckit-tasks)
```

### Source Code (repository root)

```text
apps/
  api/
    src/
      routes/
        management/
          db-query.ts                   # NEW — POST /v1/projects/:ref/database/query
          db-dump.ts                    # NEW — POST /v1/projects/:ref/database/dump
      services/
        with-project-pg.ts              # NEW — short-lived pg.Client to host.docker.internal:<port_db_direct> as `postgres` (SUPERUSER). Reuses decryption pattern from vault-client.ts but with the `postgres` role (full superuser; needed for arbitrary SQL + dump).
        pg-dump-exec.ts                 # NEW — Docker socket exec wrapper for pg_dump, streams stdout to a Fastify Reply. Pattern from pg-password-reset.ts.
        multi-statement-detect.ts       # NEW — tiny pure function: returns true if a SQL string contains more than one meaningful statement (string-literal-aware, comment-aware). Pure, easily unit-testable.
      server.ts                         # MODIFIED — register both new routes under the /v1 management mount
    tests/
      unit/
        db-query.test.ts                # NEW — route happy/error paths (mocked pg.Client)
        db-dump.test.ts                 # NEW — route happy/error paths (mocked Docker socket)
        with-project-pg.test.ts         # NEW — connection lifecycle (mock pg.Client)
        pg-dump-exec.test.ts            # NEW — streaming behavior, disconnect handling, exit code propagation
        multi-statement-detect.test.ts  # NEW — pure-function test cases (single, multi, comment-only, string-literal with semicolon, etc.)
      contract/
        db-query.contract.test.ts       # NEW — wire-shape against the upstream V1RunQueryBody + response (snapshot-based)

tests/
  cli-e2e/
    db-query-dump.sh                    # NEW — live-VM end-to-end: run a query, dump --dry-run, restore data-only round-trip
```

**Structure Decision**: Supastack monorepo, existing layout extended. The two route files live under `apps/api/src/routes/management/` (matching the existing convention for `/v1/*` surface). Service layer split deliberately:

- `with-project-pg.ts` separate from `vault-client.ts` because vault-client uses `supabase_admin` (PG SUPERUSER but scoped for vault-specific operations); db-query needs `postgres` (PG SUPERUSER, the canonical superuser role). Same connection pattern, different role — separate helper avoids accidental cross-use.
- `pg-dump-exec.ts` separate from `pg-password-reset.ts` because dump streams whereas reset is single-shot; different output handling.
- `multi-statement-detect.ts` is a tiny pure function — separate file so the unit test can hammer it with edge cases (string literals containing `;`, line comments, block comments, dollar-quoted strings) without touching the rest of the route.

No web/worker changes. No new dependencies (`pg` already in `apps/api/package.json` from feature 010).

## Complexity Tracking

*No constitution gates to violate. No exceptions to justify.*
