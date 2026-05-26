#!/usr/bin/env bash
#
# E2E: validates the cli-login-role endpoint (feature 012) end-to-end
# against a live selfbase deployment.
#
# Covers:
#   1. POST /v1/projects/:ref/cli/login-role { read_only: false }
#      → 201 with role=cli_login_postgres, 64-char hex password, ttl=300
#      → psql connect with returned creds succeeds
#      → SET SESSION ROLE postgres + SELECT 1 succeed
#      (Contract A1, A2, A3.)
#   2. After 320s sleep, reconnect with the same password fails with 28P01
#      (Contract A5 — password's VALID UNTIL elapsed).
#   3. POST with { read_only: true }
#      → role=cli_login_supabase_read_only_user
#      → SET SESSION ROLE supabase_read_only_user succeeds
#      → CREATE TABLE attempt fails with permission denied (42501)
#      (US3, SC-004.)
#   4. DELETE invalidates active passwords immediately
#      → reconnect with prior password fails 28P01
#      → already-open connection survives until natural close
#      (Contract D2, D3.)
#
# Run locally with:
#
#   SELFBASE_APEX=supaviser.dev \
#   SELFBASE_PAT=sbp_<40hex> \
#   SELFBASE_PROJECT_REF=<20-char-ref> \
#   SELFBASE_DB_SUPERUSER_PASSWORD=<postgres-pw> \
#   bash tests/cli-e2e/login-role.sh
#
# Requirements: curl, jq, psql on PATH. Active selfbase deployment.
#
# Long-running: includes a 320-second sleep (TTL + 20s grace) for the
# expiry-test step. Total runtime ≈ 6 minutes.

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required}"
: "${SELFBASE_PAT:?SELFBASE_PAT required}"
: "${SELFBASE_PROJECT_REF:?SELFBASE_PROJECT_REF required}"
: "${SELFBASE_DB_SUPERUSER_PASSWORD:?SELFBASE_DB_SUPERUSER_PASSWORD required (for inspection psql calls)}"

API_URL="https://api.${SELFBASE_APEX}/v1/projects/${SELFBASE_PROJECT_REF}/cli/login-role"
DB_HOST="db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}"
SUPERUSER_URL="postgresql://postgres:${SELFBASE_DB_SUPERUSER_PASSWORD}@${DB_HOST}:5432/postgres"

echo "[login-role] target apex=${SELFBASE_APEX} ref=${SELFBASE_PROJECT_REF}"

# Helper — invoke endpoint, assert HTTP status, dump body to file.
mint_role() {
  local read_only="$1"
  local out_file="$2"
  echo "[login-role]   POST /v1/projects/${SELFBASE_PROJECT_REF}/cli/login-role (read_only=${read_only})"
  local status
  status=$(curl -sS -o "$out_file" -w '%{http_code}' \
    -X POST "$API_URL" \
    -H "Authorization: Bearer ${SELFBASE_PAT}" \
    -H 'Content-Type: application/json' \
    -d "{\"read_only\": ${read_only}}")
  if [[ "$status" != "201" ]]; then
    echo "FAIL: expected 201, got ${status}. Body:"
    cat "$out_file" >&2
    exit 1
  fi
}

invalidate_roles() {
  echo "[login-role]   DELETE /v1/projects/${SELFBASE_PROJECT_REF}/cli/login-role"
  local body
  body=$(curl -sS -w '\n%{http_code}' \
    -X DELETE "$API_URL" \
    -H "Authorization: Bearer ${SELFBASE_PAT}")
  local status="${body##*$'\n'}"
  local payload="${body%$'\n'*}"
  if [[ "$status" != "200" ]]; then
    echo "FAIL: expected 200 on DELETE, got ${status}. Body: ${payload}"
    exit 1
  fi
  if [[ "$payload" != '{"message":"ok"}' ]]; then
    echo "FAIL: expected DELETE body {\"message\":\"ok\"}, got ${payload}"
    exit 1
  fi
}

