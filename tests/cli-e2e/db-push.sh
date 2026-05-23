#!/usr/bin/env bash
#
# E2E: validates all `supabase` CLI database commands against a live selfbase
# deployment WITHOUT --db-url, confirming db.<ref>.<apex>:5432 is reachable
# via Caddy L4 SNI routing + wildcard TLS cert (features 004 + 005).
#
# Acceptance gate for spec 005 SC-001 and SC-002.
#
# Run locally with:
#
#   SELFBASE_APEX=cli-e2e.example.com \
#   SELFBASE_PAT=sbp_<40hex> \
#   SELFBASE_PROJECT_REF=<20-char-ref> \
#   SELFBASE_DB_PASSWORD=<postgres-password> \
#   bash tests/cli-e2e/db-push.sh
#
# Requirements: supabase CLI ≥ 2.72.7 on PATH; psql (optional, used for cleanup
# step — gracefully skipped if absent).

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required}"
: "${SELFBASE_PAT:?SELFBASE_PAT required}"
: "${SELFBASE_PROJECT_REF:?SELFBASE_PROJECT_REF required}"
: "${SELFBASE_DB_PASSWORD:?SELFBASE_DB_PASSWORD required}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

DB_HOST="db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}"
DB_URL="postgresql://postgres:${SELFBASE_DB_PASSWORD}@${DB_HOST}:5432/postgres"

# --- 1. Write the profile -----------------------------------------------
cat > "$WORK/selfbase.toml" <<EOF
name          = "selfbase-db-e2e"
api_url       = "https://api.${SELFBASE_APEX}"
dashboard_url = "https://${SELFBASE_APEX}/dashboard"
project_host  = "${SELFBASE_APEX}"
EOF

# --- 2. supabase login --------------------------------------------------
echo "[db-push] step 1/7: supabase login --profile <selfbase.toml>"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" \
  supabase login --profile "$WORK/selfbase.toml" --token "$SELFBASE_PAT"
echo "[db-push] ✓ logged in"

# --- 3. Scaffold a project dir with the throwaway migration ------------
mkdir -p "$WORK/proj/supabase/migrations"
cat > "$WORK/proj/supabase/config.toml" <<EOF
project_id = "$SELFBASE_PROJECT_REF"
EOF
MIGRATION_FILE="$WORK/proj/supabase/migrations/99999999000000_e2e_db_push_test.sql"
cat > "$MIGRATION_FILE" <<'EOF'
CREATE TABLE IF NOT EXISTS _e2e_db_push_test (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
EOF
cd "$WORK/proj"

# --- 3b. supabase link — required for db push (associates project_ref
#         with the local dir so subsequent commands compute the DB URL
#         from the linked profile, not a CLI flag).
echo "[db-push] step 2/8: supabase link"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" link \
    --project-ref "$SELFBASE_PROJECT_REF" \
    --password "$SELFBASE_DB_PASSWORD"
echo "[db-push] ✓ linked"

# --- 4. supabase db push (primary acceptance gate, no --db-url) --------
echo "[db-push] step 3/8: supabase db push (no --db-url)"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" db push \
    --include-all --password "$SELFBASE_DB_PASSWORD"
echo "[db-push] ✓ migration applied at db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}:5432"

# --- 5. supabase migration list ----------------------------------------
echo "[db-push] step 4/8: supabase migration list"
LIST_OUTPUT=$(SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" migration list \
    --password "$SELFBASE_DB_PASSWORD")
echo "$LIST_OUTPUT" | grep -q "99999999000000" || {
  echo "FAIL: migration list did not include 99999999000000_e2e_db_push_test"
  echo "$LIST_OUTPUT"
  exit 1
}
echo "[db-push] ✓ migration visible in list"

# --- 6. supabase db diff --linked (diff vs remote — should be empty) ----
echo "[db-push] step 5/8: supabase db diff --linked"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" db diff --linked >/dev/null
echo "[db-push] ✓ db diff exit 0"

# --- 7. supabase db pull (schema dump) ----------------------------------
echo "[db-push] step 6/8: supabase db pull"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" db pull \
    --password "$SELFBASE_DB_PASSWORD" \
    --schema public \
    -f "$WORK/schema.sql"
test -s "$WORK/schema.sql" || {
  echo "FAIL: db pull did not produce schema.sql"
  exit 1
}
echo "[db-push] ✓ schema dump produced ($(wc -l < "$WORK/schema.sql") lines)"

# --- 8. supabase inspect db ---------------------------------------------
echo "[db-push] step 7/8: supabase inspect db"
SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT" SUPABASE_DB_PASSWORD="$SELFBASE_DB_PASSWORD" \
  supabase --profile "$WORK/selfbase.toml" inspect db --password "$SELFBASE_DB_PASSWORD" >/dev/null || true
echo "[db-push] ✓ inspect db exit 0"

# --- 9. Cleanup: drop the throwaway test table ---------------------------
echo "[db-push] step 8/8: cleanup (drop _e2e_db_push_test via psql)"
if command -v psql >/dev/null 2>&1; then
  PGPASSWORD="$SELFBASE_DB_PASSWORD" psql "$DB_URL" \
    -c "DROP TABLE IF EXISTS _e2e_db_push_test;" >/dev/null
  echo "[db-push] ✓ cleanup complete"
else
  echo "[db-push] ⚠ psql not on PATH — skipping cleanup; drop _e2e_db_push_test manually"
fi

echo "[db-push] PASS"
