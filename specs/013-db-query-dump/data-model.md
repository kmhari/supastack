# Data Model — 013 db query + db dump

**Date**: 2026-05-26

## Persistent storage

### `audit_log` (existing — extended action values)

No schema migration required. The `audit_log.action` column is unconstrained `text` (verified during feature 010). New action values appended:

| Action | Emitted when | Payload fields |
|---|---|---|
| `instance.db.query.executed` | Successful query execution | `ref` (string), `query` (text — full SQL), `parameters?` (JSON array, per-element truncated to 256 bytes), `read_only?` (bool), `row_count` (number), `duration_ms` (number) |
| `instance.db.query.failed` | Query failed (PG error, multi-statement reject, read-only violation) | `ref`, `query`, `error_code` (e.g., `multi_statement_not_supported`, `pg_error`, `read_only_violation`), `error_message` (string) |
| `instance.db.dump` | Successful dump start | `ref`, `data_only?` (bool), `schema_only?` (bool), `schemas?` (string[]), `dry_run?` (bool), `bytes_streamed?` (number, filled on response close) |

Audit row uses the existing schema: `actor_user_id` (resolved from the PAT), `target_kind = 'supabase_instance'`, `target_id = ref`.

### `api_tokens` (existing — no change)

PAT resolution unchanged from feature 003. The endpoint uses the existing auth middleware to resolve actor PAT → user_id → role → RBAC check.

## Transient (in-memory only)

### Per-request `pg.Client` for `database/query`

```ts
{
  host: 'host.docker.internal',  // resolves to the VM's host gateway from within the api container
  port: instance.portDbDirect,    // per-project Postgres port
  user: 'postgres',                // SUPERUSER role
  password: decryptedSecrets.postgresPassword,  // from supabase_instances.encryptedSecrets via loadMasterKey + decryptJson
  database: 'postgres',
  connectionTimeoutMillis: 5000,
}
```

Connection scope: single request. Opens before query, closes after (success or error). No pooling — operator queries are operator-volume (<10/day per project), and pooling per-project introduces complexity around stale connections after secret rotation.

When `req.body.read_only === true`: immediately after connect, execute `SET default_transaction_read_only = on;` before running the operator's query.

### Per-request Docker exec for `database/dump`

```ts
{
  socketPath: '/var/run/docker.sock',
  container: `supastack-${ref}-db-1`,
  cmd: ['pg_dump',
        '-h', '127.0.0.1',
        '-U', 'postgres',
        '-d', 'postgres',
        '--no-owner',
        '--no-privileges',
        ...(dataOnly ? ['--data-only'] : []),
        ...(schemaOnly ? ['--schema-only'] : []),
        ...schemas.flatMap(s => ['--schema', s]),
       ],
  AttachStdout: true,
  AttachStderr: true,
}
```

Stdout streams directly to the Fastify Reply. Stderr buffered in-memory (bounded at 8KB) — surfaced if `pg_dump` exits non-zero. Client disconnect (Fastify `req.raw.on('aborted', …)`) triggers Docker exec kill HTTP call.

## Validation rules

| Rule | Enforced at |
|---|---|
| `query` field is non-empty string | api (Zod) |
| `parameters` is array if present | api (Zod) |
| `read_only` is boolean if present | api (Zod) |
| Multi-statement queries rejected | api (`multi-statement-detect.ts`) before pg connect |
| `schemas` is string[] if present (default: enumerate from `pg_namespace`) | api (Zod) + Postgres lookup |
| `data_only` AND `schema_only` together → 400 invalid_params | api |
| PAT has admin role | existing `app.authorize` + RBAC matrix |
| Project is in queryable state (status in `running` only) | api (DB lookup on `supabase_instances.status`) |
| Postgres `statement_timeout` GUC enforced at PG level | per-project Postgres (sourced via feature 009's postgres-config) |

## Entity relationships

```
operator (admin PAT)
     │
     │ Authorization: Bearer sbp_…
     ▼
api process
     ├─ resolve PAT → user_id → role (admin/member/…)
     ├─ check role === 'admin' → else 403
     │
     ├─ for db/query:
     │     ├─ Zod-validate { query, parameters?, read_only? }
     │     ├─ multi-statement-detect → if multi → 400
     │     ├─ lookup supabase_instances.{ portDbDirect, encryptedSecrets, status } by ref
     │     ├─ if status !== 'running' → 409 project_not_runnable
     │     ├─ decryptJson(encryptedSecrets, loadMasterKey()) → { postgresPassword }
     │     ├─ withProjectPg(ref, { readOnly: read_only }, async (client) => {
     │     │       await client.query(query, parameters)
     │     │       return rows
     │     │   })
     │     ├─ emit audit instance.db.query.{executed|failed}
     │     └─ return 201 { result: rows }
     │
     └─ for db/dump:
           ├─ Zod-validate { data_only?, schema_only?, dry_run?, schemas? }
           ├─ same status check + RBAC
           ├─ if schemas omitted: enumerate via SELECT FROM pg_namespace
           ├─ streamPgDump(ref, flags, reply, req.signal)
           ├─ if dry_run: discard output, count bytes, return 201 { bytes_estimated, dry_run: true }
           ├─ else: stream pg_dump stdout to reply (Content-Type: application/octet-stream)
           ├─ on req.aborted: kill Docker exec, no audit
           └─ on success: emit audit instance.db.dump
```

No cross-project state. Each request is self-contained.
