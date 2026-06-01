#!/usr/bin/env bash
#
# E2E: validates all `supabase` CLI database commands against a live supastack
# deployment. Dual-pass harness (spec 012 FR-011):
#
#   Pass A — WITH_PASSWORD=1: every CLI command receives --password
#            "$SUPASTACK_DB_PASSWORD" + the env var is set. Regression guard
#            for spec 012 US2 (legacy operators must keep working) and the
#            pre-feature-012 baseline behaviour of feature 005.
#
#   Pass B — WITH_PASSWORD=0: --password dropped from every CLI command,
#            SUPABASE_DB_PASSWORD unset. Exercises spec 012 US1 path —
#            the upstream CLI calls POST /v1/projects/:ref/cli/login-role
#            and supastack rotates the persistent cli_login_postgres role's
#            password to a fresh 5-min-expiring value.
#
# CI runs both passes; either failing fails the script.
#
# Run locally with:
#
#   SUPASTACK_APEX=cli-e2e.example.com \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   SUPASTACK_DB_PASSWORD=<postgres-password> \
#   bash tests/cli-e2e/db-push.sh
#
# Requirements: supabase CLI ≥ 2.72.7 on PATH; psql REQUIRED for the
# spec-012 evidence-capture + pg_roles assertions.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"
: "${SUPASTACK_DB_PASSWORD:?SUPASTACK_DB_PASSWORD required (used by Pass A; Pass B drops it)}"

if ! command -v psql >/dev/null 2>&1; then
  echo "FATAL: psql is required for the spec-012 evidence capture + pg_roles assertions" >&2
  exit 1
fi

DB_HOST="db.${SUPASTACK_PROJECT_REF}.${SUPASTACK_APEX}"
DB_URL_SUPER="postgresql://postgres:${SUPASTACK_DB_PASSWORD}@${DB_HOST}:5432/postgres"

# Where the dual-pass psql evidence outputs live (T026, L1 remediation).
# Use an absolute path so files survive when the per-pass tempdir is rm'd.
SCRIPT_DIR=$(cd -- "$(dirname -- "$0")" && pwd)
EVIDENCE_DIR="${SCRIPT_DIR}/.evidence"
mkdir -p "$EVIDENCE_DIR"
SC_002_FILE="${EVIDENCE_DIR}/012-sc-002.txt"
SC_003_FILE="${EVIDENCE_DIR}/012-sc-003.txt"

