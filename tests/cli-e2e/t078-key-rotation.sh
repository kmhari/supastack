#!/usr/bin/env bash
#
# T078: Master key rotation end-to-end validation.
#
# Proves the full rotation procedure works on the test VM:
#   1. Read old key from VM .env
#   2. Generate a new key
#   3. Dry-run re-key tool → assert "DRY-RUN complete"
#   4. Live re-key tool    → assert "COMMITTED"
#   5. Swap MASTER_KEY in VM .env
#   6. Restart api + worker
#   7. Poll /v1/profile until 200 (api recovered with new key)
#   8. GET /v1/projects/:ref/api-keys → assert anon_key + service_role_key present
#   9. POST /v1/projects/:ref/pause   → poll until INACTIVE
#  10. POST /v1/projects/:ref/restore → poll until ACTIVE_HEALTHY
#  11. GET project kong /health       → assert not 502/503
#  12. Print [T078] PASS with timestamps → exit 0
#
# Usage:
#   SELFBASE_APEX=supaviser.dev \
#   SELFBASE_PAT='<operator PAT>' \
#   SELFBASE_TEST_PROJECT_REF='<project ref>' \
#   DATABASE_URL='postgres://...' \
#   bash tests/cli-e2e/t078-key-rotation.sh
#
# Optional:
#   SELFBASE_VM_USER=ubuntu  (default: ubuntu)
#
# Requirements: curl, jq, openssl, ssh (key-based auth to SELFBASE_VM_USER@SELFBASE_APEX)
# Duration: ~5 minutes
# Closes: issue #54 T078 (feature 014)

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required (e.g. supaviser.dev)}"
: "${SELFBASE_PAT:?SELFBASE_PAT required — operator Personal Access Token}"
: "${SELFBASE_TEST_PROJECT_REF:?SELFBASE_TEST_PROJECT_REF required — ref of a running project}"
: "${DATABASE_URL:?DATABASE_URL required — control-plane Postgres connection string}"
SELFBASE_VM_USER="${SELFBASE_VM_USER:-ubuntu}"

API="https://api.${SELFBASE_APEX}"
VM="${SELFBASE_VM_USER}@${SELFBASE_APEX}"
RUN_START=$(date +%s)

_step() {
  local name="$1" status="$2"
  local elapsed=$(( $(date +%s) - RUN_START ))
  echo "[T078] STEP: ${name} | STATUS: ${status} | ELAPSED: ${elapsed}s"
}

_fail() {
  local reason="$1" step="$2" status="${3:-n/a}" body="${4:-}"
  echo "[T078] FAIL: ${reason} | step: ${step} | status: ${status} | body: ${body:0:300}"
  exit 1
}

# ── Step 1: Read old key + generate new key ───────────────────────────────────
# OLD_MASTER_KEY env var takes precedence; falls back to reading from VM .env
if [[ -n "${OLD_MASTER_KEY:-}" ]]; then
  OLD_KEY="$OLD_MASTER_KEY"
else
  OLD_KEY=$(ssh "$VM" "sudo docker exec selfbase-api-1 printenv MASTER_KEY" 2>/dev/null)
