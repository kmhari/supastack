# Research — 013 db query + db dump endpoints

**Date**: 2026-05-26

All clarifications from spec.md → Clarifications (Session 2026-05-26) are resolved. The decisions below cover the implementation-specific choices needed on top of the clarified requirements + lock down the wire shape against the upstream Management API.

---

## Decision 1 — Wire shape lock against upstream `V1RunQueryBody`

**Decision**: Match upstream byte-for-byte. Verified against `https://api.supabase.com/api/v1-json` during the clarify phase:

```json
{
  "type": "object",
  "properties": {
    "query": { "type": "string", "minLength": 1 },
    "parameters": { "type": "array", "items": {} },
    "read_only": { "type": "boolean" }
  },
  "required": ["query"]
}
```

Response: 201 Created (NOT 200). Body shape matches upstream (need to inspect a real response to confirm exact key naming — likely `{ "result": [...rows...] }` based on the upstream OpenAPI components but Phase 1 contracts will pin this).

**Rationale**: The whole point of the cli-compat surface (feature 003) is "the unmodified upstream CLI + MCP server work without configuration." Any deviation breaks both. Zero-flexibility on this.

**Alternatives considered**:
- Add supastack-specific fields (e.g., `audit_label`) — rejected; if upstream adds them later we'd collide.
- Return 200 instead of 201 — rejected; the upstream CLI checks for 2xx generally, but the MCP server's typed client may check 201 specifically. Use 201 to be safe.

---

## Decision 2 — Per-project pg connection (`postgres` role, not `supabase_admin`)

**Decision**: New helper `with-project-pg.ts` opens a short-lived `pg.Client` to `host.docker.internal:<port_db_direct>` as the `postgres` role (PG SUPERUSER, the canonical superuser role in `supabase/postgres:15.8.1.085`). Same connection pattern as `vault-client.ts` (decrypt instance secrets, build connection string, connect, do work, disconnect) but with `postgres` instead of `supabase_admin`.

```ts
export async function withProjectPg<T>(
  ref: string,
  fn: (client: Client) => Promise<T>,
  options?: { readOnly?: boolean }
): Promise<T>;
```

When `readOnly: true`, set `default_transaction_read_only = on` immediately after connect — Postgres will reject any DML/DDL with a clear error that propagates back to the caller.

**Rationale**:
- `postgres` is the canonical role; the operator may legitimately want to query `auth.users` or run `pg_*` functions that `supabase_admin` doesn't have permission for.
- Separate from `vault-client` because role + intent differ. Avoids accidental privilege confusion.
- `default_transaction_read_only` is a session-level GUC; setting it after connect is the cleanest way to enforce read-only without rewriting the operator's SQL.

**Alternatives considered**:
- Reuse `vault-client.withVaultClient` with `supabase_admin` — rejected; doesn't have superuser privileges for arbitrary queries (e.g., `pg_terminate_backend`).
- Parse + validate the operator's SQL ourselves to enforce read-only — rejected; brittle, can't match Postgres's actual semantics, easy to bypass with CTEs / function calls.

---

## Decision 3 — Multi-statement detection

**Decision**: Pure function `detectMultiStatement(sql: string): boolean` in `multi-statement-detect.ts`. Walks the string char-by-char, tracking:

- Inside single-quoted string literal (`'…'` with `''` for escape)
- Inside double-quoted identifier (`"…"` with `""` for escape)
- Inside line comment (`-- …`)
- Inside block comment (`/* … */` — nestable in PG)
- Inside dollar-quoted string (`$tag$…$tag$`)

Returns true if it finds a `;` outside of any of those AND there's non-whitespace content after that `;` (so trailing semicolons are allowed). Rejected case → route returns 400 `multi_statement_not_supported`.

**Rationale**:
- A regex won't cut it (PG has dollar quoting, comments inside strings, etc.). A small state machine is ~50 lines and trivially testable.
- We MUST reject before sending to Postgres because `pg`'s `client.query()` silently runs all statements and returns only the last result — exactly the "lossy" behavior clarification Q1 rejected.