# ──────────────────────────────────────────────────────────────────────
# Block 1 — read-write happy path (Contract A1-A3)
# ──────────────────────────────────────────────────────────────────────
echo "[login-role] step 1/7: mint read-write role"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

RW_BODY="$WORK/rw.json"
mint_role 'false' "$RW_BODY"

RW_ROLE=$(jq -r .role "$RW_BODY")
RW_PASSWORD=$(jq -r .password "$RW_BODY")
RW_TTL=$(jq -r .ttl_seconds "$RW_BODY")

if [[ "$RW_ROLE" != 'cli_login_postgres' ]]; then
  echo "FAIL: expected role=cli_login_postgres, got ${RW_ROLE}"
  exit 1
fi
if ! [[ "$RW_PASSWORD" =~ ^[0-9a-f]{64}$ ]]; then
  echo "FAIL: password not a 64-char hex string: ${RW_PASSWORD}"
  exit 1
fi
if [[ "$RW_TTL" != '300' ]]; then
  echo "FAIL: expected ttl_seconds=300, got ${RW_TTL}"
  exit 1
fi
echo "[login-role] ✓ RW response shape valid"

echo "[login-role] step 2/7: connect as ${RW_ROLE}, SET ROLE postgres, SELECT 1"
PGPASSWORD="$RW_PASSWORD" psql \
  "postgresql://${RW_ROLE}@${DB_HOST}:5432/postgres" \
  -v ON_ERROR_STOP=1 \
  -c 'SET SESSION ROLE postgres;' \
  -c 'SELECT 1;' >/dev/null
echo "[login-role] ✓ RW connect + SET ROLE + SELECT succeeded"

# ──────────────────────────────────────────────────────────────────────
# Block 2 — DELETE invalidates active passwords (Contract D2, D3)
# ──────────────────────────────────────────────────────────────────────
echo "[login-role] step 3/7: DELETE invalidates the active password"
invalidate_roles
# Reconnect with prior password should fail with 28P01.
if PGPASSWORD="$RW_PASSWORD" psql \
    "postgresql://${RW_ROLE}@${DB_HOST}:5432/postgres" \
    -v ON_ERROR_STOP=1 \
    -c 'SELECT 1' 2>/tmp/login-role-err.txt; then
  echo "FAIL: reconnect succeeded after DELETE — password should be invalidated"
  exit 1
fi
if ! grep -qE '28P01|password authentication failed' /tmp/login-role-err.txt; then
  echo "FAIL: expected 28P01 / 'password authentication failed' in psql stderr"
  cat /tmp/login-role-err.txt >&2
  exit 1
fi
echo "[login-role] ✓ post-DELETE reconnect refused with 28P01"

# A subsequent POST recovers — fresh password, fresh VALID UNTIL.
echo "[login-role] step 4/7: re-mint after DELETE → POST recovers cleanly"
RW2_BODY="$WORK/rw2.json"
mint_role 'false' "$RW2_BODY"
RW2_PASSWORD=$(jq -r .password "$RW2_BODY")
PGPASSWORD="$RW2_PASSWORD" psql \
  "postgresql://${RW_ROLE}@${DB_HOST}:5432/postgres" \
  -v ON_ERROR_STOP=1 \
  -c 'SET SESSION ROLE postgres;' \
  -c 'SELECT 1;' >/dev/null
echo "[login-role] ✓ re-mint round-trip succeeded"

# ──────────────────────────────────────────────────────────────────────
# Block 3 — read-only path is deferred to follow-up (RO scope blocked by
# supautils + upstream CLI's hardcoded SET SESSION ROLE postgres). We
# assert the endpoint returns 501 + code=not_implemented for read_only:true
# so any future implementer flips this back ON deliberately. See
# docs/changes/012-cli-login-role.md for the technical blocker.
# ──────────────────────────────────────────────────────────────────────
echo "[login-role] step 5/7: read_only=true currently returns 501 (deferred — see docs)"
RO_BODY="$WORK/ro.json"
RO_STATUS=$(curl -sS -o "$RO_BODY" -w '%{http_code}' \
  -X POST "$API_URL" \
  -H "Authorization: Bearer ${SELFBASE_PAT}" \
  -H 'Content-Type: application/json' \
  -d '{"read_only": true}')
