# Contract — `POST /v1/projects/<ref>/database/dump`

**Purpose**: Stream `pg_dump`-formatted output for the project's Postgres. Backs `supabase db dump --linked …` (CLI).

**Auth**: PAT. RBAC: admin only.

---

## Request

```http
POST /v1/projects/<ref>/database/dump
Authorization: Bearer sbp_<40hex>
Content-Type: application/json

{
  "data_only": true,
  "schemas": ["public", "auth"],
  "dry_run": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `data_only` | boolean | No | `--data-only` flag — only INSERT/COPY data, no DDL |
| `schema_only` | boolean | No | `--schema-only` flag — only DDL, no data. Mutually exclusive with `data_only` |
| `schemas` | string[] | No | Schemas to include. Default: enumerate all non-internal schemas from `pg_namespace` (skip `pg_*`, `information_schema`) — see clarification Q2 |
| `dry_run` | boolean | No | If true, run the dump but discard output, return size summary instead of streaming bytes |

## Response

### `201 Created` — streaming dump (default)

```http
HTTP/1.1 201 Created
Content-Type: application/octet-stream
Transfer-Encoding: chunked

--
-- PostgreSQL database dump
--
SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
…
COPY public.todos (id, body, completed_at) FROM stdin;
1	buy groceries	\N
2	walk the dog	2026-05-25 12:00:00+00
…
\.
…
-- PostgreSQL database dump complete
```

- Streamed via chunked transfer encoding
- No artificial size cap; bound only by the project's actual DB size + network throughput
- Stream backpressure honored — bound api process memory regardless of dump size (SC-004)

### `201 Created` — `dry_run: true`

```http
HTTP/1.1 201 Created
Content-Type: application/json

{
  "dry_run": true,
  "bytes_estimated": 4823951,
  "schemas_dumped": ["public", "auth", "storage"],
  "duration_ms": 1247
}
```

The dump is fully executed but stdout is piped to a byte-counter sink instead of returned. Useful for size estimation before large backups.

### `400 Bad Request`

| `error.code` | When |
|---|---|
| `invalid_params` | `data_only: true` + `schema_only: true` together; or malformed `schemas` |

(Note: a requested schema that doesn't exist surfaces via `pg_dump_failed` — pg_dump's own non-zero exit and stderr, not a pre-flight check.)

### `401 / 403 / 409`

Same as `db-query-endpoint.md`.

### `5xx`

| `error.code` | When |
|---|---|
| `pg_dump_failed` | pg_dump exited non-zero; stderr included in `error.details.stderr` (truncated to 1KB) — 502 |
| `docker_exec_failed` | Couldn't exec into the per-instance db container (container down, socket issue) — 503 |

### Client disconnect mid-stream

No HTTP response — the TCP connection is already torn down. Server-side cleanup:
- `req.raw.on('aborted', …)` fires
- Docker exec kill HTTP call against the running `pg_dump`
- No audit log entry (the dump didn't complete)
- No zombie pg_dump process

## Side effects

On success:
- `audit_log` row inserted with `action = 'instance.db.dump'`, payload `{ ref, data_only?, schema_only?, schemas?, dry_run?, bytes_streamed? }`
- `bytes_streamed` filled in on response close (best-effort)

## Test obligations

Unit tests (`apps/api/tests/unit/db-dump.test.ts`):
- Happy path with mocked Docker socket — exit 0, stdout bytes counted
- `data_only` + `schema_only` together → 400 invalid_params
- pg_dump exits non-zero → 502 with stderr in details
- Client disconnect → Docker exec kill called

Live-VM E2E (`tests/cli-e2e/db-query-dump.sh`):
- `supabase db dump --linked --data-only --dry-run` → 201 with size summary
- `supabase db dump --linked --data-only > /tmp/dump.sql` → file non-empty, parseable as SQL
- Restore round-trip: dump from project A, create empty project B, restore the dump, verify row counts match
- Cancel mid-stream (`Ctrl+C` the CLI) → server-side `pg_dump` process count returns to 0 within 5s (no zombies)