**Alternatives considered**:
- Use `pg-query-emscripten` to parse the SQL into an AST and count statements — adds 4MB of WASM dependency for what a 50-line function handles correctly. Rejected.
- Just count `;` characters — wrong (false positives in string literals like `'a;b'`).

---

## Decision 4 — `pg_dump` streaming via Docker socket exec

**Decision**: New helper `pg-dump-exec.ts` shells `pg_dump` inside the per-instance `supastack-<ref>-db-1` container via the Docker Engine HTTP API (Unix socket at `/var/run/docker.sock`). Streams stdout directly to the Fastify Reply object. Pattern from `apps/api/src/services/pg-password-reset.ts` (Docker socket exec) extended for streaming output.

```ts
export async function streamPgDump(
  ref: string,
  flags: { dataOnly?: boolean; schemaOnly?: boolean; schemas?: string[] },
  output: NodeJS.WritableStream,
  signal: AbortSignal,
): Promise<{ exitCode: number; bytesWritten: number }>;
```

Flow:
1. Resolve container name: `supastack-<ref>-db-1`
2. Compute `pg_dump` args:
   - Always: `-h 127.0.0.1 -U postgres -d postgres --no-owner --no-privileges`
   - Conditional: `--data-only` / `--schema-only`
   - Conditional: `--schema=<name>` for each requested schema (or omit for default-all)
3. Docker exec create → start → pipe stdout to `output`
4. On `signal.aborted` (client disconnect) → call Docker exec kill (HTTP API `/exec/<id>/kill`)
5. Inspect exit code; return

`signal` comes from `req.raw.aborted` event on the Fastify request. When the operator's CLI exits or the TCP connection drops, Fastify fires `aborted` → we abort the exec → pg_dump dies cleanly. No zombie processes.

**Rationale**:
- Avoids needing `pg_dump` binary in the api container image (would add ~30MB + version-coupling)
- Same Docker socket already mounted into api container for `pg-password-reset.ts` — no infra change
- Streaming output bound to TCP backpressure naturally; the Docker socket pipes through

**Alternatives considered**:
- Bundle `pg_dump` in the api container image — possible but couples api image to a specific PG client version; awkward upgrades.
- Use `pg`-protocol-based dump (`pg-copy-streams`) — partial; copies tables but doesn't emit the full DDL prologue. Would only support `--data-only`.

---

## Decision 5 — Default `schemas` for dump = all non-internal

**Decision**: When `schemas` is omitted from the request body, enumerate all schemas in the project's PG that are NOT in (`pg_catalog`, `pg_toast`, `information_schema`, schemas starting with `pg_temp_*`/`pg_toast_temp_*`). Pass each as `--schema=<name>` to pg_dump.

Implementation:
```sql
SELECT nspname FROM pg_namespace
 WHERE nspname NOT LIKE 'pg\_%' ESCAPE '\'
   AND nspname != 'information_schema'
 ORDER BY nspname;
```

For a fresh supastack project this returns: `auth`, `extensions`, `graphql`, `graphql_public`, `net`, `pgsodium`, `pgsodium_masks`, `public`, `realtime`, `storage`, `supabase_functions`, `supabase_migrations`, `vault`.

**Rationale**:
- Matches clarification Q2: a backup-flavored command should produce a working clone on restore, not lose `auth.users` because of a too-narrow default.
- Operator can still override with explicit `{ schemas: ["public"] }` for a narrow dump.

**Alternatives considered**:
- Use pg_dump's default (all schemas including internal) — rejected; restore loops on duplicate `pg_catalog` etc.
- Hardcode the supabase-shipped schema list — fragile; new internal schemas would silently fall through.

---

## Decision 6 — `read_only: true` enforcement via session GUC

**Decision**: When request body has `read_only: true`, immediately after pg connect set:

```sql
SET default_transaction_read_only = on;
```

