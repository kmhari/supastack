# Contract: `/v1/projects/<ref>/database/migrations[/...]`

Powers `supabase migration list/repair/fetch`. (`up` already works via feature 005's pooler.)

## Endpoints

```
GET    /v1/projects/<ref>/database/migrations
POST   /v1/projects/<ref>/database/migrations/upsert
DELETE /v1/projects/<ref>/database/migrations/<version>
```

All require `Authorization: Bearer <PAT>` and a `running` project.

---

## `GET /database/migrations`

### Response 200
```json
{
  "migrations": [
    { "version": "20260520120000", "name": "add_users_table", "statements": ["CREATE TABLE users ..."] },
    { "version": "20260521093015", "name": null, "statements": null }
  ]
}
```
Array ordered by `version` ascending. `name` and `statements` may be `null` for legacy rows (e.g., applied by `supabase db reset` before the columns existed).

### Behavior
1. Resolve project. 404 / 409 as standard.
2. Connect to per-instance PG via `per-instance-pg.ts` helper.
3. `CREATE SCHEMA IF NOT EXISTS supabase_migrations; CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text, statements text[])` — lazy bootstrap per Decision 3.
4. `SELECT version, name, statements FROM supabase_migrations.schema_migrations ORDER BY version ASC`.
5. Return wrapped in `{ migrations: [...] }`.

---

## `POST /database/migrations/upsert`

### Request
```json
{ "version": "20260520120000", "name": "add_users_table", "statements": ["CREATE TABLE users ..."] }
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `version` | string matching `^\d{14}$` | yes | YYYYMMDDHHmmss |
| `name` | string | no | |
| `statements` | string[] | no | |

### Response 200
```json
{ "version": "20260520120000", "name": "add_users_table", "statements": ["..."] }
```

### Response 400
- `{ "error": { "code": "invalid_version_format", "message": "version must match ^\\d{14}$", "details": { "received": "abc" } } }`

### Behavior
1. Validate `version` format. 400 on miss.
2. Resolve project. 404 / 409 as standard.
3. Lazy bootstrap as above.
4. `INSERT ... ON CONFLICT (version) DO UPDATE SET name = EXCLUDED.name, statements = EXCLUDED.statements`.
5. Emit audit log `mgmt_api.migration.upsert` with `{ version, prior_value_existed }`.
6. Return the upserted row.

---

## `DELETE /database/migrations/<version>`

### Response 200
```json
{ "version": "20260520120000", "deleted": true }
```
Idempotent: returns `deleted: false` if the version didn't exist.

### Behavior
1. Validate version format. 400 on miss.
2. Resolve project. 404 / 409 as standard.
3. Lazy bootstrap.
4. `DELETE FROM supabase_migrations.schema_migrations WHERE version = $1 RETURNING version`.
5. Emit audit log `mgmt_api.migration.delete` with `{ version, deleted }`.
6. Return outcome.

---

## Cross-cutting

### Errors
Standard envelope. Common codes: `invalid_version_format`, `project_not_running`, `not_found` (unknown ref), `forbidden`.

### Performance
- `GET`: <5s for ≤500 rows (SC-004). Effectively bounded by network RTT + small PG query.
- `POST/DELETE`: <500ms.

### Concurrency
- Two `POST upsert` for the same version: PG's `ON CONFLICT` handles the race; one wins, the other's UPDATE clause overrides — both return 200.
- No advisory locks needed at this layer; the CLI's `migration up` flow uses its own lock against `schema_migrations` which works through this endpoint transparently.

### Test cases
| # | Scenario | Expected |
|---|---|---|
| 1 | List on a project with 0 migrations | 200, `{ migrations: [] }` |
| 2 | List on a project with `supabase_migrations` schema missing | 200, `{ migrations: [] }`, schema created |
| 3 | Upsert valid new version | 200, row inserted |
| 4 | Upsert existing version (idempotent) | 200, row updated; second call no-op equivalent |
| 5 | Upsert with bad version `123` | 400, `invalid_version_format` |
| 6 | Delete existing version | 200, `deleted: true` |
| 7 | Delete non-existent version | 200, `deleted: false` |
| 8 | List after upsert + delete round-trip | shows current truth |
| 9 | Unknown ref / paused project / missing PAT / wrong org | 404/409/401/403 as standard |
| 10 | E2E: `migration up` → `migration list` → drift → `migration repair` → `migration list` | round-trip green |
