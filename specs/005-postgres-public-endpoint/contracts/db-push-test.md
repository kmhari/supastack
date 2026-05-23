# Contract: tests/cli-e2e/db-push.sh

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

---

## Purpose

Validates that all supabase CLI database commands work against a live selfbase deployment
**without** the `--db-url` flag. This is the acceptance gate for SC-001 and SC-002.

---

## Required Environment Variables

```bash
SELFBASE_APEX=selfbase.example.com
SELFBASE_PAT=sbp_<40hex>
SELFBASE_PROJECT_REF=<20-char-ref>
SELFBASE_DB_PASSWORD=<postgres-password>
```

Optional:
```bash
SELFBASE_ANON_KEY=eyJ...   # defaults to "fake"
```

---

## Invocation

```bash
SELFBASE_APEX=... \
SELFBASE_PAT=... \
SELFBASE_PROJECT_REF=... \
SELFBASE_DB_PASSWORD=... \
bash tests/cli-e2e/db-push.sh
```

---

## Test Steps (in order)

### Step 1 — supabase login (reuse or establish)

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase login --profile "$WORK/selfbase.toml" --token "$SELFBASE_PAT"
```

Assert: exit 0.

### Step 2 — create throwaway migration

```bash
mkdir -p "$WORK/proj/supabase/migrations"
cat > "$WORK/proj/supabase/migrations/99999999000000_e2e_test.sql" << 'EOF'
CREATE TABLE IF NOT EXISTS _e2e_db_push_test (id serial PRIMARY KEY, created_at timestamptz DEFAULT now());
EOF
```

### Step 3 — supabase db push (primary acceptance gate)

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase --profile "$WORK/selfbase.toml" db push \
    --project-ref "$SELFBASE_PROJECT_REF"
```

Assert: exit 0. **No `--db-url` flag.** The CLI must resolve `db.<ref>.<apex>:5432` and connect successfully.

### Step 4 — supabase migration list

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase --profile "$WORK/selfbase.toml" migration list \
    --project-ref "$SELFBASE_PROJECT_REF"
```

Assert: exit 0. Output must include the migration name `99999999000000_e2e_db_push_test`.

### Step 5 — supabase db diff (no pending)

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase --profile "$WORK/selfbase.toml" db diff \
    --project-ref "$SELFBASE_PROJECT_REF"
```

Assert: exit 0. Output is empty or contains no unrecognized changes (migration was already applied in step 3).

### Step 6 — supabase db pull (schema dump)

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase --profile "$WORK/selfbase.toml" db pull \
    --project-ref "$SELFBASE_PROJECT_REF" \
    --schema public \
    -f "$WORK/schema.sql"
```

Assert: exit 0. `$WORK/schema.sql` must exist and contain `_e2e_db_push_test`.

### Step 7 — supabase inspect db (schema inspection)

```bash
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase --profile "$WORK/selfbase.toml" inspect db \
    --project-ref "$SELFBASE_PROJECT_REF"
```

Assert: exit 0.

### Step 8 — cleanup (rollback throwaway migration)

```bash
# Drop the test table via direct psql (using the password for cleanup only)
psql "postgresql://postgres:${SELFBASE_DB_PASSWORD}@db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}:5432/postgres" \
  -c "DROP TABLE IF EXISTS _e2e_db_push_test;"
```

Assert: exit 0. If psql is unavailable, skip gracefully with a warning.

---

## Exit Codes

- `0` — all steps passed
- `1` — any step failed; a `FAIL: [step description]` line is emitted to stdout before exit

---

## Requirements

- `supabase` CLI ≥ 2.72.7 on PATH
- `psql` on PATH (for cleanup step; gracefully skipped if absent)
- Valid selfbase profile at `$WORK/selfbase.toml` (written at step 1)
- Live selfbase deployment with wildcard cert and at least one provisioned project at `SELFBASE_PROJECT_REF`
- Port 5432 reachable from the runner at `db.<ref>.<apex>:5432` with a valid TLS cert
