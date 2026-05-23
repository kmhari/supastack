# Contract: `GET /v1/projects/<ref>/types/typescript`

Powers `supabase gen types typescript --project-id <ref>`.

## Request

```
GET /v1/projects/<ref>/types/typescript[?schemas=<name>&schemas=<name>...]
Authorization: Bearer <PAT>
```

| Param | Location | Required | Type | Default | Notes |
|---|---|---|---|---|---|
| `ref` | path | yes | 20-char lowercase ref | — | Project ref |
| `schemas` | query | no, repeatable | string | `public` | Schemas to introspect; multiple values aggregate |

## Response

### 200 OK
```json
{ "types": "export type Json = ...\n\nexport type Database = { public: { Tables: { ... } } }" }
```
Single key `types` whose value is a UTF-8 string of TypeScript source. Trailing newline preserved.

### 400 Bad Request
- `{ "error": { "code": "schema_not_found", "message": "Schema 'fakeschema' does not exist", "details": { "schemas_requested": ["fakeschema"], "schemas_available": ["public","auth"] } } }`

### 401 Unauthorized
- Missing or invalid PAT.

### 403 Forbidden
- PAT valid but caller has no access to this project.

### 404 Not Found
- Ref doesn't exist.

### 409 Conflict
- `{ "error": { "code": "project_not_running", "message": "Project is in state 'paused' — cannot introspect" } }`

### 502 Bad Gateway
- `pg-meta` unreachable. Includes `{ "error": { "code": "pg_meta_unreachable", "message": "...", "details": { "host": "host.docker.internal", "port": <port_meta> } } }`

## Behavior

1. Resolve project via `supabase_instances.ref`. 404 if missing.
2. Check status. 409 if not `running`.
3. Validate `schemas[]` against the project's actual `information_schema.schemata` (one cheap query). 400 on miss.
4. Call per-instance `pg-meta`: `GET http://host.docker.internal:<port_meta>/types/typescript?schemas=<csv>`.
5. Forward the response body wrapped in `{ types: <body> }`.

## Performance

- p50 < 2s, p95 < 10s for ≤100 tables (SC-001).
- No caching; types regenerate on each request (cheap relative to call rate from `tsc` builds).

## Observability

- Log: `level=info, event=mgmt.gen_types, ref, schemas, duration_ms`.
- No audit log (read-only).
- Metrics counter: `mgmt_api_gen_types_total{schema_count}`.

## Test cases

| # | Scenario | Expected |
|---|---|---|
| 1 | Happy path: 1 table in `public` | 200, body contains `Tables: { ... }` with the table |
| 2 | Empty `public` schema | 200, body has empty `Tables: {}` |
| 3 | `?schemas=public&schemas=auth` | 200, body has both schemas |
| 4 | `?schemas=fakeschema` | 400, `schema_not_found` |
| 5 | Unknown ref | 404 |
| 6 | Project paused | 409, `project_not_running` |
| 7 | Missing PAT | 401 |
| 8 | PAT for different org | 403 |
| 9 | `pg-meta` container down | 502, `pg_meta_unreachable` |
| 10 | Output passes `tsc --noEmit` with `@supabase/supabase-js` (full E2E) | TS compiles, types match `information_schema` |
