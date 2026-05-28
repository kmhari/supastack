# Feature 026 — `supabase config push` compatibility

**Closes**: Issue #12 (ssl-enforcement), Issue #26 (config push unblocking)
**Status**: shipped (on `main`)
**Context**: Feature 009 shipped `GET/PATCH /v1/projects/:ref/postgrest` and `GET/PATCH /v1/projects/:ref/config/auth`. CLI v2.72+ replaced those imperative knobs with declarative `supabase config push` reading `config.toml`. `config push` hits 3 additional endpoints that were still returning 501. This feature stubs or implements all three so the full push flow completes.

## What changed

| Method          | Path                                          | Step | What                                                                               |
| --------------- | --------------------------------------------- | ---- | ---------------------------------------------------------------------------------- |
| `GET`           | `/v1/projects/<ref>/billing/addons`           | 1    | Stub — honest empty arrays; selfbase has no addon concept                          |
| `GET/PUT/PATCH` | `/v1/projects/<ref>/config/database/postgres` | 3    | Real — applies Postgres GUCs via `ALTER SYSTEM SET` + `pg_reload_conf()`           |
| `GET/PUT`       | `/v1/projects/<ref>/ssl-enforcement`          | 4    | Real — flips `pg_hba.conf` `host` ↔ `hostssl` for external address ranges + reload |

Steps 2 (`GET/PATCH /v1/projects/:ref/postgrest`) was already live from feature 009.

## How each endpoint works

### billing/addons (step 1)

`supabase config push` reads this first to determine which Cloud add-ons (PITR, compute upgrades, etc.) are active. selfbase has none. The route returns `{ available_addons: [], selected_addons: [] }` — accurate and sufficient for the CLI to proceed.

### config/database/postgres (step 3)

Reads and writes Postgres GUC parameters (e.g. `max_connections`, `work_mem`, `log_min_duration_statement`).

```
GET → reads current GUC values via per-instance pg connection (SELECT current_setting)
      → falls back to encrypted snapshot in project_config_snapshots if instance is paused

PUT → validate body (PostgresConfigBodySchema)
    → connect to per-instance Postgres
    → ALTER SYSTEM SET <param> = <value> for each field
    → pg_reload_conf() — postmaster-context params also trigger container restart
    → UPSERT encrypted snapshot
    → return updated config
```

- `restart_database: true` in the request body or any postmaster-context param change triggers a container restart (`selfbase-<ref>-db-1`).
- Integer-valued params (`max_connections`, etc.) are cast to `int` before `ALTER SYSTEM SET` — Postgres rejects float-formatted values.
- New RBAC actions: `database_config.read` (members) / `database_config.write` (admins).
- Migration `0014_postgres_config_surface.sql` widens `project_config_snapshots.surface` check to include `'postgres'`.

### ssl-enforcement (step 4, closes #12)

Controls whether external TCP connections to the per-instance Postgres must negotiate TLS.

```
GET → read pg_hba.conf from inside the db container via composeExec
    → scan external address lines for host vs hostssl
    → return { currentConfig: { database: bool }, appliedSuccessfully: true }

PUT → read pg_hba.conf
    → rewriteExternalLines: flip host ↔ hostssl for lines matching external ranges
    → base64-encode updated content → write back via composeExec (avoids shell quoting)
    → SELECT pg_reload_conf() to apply without Postgres restart
    → return updated state
```

External address ranges managed (matches the supabase-template `pg_hba.conf`):

- RFC 1918 blocks: `10.x`, `172.16-31.x`, `192.168.x`
- `0.0.0.0/0` and `::0/0` catch-all lines

Lines not matching these patterns (local socket, loopback, replication) are left untouched.

**Note**: per-instance Postgres already terminates TLS via the wildcard cert mounted into the instance stack (feature 005). `ssl-enforcement` only controls whether TLS is _required_ — the cert is present regardless.

## Files

- New: `apps/api/src/routes/management/billing-addons.ts`
- New: `apps/api/src/routes/management/postgres-config.ts`
- New: `apps/api/src/routes/management/ssl-enforcement.ts`
- New: `apps/api/src/services/postgres-config-store.ts`
- New: `apps/api/src/services/ssl-enforcement-store.ts`
- New: `packages/db/migrations/0014_postgres_config_surface.sql`
- Edit: `packages/db/src/schema/project-config.ts` — `surface` enum widened to include `'postgres'`
- Edit: `packages/shared/src/rbac.ts` — `database_config.{read,write}` actions
- Edit: `apps/api/src/server.ts` — register 3 new route modules before `notImplementedRoutes`
- Tests: `apps/api/tests/unit/{billing-addons,postgres-config,ssl-enforcement}.test.ts` (32 tests total)
- Tests: `apps/api/tests/contract/rbac.test.ts` — 2 new action assertions

## Testing

32 unit tests across 3 new files:

- **billing-addons** (2): 200 with empty arrays, 404 for unknown ref
- **postgres-config** (19): Zod validation, field ranges, enum values, time-pattern formats, `POSTGRES_INTEGER_FIELDS` / `POSTGRES_BOOLEAN_FIELDS` / `PARAM_NAMES` invariants
- **ssl-enforcement** (11): `isSslEnforced`, `rewriteExternalLines` — enforce, un-enforce, idempotency, round-trip, mixed-state detection

## Operator notes

- `supabase config push` (CLI ≥ v2.72) now completes all 4 steps without a 501. Run against selfbase with a valid PAT.
- `ssl-enforcement` requires the db container to be running. GET against a paused project returns 500 `instance_not_running`.
- Postgres GUC changes that require a postmaster restart (e.g. `max_connections`) will restart the `selfbase-<ref>-db-1` container — a few seconds of downtime per project.
