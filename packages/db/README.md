# @supastack/db

Drizzle schema + idempotent migration runner + transactional port allocator
for supastack.

## Schema

9 tables. See `specs/001-supastack-supabase-platform/data-model.md` for the
authoritative definition.

- `org` — singleton (enforced by a partial unique index over the constant `1`)
- `users`, `org_members`, `invites`, `api_tokens`, `setup_state`
- `supabase_instances`, `port_allocations`
- `backups`
- `audit_log`

## Migrations

Hand-written idempotent SQL in `migrations/*.sql`. The runner in `src/migrate.ts`
applies them in lexicographic order, plus:

1. Installs the `citext` and `pgcrypto` extensions (idempotent).
2. Adds the `org_singleton` partial unique index (constant-expression indexes
   aren't auto-generatable by drizzle-kit).

`migrate(DATABASE_URL)` is called at API/worker boot. Safe to re-run any
number of times.

## Port allocator

`allocatePorts(db, instanceRef, opts)` atomically selects 5 free ports from
a configured range (default 30000–39999) and inserts them into
`port_allocations` inside a single transaction held by a `pg_advisory_xact_lock`.
Conflicts (concurrent allocators) retry up to 8 times.

Anti-SupaConsole/Multibase: never `Date.now() % N`. The `port` column's
PRIMARY KEY guarantees no two instances ever share a port.

## Tests

The port-allocator integration test needs a real Postgres. Set
`TEST_DATABASE_URL=postgres://...` to enable.

```sh
TEST_DATABASE_URL=postgres://localhost/scratch pnpm --filter @supastack/db test
```
