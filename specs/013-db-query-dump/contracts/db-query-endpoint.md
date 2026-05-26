# Contract — `POST /v1/projects/<ref>/database/query`

**Purpose**: Execute arbitrary SQL against the project's Postgres. Backs `supabase db query --linked "…"` (CLI) and `mcp__supabase__execute_sql` + `mcp__supabase__list_tables` (MCP tools).

**Auth**: PAT (`Authorization: Bearer sbp_…`). RBAC: admin only (matches `reset-pg-password`).

**Wire-shape MUST match upstream `V1RunQueryBody`** — verified against `https://api.supabase.com/api/v1-json` during clarify phase. Any deviation breaks the unmodified upstream CLI + MCP server.

---

## Request

```http
POST /v1/projects/<ref>/database/query
Authorization: Bearer sbp_<40hex>
Content-Type: application/json

{
  "query": "SELECT id, email FROM auth.users WHERE created_at > $1 LIMIT $2",
  "parameters": ["2026-01-01T00:00:00Z", 10],
  "read_only": true
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `query` | string, min length 1 | Yes | SQL to execute. MUST be a single statement; multi-statement → 400. |
| `parameters` | array of any | No | Positional parameters (`$1`, `$2`, …) substituted by Postgres at execute time. Safer than string concat. |
| `read_only` | boolean | No (default false) | If true, sets `default_transaction_read_only = on` before executing — Postgres rejects DML/DDL with a 400. |

## Response

### `201 Created` (success)

```json
{
  "result": [
    { "id": "a1b2c3…", "email": "alice@example.com" },
    { "id": "d4e5f6…", "email": "bob@example.com" }
  ]
}
```

- Array of row objects, keyed by column name
- Postgres types coerced to JSON-compatible scalars:
  - `timestamptz` / `timestamp` → ISO8601 string
  - `numeric` / `decimal` → JSON number (precision-bounded; very large decimals stringified)
  - `bytea` → hex-encoded string (`\\x…`)
  - `jsonb` / `json` → nested JSON
  - `array` → JSON array
  - `null` → JSON null
- Empty result-set → `{ "result": [] }`
- Status 201 (not 200) per upstream spec

### `400 Bad Request` — query problems

| `error.code` | When |
|---|---|
| `multi_statement_not_supported` | Multi-statement query detected (e.g., `SELECT 1; SELECT 2;`) |
| `pg_error` | Postgres returned an error (syntax, missing table, type mismatch, permission, etc.) — the PG error message is in `error.message`, and `error.details` includes `{ severity, code, position?, hint? }` |
| `read_only_violation` | `read_only: true` was set and the query attempted a write (Postgres SQLSTATE `25006`) |
| `invalid_params` | Body failed Zod validation (empty query, wrong types) |

```json
{
  "error": {
    "code": "pg_error",
    "message": "relation \"nonexistent_table\" does not exist",
    "details": {
      "severity": "ERROR",
      "code": "42P01",
      "position": "15"
    }
  }
}
```

### `401 Unauthorized`

```json
{ "error": { "code": "unauthenticated", "message": "PAT required" } }
```

### `403 Forbidden`

Non-admin PAT or PAT without `database.write` action.

```json
{ "error": { "code": "forbidden", "message": "admin role required" } }
```

### `409 Conflict` — project not runnable

```json
{
  "error": {
    "code": "project_not_runnable",
    "message": "Cannot query — project status is 'paused'",
    "details": { "status": "paused" }
  }
}
```

### `5xx` — internal failures

| `error.code` | When |
|---|---|
| `pg_connect_failed` | Couldn't reach the per-project Postgres (network, credentials, paused container) — 503 |
| `internal` | Anything else unexpected — 500 |

## Side effects

On success:
- `audit_log` row inserted with `action = 'instance.db.query.executed'`, payload `{ ref, query, parameters?, read_only?, row_count, duration_ms }`
- Note: full SQL text in `query` field per clarification Q3 (auditability over PII)

On failure:
- `audit_log` row with `action = 'instance.db.query.failed'`, payload `{ ref, query, error_code, error_message }`

## Statement timeout

NO per-request override (matches upstream). The effective timeout is the project's Postgres `statement_timeout` GUC, settable via `supabase postgres-config update --statement-timeout=…` (feature 009).

New projects are provisioned with `statement_timeout = 8000` (8s) in a separate follow-up to the provision pipeline. Existing projects keep their current setting (PG default `0` = unlimited unless operator changed it).

## Test obligations

Unit tests (`apps/api/tests/unit/db-query.test.ts`):

| Case | Expected |
|---|---|
| Valid SELECT | 201 + correct row shape |
| Parameterized query | 201 + parameters substituted, no SQL injection |
| Multi-statement | 400 `multi_statement_not_supported` |
| `read_only: true` + SELECT | 201 + rows |
| `read_only: true` + INSERT/UPDATE/DELETE/DDL | 400 `read_only_violation` |
| Malformed SQL | 400 `pg_error` with PG error in details |
| No PAT | 401 |
| Member-role PAT | 403 |
| Unknown ref | 404 |
| Paused project | 409 `project_not_runnable` |
| Empty body | 400 invalid_params |
| Query exceeding statement_timeout | 400 pg_error code `57014` (statement timeout) |

Wire-shape contract test (`apps/api/tests/contract/db-query.contract.test.ts`):
- Snapshot: request body schema accepts the exact upstream `V1RunQueryBody`
- Snapshot: response body for a known query matches the expected JSON shape byte-for-byte
- Cross-check: MCP server hitting this endpoint with a 1-row SELECT decodes successfully (live VM E2E)

Live-VM E2E (`tests/cli-e2e/db-query-dump.sh`):
- `supabase db query --linked "SELECT 1 as x"` → 1 row, exit 0
- `supabase db query --linked "SELECT * FROM information_schema.tables WHERE table_schema = 'public'"` → lists project tables
- Audit log row visible via `supabase db query "SELECT action, payload FROM audit_log ORDER BY id DESC LIMIT 1"`
