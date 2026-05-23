# Phase 1: Quickstart

**Feature**: 006-mgmt-gen-types

Validation walkthrough for the four CLI surfaces against a fresh selfbase install. Run on the test VM (`ubuntu@148.113.1.164`) against the `huntvox` (ENZY) project unless noted.

## Prerequisites

- selfbase main branch deployed with feature 006 changes applied.
- One running project (`enzyxdtrbosuwjwzkmvl`).
- A PAT minted for the operator account (existing `connect-cli` flow).
- Local machine has the upstream `supabase` CLI ≥ v1.215.0 installed.
- `supabase link --project-ref enzyxdtrbosuwjwzkmvl` has been run locally, pointing the CLI at `https://supaviser.dev` (`SUPABASE_API_URL` env var set if needed).

## US1 — gen types

```bash
# From any project root with @supabase/supabase-js installed:
supabase gen types typescript --project-id enzyxdtrbosuwjwzkmvl --schema public > database.types.ts

# Verify
test -s database.types.ts                                    # non-empty
grep -q 'export type Database' database.types.ts             # has Database type
grep -q '_demo_tasks' database.types.ts                       # has our seed table
pnpm tsc --noEmit database.types.ts                          # compiles

# Multi-schema
supabase gen types typescript --project-id enzyxdtrbosuwjwzkmvl --schema public --schema auth > schemas.types.ts
grep -q 'public:' schemas.types.ts
grep -q 'auth:' schemas.types.ts
```

Expected: under 10s elapsed, TS compiles, both schemas present.

## US2 — migrations round-trip

```bash
# 1. List (fresh-ish project may have 0 or N migrations)
supabase migration list --linked

# 2. Create + push a new migration
mkdir -p supabase/migrations
printf "CREATE TABLE _demo_quickstart (id serial PRIMARY KEY, ts timestamptz default now());\n" \
  > supabase/migrations/20260523170000_demo_quickstart.sql
supabase migration up --linked
# verify
psql "postgresql://postgres.enzyxdtrbosuwjwzkmvl@pooler.supaviser.dev:6543/postgres?sslmode=require" \
  -c "SELECT version FROM supabase_migrations.schema_migrations WHERE version = '20260523170000';"
# expect: one row

# 3. Re-list
supabase migration list --linked
# expect: 20260523170000 shown Applied in both Local + Remote columns

# 4. Simulate drift
psql ".../postgres?sslmode=require" \
  -c "DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260523170000';"

# 5. Repair
supabase migration repair 20260523170000 --status applied --linked
# verify row is back
psql ".../postgres?sslmode=require" \
  -c "SELECT version, name FROM supabase_migrations.schema_migrations WHERE version = '20260523170000';"

# 6. Fetch
rm -rf supabase/migrations/20260523170000_*.sql
supabase migration fetch --linked
ls supabase/migrations/ | grep 20260523170000
# expect: file recreated

# 7. Cleanup
psql ".../postgres?sslmode=require" -c "DROP TABLE _demo_quickstart;"
supabase migration repair 20260523170000 --status reverted --linked
```

Expected: each step exits 0, final state matches initial.

## US3 — snippets list/download

```bash
# Precondition: create a snippet via Studio UI in the project.
# Studio URL: https://enzyxdtrbosuwjwzkmvl.supaviser.dev/project/default/sql
# Save a snippet titled "Quickstart probe" with body: SELECT 1;

# List
supabase snippets list
# expect: includes "Quickstart probe", with the snippet's UUID

# Download
SNIPPET_ID=$(supabase snippets list --output json | jq -r '.[] | select(.name=="Quickstart probe") | .id')
supabase snippets download $SNIPPET_ID > probe.sql
diff <(printf "SELECT 1;\n") probe.sql
# expect: no diff
```

Expected: list under 2s, download under 3s, body byte-identical to Studio.

## US4 — backups list/restore

> WARNING: this section restores the database; only run against a test project.

```bash
# Precondition: at least one COMPLETED backup exists. If not, take one:
curl -X POST -H "Authorization: Bearer $PAT" \
  https://supaviser.dev/api/v1/instances/enzyxdtrbosuwjwzkmvl/backups
# wait ~30s for backup job to complete

# 1. List
supabase backups list --project-ref enzyxdtrbosuwjwzkmvl
# expect: at least one COMPLETED entry

BACKUP_ID=$(supabase backups list --project-ref enzyxdtrbosuwjwzkmvl --output json \
  | jq -r '.backups[0].id')

# 2. Make a change we'll undo
psql "postgresql://postgres.enzyxdtrbosuwjwzkmvl@pooler.supaviser.dev:6543/postgres?sslmode=require" \
  -c "CREATE TABLE _will_be_lost (id int); INSERT INTO _will_be_lost VALUES (1);"
psql ".../postgres?sslmode=require" -c "SELECT count(*) FROM _will_be_lost;"
# expect: 1

# 3. Restore
supabase backups restore --project-ref enzyxdtrbosuwjwzkmvl --backup-id $BACKUP_ID
# expect: 202, restore_job_id printed

# 4. Poll status
while true; do
  STATUS=$(curl -s -H "Authorization: Bearer $PAT" \
    https://supaviser.dev/v1/projects/enzyxdtrbosuwjwzkmvl/database/backups/restore-status \
    | jq -r '.current.status')
  echo "status: $STATUS"
  [ "$STATUS" = "success" ] && break
  [ "$STATUS" = "failed" ] && exit 1
  sleep 10
done

# 5. Verify rollback to backup point
psql ".../postgres?sslmode=require" -c "SELECT count(*) FROM _will_be_lost;"
# expect: error — table doesn't exist (because backup was taken before its creation)
```

Expected: restore completes under 5 minutes for a typical ≤1GB database, post-restore state matches the snapshot.

## Negative tests (operator)

- `curl ... /v1/projects/UNKNOWN_REF/types/typescript -H "Authorization: Bearer $PAT"` → 404
- `curl ... /v1/projects/enzyxdtrbosuwjwzkmvl/types/typescript` (no auth) → 401
- `curl -X DELETE .../v1/projects/enzy.../database/migrations/abcde` → 400 `invalid_version_format`
- `curl -X POST -H "Authorization: Bearer $READER_PAT" .../v1/projects/enzy.../database/backups/restore-pitr -d '{...}'` → 403
- Two simultaneous `supabase backups restore` against the same project → second one gets 409 `restore_in_progress`

## Success — all green

- All four CLI command groups exit 0 on the happy paths.
- All negative tests return the expected error codes.
- No `not_implemented` errors anywhere along the way.
- Existing P0 + feature-005 CLI commands (`functions deploy`, `secrets set`, `db push`) still pass their own quickstart checks (re-run them as a regression smoke).