fi
[[ -n "$OLD_KEY" ]] || _fail "could_not_read_old_key" "step1_key_generation"
NEW_KEY=$(openssl rand -hex 32)
[[ ${#NEW_KEY} -eq 64 ]] || _fail "new_key_generation_failed" "step1_key_generation"
_step "key_generation" "ok"

# ── Step 2: Dry-run ───────────────────────────────────────────────────────────
# Run inside the api container where the pg npm package is available.
ssh "$VM" "sudo docker cp /opt/selfbase/scripts/rekey-master.mjs selfbase-api-1:/app/packages/db/rekey-master.mjs" 2>/dev/null
DRYRUN_OUT=$(ssh "$VM" \
  "sudo docker exec \
     -e DRY_RUN=1 \
     -e OLD_MASTER_KEY='${OLD_KEY}' \
     -e NEW_MASTER_KEY='${NEW_KEY}' \
     -e DATABASE_URL='${DATABASE_URL}' \
     selfbase-api-1 node /app/packages/db/rekey-master.mjs" 2>&1)
echo "$DRYRUN_OUT" | grep -q 'DRY-RUN complete' || \
  _fail "dry_run_did_not_complete" "step2_dry_run" "" "$DRYRUN_OUT"
DRYRUN_ROWS=$(echo "$DRYRUN_OUT" | grep 'row(s) re-encrypted' | awk '{sum+=$3} END {print sum+0}' || echo 0)
_step "dry_run" "ok (${DRYRUN_ROWS:-?} rows would rotate)"

# ── Step 3: Live re-key ────────────────────────────────────────────────────────
REKEY_OUT=$(ssh "$VM" \
  "sudo docker exec \
     -e OLD_MASTER_KEY='${OLD_KEY}' \
     -e NEW_MASTER_KEY='${NEW_KEY}' \
     -e DATABASE_URL='${DATABASE_URL}' \
     selfbase-api-1 node /app/packages/db/rekey-master.mjs" 2>&1)
COMMITTED_LINE=$(echo "$REKEY_OUT" | grep 'COMMITTED')
[[ -n "$COMMITTED_LINE" ]] || \
  _fail "rekey_not_committed" "step3_live_rekey" "" "$REKEY_OUT"
_step "rekey_committed" "ok"
echo "  ${COMMITTED_LINE}"

# ── Step 4+5: Recreate api + worker with new MASTER_KEY ──────────────────────
# MASTER_KEY lives in the ubuntu user's shell env (no infra/.env file).
# Build a minimal env file on the VM to satisfy docker compose validation;
# only api + worker are actually recreated (--no-deps).
# CONTROL_DB_PASSWORD is extracted from DATABASE_URL (password field).
CTRL_DB_PASS=$(echo "$DATABASE_URL" | sed -E 's|.*://[^:]+:([^@]+)@.*|\1|')
RECREATE_OUT=$(ssh "$VM" bash -s -- "${NEW_KEY}" "${SELFBASE_APEX}" "${CTRL_DB_PASS}" << 'SSHEOF'
NEW_KEY="$1"; APEX="$2"; CTRL_PASS="$3"
TMPENV=$(mktemp)
# Generate placeholders for vars not needed by api/worker but required for compose validation
SESSION_SECRET=$(openssl rand -hex 32)
SUPAVISOR_API_JWT_SECRET=$(openssl rand -hex 32)
SUPAVISOR_SECRET_KEY_BASE=$(openssl rand -hex 32)
SUPAVISOR_VAULT_ENC_KEY=$(openssl rand -hex 32)
cat > "$TMPENV" <<EOF
MASTER_KEY=${NEW_KEY}
SELFBASE_APEX=${APEX}
CONTROL_DB_PASSWORD=${CTRL_PASS}
SESSION_SECRET=${SESSION_SECRET}
SUPAVISOR_API_JWT_SECRET=${SUPAVISOR_API_JWT_SECRET}
SUPAVISOR_SECRET_KEY_BASE=${SUPAVISOR_SECRET_KEY_BASE}
SUPAVISOR_VAULT_ENC_KEY=${SUPAVISOR_VAULT_ENC_KEY}
EOF
chmod 600 "$TMPENV"
sudo docker compose -f /opt/selfbase/infra/docker-compose.yml --env-file "$TMPENV" \
  up -d --force-recreate --no-deps api worker
EXIT=$?
rm -f "$TMPENV"
exit $EXIT
SSHEOF
) || _fail "recreate_failed" "step4_recreate" "" "$RECREATE_OUT"
_step "key_swap_and_restart" "ok"

# ── Step 6: Poll /v1/profile until 200 ────────────────────────────────────────
for i in $(seq 1 12); do
  HTTP=$(curl -sk "${API}/v1/profile" \
    -H "Authorization: Bearer ${SELFBASE_PAT}" \
    -o /dev/null -w '%{http_code}')
  [[ "$HTTP" == "200" ]] && break
  sleep 5
  [[ $i -eq 12 ]] && _fail "api_did_not_recover" "step6_health" "$HTTP"
done
_step "api_health" "200"

# ── Step 7: api-keys check ────────────────────────────────────────────────────
APIKEYS_RES=$(curl -sk "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}/api-keys" \
  -H "Authorization: Bearer ${SELFBASE_PAT}")
ANON_KEY=$(echo "$APIKEYS_RES" | jq -r '.[] | select(.name=="anon") | .api_key // empty' 2>/dev/null)
SVC_KEY=$(echo "$APIKEYS_RES" | jq -r '.[] | select(.name=="service_role") | .api_key // empty' 2>/dev/null)
[[ -n "$ANON_KEY" && -n "$SVC_KEY" ]] || \
  _fail "api_keys_decrypt_failed" "step7_api_keys" "" "$APIKEYS_RES"
_step "api_keys" "ok"

# ── Step 8: Pause project ─────────────────────────────────────────────────────
curl -sk -X POST "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}/pause" \
  -H "Authorization: Bearer ${SELFBASE_PAT}" -o /dev/null
for i in $(seq 1 12); do
  STATUS=$(curl -sk "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}" \
    -H "Authorization: Bearer ${SELFBASE_PAT}" | jq -r '.status')
  [[ "$STATUS" == "INACTIVE" ]] && break
  sleep 5
  [[ $i -eq 12 ]] && _fail "pause_timeout" "step8_pause" "" "last_status: $STATUS"
done
_step "pause" "INACTIVE"

# ── Step 9: Restore project ───────────────────────────────────────────────────
curl -sk -X POST "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}/restore" \
  -H "Authorization: Bearer ${SELFBASE_PAT}" -o /dev/null
for i in $(seq 1 30); do
  STATUS=$(curl -sk "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}" \
    -H "Authorization: Bearer ${SELFBASE_PAT}" | jq -r '.status')
  [[ "$STATUS" == "ACTIVE_HEALTHY" ]] && break
  sleep 10
  [[ $i -eq 30 ]] && _fail "restore_timeout" "step9_restore" "" "last_status: $STATUS"
done
_step "restore" "ACTIVE_HEALTHY"

# ── Step 10: Kong health ──────────────────────────────────────────────────────
KONG_URL=$(curl -sk "${API}/v1/projects/${SELFBASE_TEST_PROJECT_REF}" \
  -H "Authorization: Bearer ${SELFBASE_PAT}" | jq -r '.endpoint // empty')
if [[ -n "$KONG_URL" ]]; then
  KONG_HTTP=$(curl -sk "${KONG_URL}/health" -o /dev/null -w '%{http_code}' || true)
  [[ "$KONG_HTTP" != "502" && "$KONG_HTTP" != "503" ]] || \
    _fail "kong_unhealthy" "step10_kong" "$KONG_HTTP"
  _step "kong_health" "$KONG_HTTP"
else
  _step "kong_health" "skipped (no endpoint in project response)"
fi

# ── Step 11: PASS ─────────────────────────────────────────────────────────────
ROTATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TOTAL_ELAPSED=$(( $(date +%s) - RUN_START ))
echo
echo "[T078] PASS: master-key rotation validated | total_elapsed: ${TOTAL_ELAPSED}s | rotated_at: ${ROTATED_AT} | project: ${SELFBASE_TEST_PROJECT_REF}"