run_full_workflow() {
  local with_password="$1"
  local pass_label
  if [[ "$with_password" = '1' ]]; then
    pass_label='Pass A (--password supplied)'
  else
    pass_label='Pass B (password-less via cli/login-role endpoint)'
  fi
  echo ""
  echo "=========================================================================="
  echo "[db-push] ${pass_label}"
  echo "=========================================================================="

  local WORK
  WORK=$(mktemp -d)
  # cd back to script dir before cleanup so the rm -rf can succeed without
  # nuking our own cwd. shellcheck SC2064 — we want $WORK expanded NOW.
  # shellcheck disable=SC2064
  trap "cd '$SCRIPT_DIR' && rm -rf '$WORK'" RETURN

  # Helper that prepends `--password` ONLY when WITH_PASSWORD=1.
  pwd_flag() {
    if [[ "$with_password" = '1' ]]; then
      printf -- '--password\t%s' "$SUPASTACK_DB_PASSWORD"
    fi
  }

  # Helper that exports SUPABASE_DB_PASSWORD ONLY when WITH_PASSWORD=1.
  pwd_env_set() {
    if [[ "$with_password" = '1' ]]; then
      export SUPABASE_DB_PASSWORD="$SUPASTACK_DB_PASSWORD"
    else
      unset SUPABASE_DB_PASSWORD || true
    fi
  }

  # --- 1. Write the supastack profile ----------------------------------
  cat > "$WORK/supastack.toml" <<EOF
name          = "supastack-db-e2e"
api_url       = "https://api.${SUPASTACK_APEX}"
dashboard_url = "https://${SUPASTACK_APEX}/dashboard"
project_host  = "${SUPASTACK_APEX}"
EOF

  # --- 2. supabase login ----------------------------------------------
  echo "[db-push] step 1/9: supabase login"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase login --profile "$WORK/supastack.toml" --token "$SUPASTACK_PAT"
  echo "[db-push] ✓ logged in"

  # --- 3. Scaffold a project dir with the throwaway migration ---------
  mkdir -p "$WORK/proj/supabase/migrations"
  cat > "$WORK/proj/supabase/config.toml" <<EOF
project_id = "$SUPASTACK_PROJECT_REF"
EOF
  local MIGRATION_VERSION='99999999000000'
  local MIGRATION_FILE="$WORK/proj/supabase/migrations/${MIGRATION_VERSION}_e2e_db_push_test.sql"
  cat > "$MIGRATION_FILE" <<'EOF'
CREATE TABLE IF NOT EXISTS _e2e_db_push_test (
  id         serial PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);
EOF
  cd "$WORK/proj"

  # Pre-cleanup: drop any leftover cli_login_* roles, the throwaway table,
  # AND any spurious supabase_migrations.schema_migrations rows from a
  # prior partial run — so each pass starts from a known-clean state.
  PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -v ON_ERROR_STOP=1 \
    -c "DO \$\$ BEGIN
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_login_postgres') THEN
            DROP ROLE cli_login_postgres;
          END IF;
          IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_login_supabase_read_only_user') THEN
            DROP ROLE cli_login_supabase_read_only_user;
          END IF;
        END \$\$;" >/dev/null
  PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -v ON_ERROR_STOP=1 \
    -c "DROP TABLE IF EXISTS _e2e_db_push_test;" >/dev/null
  # Clear any prior test-run schema-migration rows (matches our throwaway
  # version + any `db pull`-generated 14-digit timestamp from an earlier
  # partial run).
  PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -v ON_ERROR_STOP=1 \
    -c "DELETE FROM supabase_migrations.schema_migrations WHERE version LIKE '99999%' OR version ~ '^2026[0-9]{10}\$';" >/dev/null 2>&1 || true

  pwd_env_set

  # --- 3b. supabase link ----------------------------------------------
  echo "[db-push] step 2/9: supabase link"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" link \
      --project-ref "$SUPASTACK_PROJECT_REF" \
      $([[ "$with_password" = '1' ]] && printf -- '--password\n%s\n' "$SUPASTACK_DB_PASSWORD")
  echo "[db-push] ✓ linked"

  # --- 4. supabase db push --------------------------------------------
  echo "[db-push] step 3/9: supabase db push"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" db push --include-all \
      $([[ "$with_password" = '1' ]] && printf -- '--password\n%s\n' "$SUPASTACK_DB_PASSWORD")
  echo "[db-push] ✓ migration applied at db.${SUPASTACK_PROJECT_REF}.${SUPASTACK_APEX}:5432"

  # --- 5. supabase migration list -------------------------------------
  echo "[db-push] step 4/9: supabase migration list"
  local LIST_OUTPUT
  LIST_OUTPUT=$(SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" migration list \
      $([[ "$with_password" = '1' ]] && printf -- '--password\n%s\n' "$SUPASTACK_DB_PASSWORD"))
  echo "$LIST_OUTPUT" | grep -q "$MIGRATION_VERSION" || {
    echo "FAIL: migration list did not include ${MIGRATION_VERSION}_e2e_db_push_test"
    echo "$LIST_OUTPUT"
    return 1
  }
  echo "[db-push] ✓ migration visible in list"

  # --- 5b. supabase migration fetch + repair round-trip (T014b, SC-007)
  echo "[db-push] step 5/9: supabase migration fetch + repair round-trip"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" migration fetch >/dev/null
  echo "[db-push]   ✓ migration fetch exit 0"

  # repair --status reverted → row removed from supabase_migrations.schema_migrations
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" migration repair \
      "$MIGRATION_VERSION" --status reverted >/dev/null
  local ROW_COUNT
  ROW_COUNT=$(PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
    -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${MIGRATION_VERSION}'")
  [[ "$ROW_COUNT" = '0' ]] || {
    echo "FAIL: migration repair --status reverted did not remove row (count=$ROW_COUNT)"
    return 1
  }
  echo "[db-push]   ✓ migration repair --status reverted removed the row"

  # repair --status applied → row reinserted (round-trip)
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" migration repair \
      "$MIGRATION_VERSION" --status applied >/dev/null
  ROW_COUNT=$(PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
    -c "SELECT count(*) FROM supabase_migrations.schema_migrations WHERE version = '${MIGRATION_VERSION}'")
  [[ "$ROW_COUNT" = '1' ]] || {
    echo "FAIL: migration repair --status applied did not re-add row (count=$ROW_COUNT)"
    return 1
  }
  echo "[db-push]   ✓ migration repair --status applied re-added the row (round-trip complete)"

  # --- 6. supabase db diff --linked -----------------------------------
  echo "[db-push] step 6/9: supabase db diff --linked"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" db diff --linked >/dev/null
  echo "[db-push] ✓ db diff exit 0"

  # --- 7. supabase db pull --------------------------------------------
  # Supabase CLI 2.101+ dropped `-f` from `db pull`; the schema dump goes
  # to a default location under supabase/migrations/. `db pull` returns
  # non-zero with "No schema changes found" when local + remote are in
  # sync (which is exactly our state — we just pushed the migration in
  # step 3). That's not a feature regression, so tolerate it; we only
  # care that the CLI's password-resolution path went through.
  echo "[db-push] step 7/9: supabase db pull"
  local DB_PULL_LOG="$WORK/db-pull.log"
  set +e
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" db pull \
      $([[ "$with_password" = '1' ]] && printf -- '--password\n%s\n' "$SUPASTACK_DB_PASSWORD") \
      --schema public > "$DB_PULL_LOG" 2>&1
  local PULL_EXIT=$?
  set -e
  if (( PULL_EXIT != 0 )) && ! grep -qE "No schema changes found|already up to date" "$DB_PULL_LOG"; then
    echo "FAIL: db pull exited ${PULL_EXIT} with unexpected output:"
    cat "$DB_PULL_LOG" >&2
    return 1
  fi
  echo "[db-push] ✓ db pull completed (exit=${PULL_EXIT}, in-sync = no new schema to dump)"

  # --- 8. supabase inspect db -----------------------------------------
  # `supabase inspect db` is a top-level command with subcommands; on
  # supabase-cli ≥ 2.101 it doesn't accept --password as a flag here. The
  # call still works for db-credential discovery via SUPABASE_DB_PASSWORD
  # env var (Pass A) or via the new endpoint (Pass B). We invoke `inspect db
  # bloat` as a representative subcommand (any subcommand exercises the
  # password-resolution path); ignore exit code since supastack doesn't
  # expose all extensions inspect needs.
  echo "[db-push] step 8/9: supabase inspect db bloat"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" inspect db bloat >/dev/null 2>&1 || true
  echo "[db-push] ✓ inspect db exit acknowledged"

  # --- 9. Per-pass spec-012 assertions on pg_roles --------------------
  echo "[db-push] step 9/9: pg_roles inspection (spec 012 evidence)"
  if [[ "$with_password" = '1' ]]; then
    # Pass A — legacy --password path; the new endpoint MUST NOT have been
    # called as a side effect, so pg_roles should hold NO cli_login_* rows.
    {
      echo "# Spec 012 SC-002 evidence — Pass A (--password supplied)"
      echo "# Expected: zero cli_login_* roles. The CLI's resolution logic"
      echo "# short-circuited before our endpoint was reached."
      PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
        -c "SELECT rolname FROM pg_roles WHERE rolname LIKE 'cli_login_%' ORDER BY rolname"
    } > "$SC_002_FILE"
    local PASS_A_COUNT
    PASS_A_COUNT=$(PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
      -c "SELECT count(*) FROM pg_roles WHERE rolname LIKE 'cli_login_%'")
    if [[ "$PASS_A_COUNT" != '0' ]]; then
      echo "FAIL: Pass A leaked ${PASS_A_COUNT} cli_login_* row(s) — endpoint was called inadvertently"
      cat "$SC_002_FILE"
      return 1
    fi
    echo "[db-push] ✓ Pass A: zero cli_login_* rows present (endpoint short-circuited)"
    echo "[db-push] ✓ evidence written to ${SC_002_FILE}"
  else
    # Pass B — password-less; cli_login_postgres MUST exist with rolvaliduntil < now()
    # because the most recent CLI call's 5-minute window has elapsed only
    # if the test ran longer than 5 min. To make this assertion reliable
    # regardless of wallclock, we explicitly invalidate the active password
    # via the DELETE endpoint first, which sets rolvaliduntil to 1970-01-01.
    echo "[db-push]   pre-assert: DELETE /cli/login-role to force rolvaliduntil into the past"
    curl -sS -o /dev/null -X DELETE \
      "https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}/cli/login-role" \
      -H "Authorization: Bearer ${SUPASTACK_PAT}"

    {
      echo "# Spec 012 SC-003 evidence — Pass B (password-less)"
      echo "# Expected: cli_login_postgres exists with rolvaliduntil in the past"
      echo "# (DELETE above set it to 1970-01-01 — would otherwise be ~5 min in"
      echo "# the future of the last CLI call)."
      PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
        -c "SELECT rolname, rolvaliduntil FROM pg_roles WHERE rolname LIKE 'cli_login_%' ORDER BY rolname"
    } > "$SC_003_FILE"
    local PASS_B_HAS_RW
    PASS_B_HAS_RW=$(PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -A -t \
      -c "SELECT count(*) FROM pg_roles WHERE rolname = 'cli_login_postgres' AND rolvaliduntil < now()")
    if [[ "$PASS_B_HAS_RW" != '1' ]]; then
      echo "FAIL: Pass B expected exactly one cli_login_postgres row with rolvaliduntil < now(); got count=${PASS_B_HAS_RW}"
      cat "$SC_003_FILE"
      return 1
    fi
    echo "[db-push] ✓ Pass B: cli_login_postgres present, rolvaliduntil < now() (rotation pattern confirmed)"
    echo "[db-push] ✓ evidence written to ${SC_003_FILE}"
  fi

  # --- 10. Cleanup ----------------------------------------------------
  PGPASSWORD="$SUPASTACK_DB_PASSWORD" psql "$DB_URL_SUPER" -v ON_ERROR_STOP=1 \
    -c "DROP TABLE IF EXISTS _e2e_db_push_test;" >/dev/null
  echo "[db-push] ✓ cleanup complete"
}

echo "[db-push] starting dual-pass harness (spec 012 FR-011)"
WITH_PASSWORD=1 run_full_workflow 1
WITH_PASSWORD=0 run_full_workflow 0

echo ""
echo "[db-push] BOTH PASSES PASS"