Then run the operator's query. Postgres rejects any write with `ERROR: cannot execute <op> in a read-only transaction` which propagates as a 400 PG error to the CLI.

**Rationale**:
- Postgres's native enforcement — no parsing needed
- `default_transaction_read_only` applies to ALL transactions in the session (including implicit ones for non-transaction-wrapped queries)
- Cleanly maps to upstream `V1RunQueryBody.read_only` semantics

**Alternatives considered**:
- Use a different PG role with no write grants — would require provisioning + maintaining a `db_read_only` role per project. Overkill for a per-request flag.
- Parse the SQL ourselves — same brittleness as multi-statement detection but worse (need to understand all DML/DDL).

---

## Decision 7 — Audit log emit semantics

**Decision**: New audit `action` values:

- `instance.db.query.executed` — emitted on successful query execution. Payload: `{ ref, query, parameters?, read_only?, row_count, duration_ms }`. The `query` field stores the full SQL text (clarification Q3). `parameters` truncated per-element if any value exceeds 256 bytes (replaced with `{ truncated: true, original_size: <n> }`).
- `instance.db.dump` — emitted on successful dump start (not completion — long-running). Payload: `{ ref, data_only, schema_only, schemas, dry_run, bytes_streamed? }`. `bytes_streamed` filled in best-effort on disconnect via Fastify response close handler.

Failed queries (PG errors, multi-statement reject, 403) emit `instance.db.query.failed` with the error code for traceability.

No additional schema migration — `audit_log.action` is unconstrained `text` per the 0000_init schema (confirmed during feature 010 work).

**Rationale**: Auditability + the Q3 clarification (full SQL text). Failed queries get logged too so security review can spot enumeration patterns.

**Alternatives considered**:
- Log only on success → security gap (failed-query reconnaissance invisible). Rejected.

---

## Decision 8 — Statement-timeout sourcing + provision-time default

**Decision** (per clarification Q4): NO per-request timeout override. The query's effective timeout is the project's Postgres `statement_timeout` GUC setting, which operators set via `supabase postgres-config update --statement-timeout=…` (feature 009 already shipped).

For new projects, **set `statement_timeout = 8000` (8 seconds)** at provision time via a small one-line addition to the provision pipeline's bootstrap SQL. This protects shared DB resources from runaway operator queries while still covering >95% of typical ad-hoc work.

The provision-time default is a separate follow-up (out of scope for this feature) — exists as a TODO in the implementation tasks. Existing projects without an explicit setting will have `statement_timeout = 0` (unlimited) until the operator runs `postgres-config update` or supastack ships the provision-pipeline change.

**Rationale**:
- Mirrors Cloud's behavior exactly (no request-level override)
- Operators already have the postgres-config knob from feature 009 — no new mechanism
- 8s default matches Cloud's SQL editor default; >95% of ad-hoc queries fit

**Alternatives considered**:
- Add a request-level `timeout_ms` field — rejected per clarification Q4 (breaks upstream wire shape, adds DoS surface).
- Use `idle_in_transaction_session_timeout` instead — wrong semantic; that targets idle transactions, not runaway queries.

---

## Resolved NEEDS CLARIFICATION

All 4 clarifications from spec.md Session 2026-05-26 are addressed:

| Clarification | Resolution |
|---|---|
| Multi-statement behavior | 400 `multi_statement_not_supported` (Decision 3) |
| Default schemas for dump | All non-internal schemas via `pg_namespace` query (Decision 5) |
| Audit log SQL text | Full text + truncated parameters (Decision 7) |
| Statement timeout override | None per-request; uses PG GUC settable via feature 009 (Decision 8) |

Plus the wire-shape discoveries from the clarify-phase OpenAPI fetch:
- Request body includes `parameters[]` and `read_only` (Decision 1; Decision 6 for read_only enforcement)
- Response is 201 Created, not 200 (Decision 1)

Phase 0 complete. Proceeding to Phase 1 design.
