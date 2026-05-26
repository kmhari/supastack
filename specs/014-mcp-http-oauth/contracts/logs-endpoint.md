# Contract — `GET /v1/projects/:ref/analytics/endpoints/logs.all` (US4)

**Purpose**: Forwards a SQL-over-logs query to the per-project analytics (Logflare) container. Backs upstream MCP server's `get_logs` tool.

**Auth**: PAT or OAuth Bearer. RBAC: `audit.read` (existing action — broader than just logs, but matches the operator-trust level for log access).

## Request

```http
GET /v1/projects/<ref>/analytics/endpoints/logs.all?
  service=api
  &iso_timestamp_start=2026-05-26T05:00:00Z
  &iso_timestamp_end=2026-05-26T06:00:00Z
  &sql=<optional verbatim SQL>
Authorization: Bearer <PAT or OAuth JWT>
```

| Param | Required | Notes |
|---|---|---|
| `service` | No (default: derived from `sql` or `edge_logs`) | One of `api`, `postgres`, `edge-function`, `auth`, `storage`, `realtime`. Maps to a table per Decision 9. |
| `iso_timestamp_start` | No | Lower bound. Default = now - 1h. |
| `iso_timestamp_end` | No | Upper bound. Default = now. |
| `sql` | No | If supplied, used verbatim (Logflare's API parses + sandboxes). Else we construct `SELECT * FROM <service-table> WHERE timestamp BETWEEN $1 AND $2 ORDER BY timestamp DESC LIMIT 100`. |

## Response

```http
HTTP/1.1 200 OK
Content-Type: application/json

{
  "result": [
    {
      "timestamp": "2026-05-26T05:42:11.123Z",
      "event_message": "function execution complete",
      "metadata": { "status": "200", "duration_ms": 47 }
    },
    ...
  ]
}
```

Wire shape matches upstream `getLogs` handler's return shape (the upstream MCP server unwraps `result` and passes the rows on to the LLM).

## Validation rules

| Rule | Failure |
|---|---|
| `service` if present is in the allowed enum | 400 `invalid_params` |
| `iso_timestamp_*` are valid ISO 8601 if present | 400 `invalid_params` |
| `sql` if present is ≤4KB | 413 `payload_too_large` |
| Project status is `running` | 409 `project_not_runnable` |
| Per-project analytics container is reachable | 503 `analytics_unreachable` on TCP failure / timeout |

## Implementation flow

1. Auth check (existing PAT/OAuth bearer plugin).
2. RBAC check (`audit.read`).
3. Resolve instance row → confirm status `running`.
4. Decrypt `encryptedSecrets.logflareApiKey` via `loadMasterKey()`.
5. Construct query (verbatim `sql` OR `service` + time-range default).
6. `fetch('http://selfbase-<ref>-analytics-1:4000/api/endpoints/logs.all', { headers: { 'X-API-KEY': logflareApiKey }, body: { sql } })` (Logflare API).
7. Forward Logflare's JSON response under `result` field.

## Error responses

```json
{ "message": "service must be one of api, postgres, edge-function, auth, storage, realtime", "code": "invalid_params" }
```

```json
{ "message": "Cannot query logs — project status is 'paused'", "code": "project_not_runnable", "details": { "status": "paused" } }
```

```json
{ "message": "analytics container unreachable: connect ETIMEDOUT", "code": "analytics_unreachable" }
```

## Side effects

- On success: emit `instance.logs.queried` audit row with `{ ref, service?, sql_length, row_count }` — SQL text NOT logged (could be unbounded, mostly redundant given upstream MCP audits the tool call already)

## Test obligations

- Valid request with default service → 200 + rows array
- Verbatim SQL → forwarded to Logflare as-is
- Unknown service → 400 `invalid_params`
- Paused project → 409 `project_not_runnable`
- Analytics container down (mocked TCP failure) → 503 `analytics_unreachable`
- Member-role PAT (lacking `audit.read`) → 403
- No auth → 401
- Live-VM smoke: query api logs against a real running project → returns recent entries
