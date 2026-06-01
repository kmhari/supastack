# Data Model: Feature 016 — MCP Post-Ship Hardening

## No new database entities

Feature 016 introduces no new tables, columns, or schema changes. All four user stories operate on existing entities or the filesystem.

---

## Affected entities (existing, read-only impact)

### `supabase_instances` (existing)

Used by:
- **US1**: read `portDbDirect`, `portPostgres`, `encryptedSecrets` to connect to per-project Postgres and set statement_timeout.
- **US3**: read `ref`, `status` for all non-deleted instances to drive the Kong analytics patch loop. Only instances with `status IN ('running', 'failed', 'provisioning')` (i.e. not `paused`/`stopped`/`deleted`) get their Kong container restarted.

No mutations to `supabase_instances` from this feature.

### Filesystem state (per-project)

**Kong analytics block** (managed by US3):

```
/var/supastack/instances/<ref>/volumes/api/kong.yml
  └── analytics-v1-api service block (lines ~312-318)
        state: commented (needs patch) | uncommented (already patched)
```

State transitions:
- `commented` → `uncommented`: patch applied, `docker restart supastack-<ref>-kong-1`
- `uncommented` → no-op: idempotent, no restart

**Template file** (managed by US3, new projects):

```
infra/supabase-template/volumes/api/kong.yml
  └── analytics-v1-api service block
        target state: uncommented (after PR merges)
```

---

## Configuration / code-level entities (not persisted)

### `DEFERRED_TOOLS` constant (US2)

A `Set<string>` of tool names to exclude from `tools/list`. Lives in `apps/mcp/src/server.ts` as a module-level constant. Not persisted — pure runtime filtering.

### `statement_timeout` GUC value (US1)

`8000` (milliseconds). Set as a database-level GUC via `ALTER DATABASE postgres SET statement_timeout = 8000`. Stored in per-project Postgres's `pg_db_role_setting` system catalog. No supastack DB change.