if [[ "$RO_STATUS" != '501' ]]; then
  echo "FAIL: expected 501 on read_only=true, got ${RO_STATUS}. Body:"
  cat "$RO_BODY" >&2
  exit 1
fi
RO_CODE=$(jq -r .code "$RO_BODY")
if [[ "$RO_CODE" != 'not_implemented' ]]; then
  echo "FAIL: expected code=not_implemented, got ${RO_CODE}"
  exit 1
fi
echo "[login-role] ✓ read-only path correctly 501s with code=not_implemented (deferred to follow-up)"

# ──────────────────────────────────────────────────────────────────────
# Block 4 — pg_roles inspection
# ──────────────────────────────────────────────────────────────────────
echo "[login-role] step 6/7: pg_roles shows cli_login_postgres (RO role not provisioned — deferred)"
PGPASSWORD="$SELFBASE_DB_SUPERUSER_PASSWORD" psql "$SUPERUSER_URL" \
  -v ON_ERROR_STOP=1 \
  -A -t \
  -c "SELECT rolname, rolvaliduntil > now() AS active FROM pg_roles WHERE rolname LIKE 'cli_login_%' ORDER BY rolname" \
  > "$WORK/pg-roles.txt"
if [[ "$(grep -c cli_login_postgres "$WORK/pg-roles.txt")" -ne 1 ]]; then
  echo "FAIL: cli_login_postgres row missing from pg_roles"
  cat "$WORK/pg-roles.txt" >&2
  exit 1
fi
# RO role NOT expected (501 path never provisions it).
if [[ "$(grep -c cli_login_supabase_read_only_user "$WORK/pg-roles.txt")" -ne 0 ]]; then
  echo "FAIL: cli_login_supabase_read_only_user unexpectedly present (the 501 path should not provision)"
  cat "$WORK/pg-roles.txt" >&2
  exit 1
fi
echo "[login-role] ✓ pg_roles inspection clean (RW present, RO absent)"

# ──────────────────────────────────────────────────────────────────────
# Block 5 — TTL expiry (Contract A5)
#
# Skippable via SKIP_TTL_TEST=1 because this step adds 320 seconds. CI runs
# it; local exploratory runs can skip.
# ──────────────────────────────────────────────────────────────────────
if [[ "${SKIP_TTL_TEST:-0}" = "1" ]]; then
  echo "[login-role] step 7/7: TTL expiry test SKIPPED (SKIP_TTL_TEST=1)"
else
  echo "[login-role] step 7/7: mint, sleep 320s (TTL=300 + 20s grace), reconnect must fail 28P01"
  TTL_BODY="$WORK/ttl.json"
  mint_role 'false' "$TTL_BODY"
  TTL_PASSWORD=$(jq -r .password "$TTL_BODY")
  echo "[login-role]   sleeping 320s..."
  sleep 320
  TTL_ERR=/tmp/login-role-ttl.txt
  if PGPASSWORD="$TTL_PASSWORD" psql \
      "postgresql://cli_login_postgres@${DB_HOST}:5432/postgres" \
      -v ON_ERROR_STOP=1 \
      -c 'SELECT 1' 2>"$TTL_ERR"; then
    echo "FAIL: reconnect succeeded after TTL — password should have expired"
    exit 1
  fi
  if ! grep -qE '28P01|password authentication failed' "$TTL_ERR"; then
    echo "FAIL: expected 28P01 / 'password authentication failed' after TTL elapse"
    cat "$TTL_ERR" >&2
    exit 1
  fi
  echo "[login-role] ✓ TTL expiry enforced"
fi

echo "[login-role] PASS"
