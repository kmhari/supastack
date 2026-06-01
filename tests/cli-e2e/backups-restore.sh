#!/usr/bin/env bash
#
# Backups list + async restore end-to-end validation (issue #14).
#
# Tests:
#   1. GET /v1/projects/:ref/database/backups  → shape correct
#   2. POST /v1/projects/:ref/database/backups/restore-pitr → 202 + restore_job_id
#   3. GET /v1/projects/:ref/database/backups/restore-status → polls to success
#   4. All sibling services (auth, kong) healthy after restore
#   5. Negative: concurrent restore → 409 restore_in_progress
#   6. Negative: non-admin restore → 403
#
# Usage:
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT='<operator PAT>' \
#   SUPASTACK_MEMBER_PAT='<member PAT>' \
#   SUPASTACK_TEST_PROJECT_REF='<ref>' \
#   bash tests/cli-e2e/backups-restore.sh
#
# Requirements: curl, jq, a completed backup for the test project.
# The test project must have at least one COMPLETED backup.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_TEST_PROJECT_REF:?SUPASTACK_TEST_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}"
REF="${SUPASTACK_TEST_PROJECT_REF}"
MEMBER_PAT="${SUPASTACK_MEMBER_PAT:-}"
T_START=$(date -u +%s)

_elapsed() { echo "$(( $(date -u +%s) - T_START ))s"; }
_step() {
  local name="$1" status="$2"
  echo "[backups-restore] STEP: ${name} | STATUS: ${status} | ELAPSED: $(_elapsed)"
}
_fail() {
  local reason="$1" step="$2" body="${3:-}"
  echo "[backups-restore] FAIL: ${reason} | step: ${step} | body: ${body}" >&2
  exit 1
}

# ── STEP 1: list backups ──────────────────────────────────────────────────────
LIST_OUT=$(curl -sf \
  -H "Authorization: Bearer ${SUPASTACK_PAT}" \
  "${API}/v1/projects/${REF}/database/backups") || _fail "list_request_failed" "step1_list" ""

echo "$LIST_OUT" | jq -e '.backups | type == "array"' > /dev/null \
  || _fail "list_shape_invalid" "step1_list" "$LIST_OUT"
echo "$LIST_OUT" | jq -e '.physical_backup_data | type == "object"' > /dev/null \
  || _fail "list_shape_invalid" "step1_list" "$LIST_OUT"
echo "$LIST_OUT" | jq -e '.pitr_enabled == false' > /dev/null \
  || _fail "list_shape_invalid" "step1_list" "$LIST_OUT"

BACKUP_COUNT=$(echo "$LIST_OUT" | jq '.backups | length')
_step "list_backups" "ok (${BACKUP_COUNT} backups)"

# Require at least one completed backup
BACKUP_ID=$(echo "$LIST_OUT" | jq -r '[.backups[] | select(.status == "COMPLETED")] | first | .id')
if [ -z "$BACKUP_ID" ] || [ "$BACKUP_ID" = "null" ]; then
  echo "[backups-restore] SKIP: no COMPLETED backup found — trigger a backup first"
  exit 0
fi
_step "find_completed_backup" "ok (backup_id=${BACKUP_ID})"

# ── STEP 2: non-admin restore → 403 ──────────────────────────────────────────
if [ -n "$MEMBER_PAT" ]; then
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST \
    -H "Authorization: Bearer ${MEMBER_PAT}" \
    -H "Content-Type: application/json" \
    -d "{\"backup_id\":\"${BACKUP_ID}\"}" \
    "${API}/v1/projects/${REF}/database/backups/restore-pitr")
  [ "$HTTP_CODE" = "403" ] || _fail "expected_403_for_member" "step2_non_admin" "got ${HTTP_CODE}"
  _step "non_admin_403" "ok"
fi

# ── STEP 3: initiate restore (admin) ─────────────────────────────────────────
RESTORE_OUT=$(curl -sf \
  -X POST \
  -H "Authorization: Bearer ${SUPASTACK_PAT}" \
  -H "Content-Type: application/json" \
  -d "{\"backup_id\":\"${BACKUP_ID}\"}" \
  "${API}/v1/projects/${REF}/database/backups/restore-pitr") \
  || _fail "restore_pitr_failed" "step3_restore" ""

JOB_ID=$(echo "$RESTORE_OUT" | jq -r '.restore_job_id')
[ -n "$JOB_ID" ] && [ "$JOB_ID" != "null" ] \
  || _fail "restore_no_job_id" "step3_restore" "$RESTORE_OUT"
_step "restore_initiated" "ok (job=${JOB_ID})"

# ── STEP 4: concurrent restore → 409 ─────────────────────────────────────────
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST \
  -H "Authorization: Bearer ${SUPASTACK_PAT}" \
  -H "Content-Type: application/json" \
  -d "{\"backup_id\":\"${BACKUP_ID}\"}" \
  "${API}/v1/projects/${REF}/database/backups/restore-pitr")
[ "$HTTP_CODE" = "409" ] || _fail "expected_409_concurrent" "step4_concurrent" "got ${HTTP_CODE}"
_step "concurrent_409" "ok"

# ── STEP 5: poll restore-status until terminal ────────────────────────────────
MAX_WAIT=600
POLL_INTERVAL=10
ELAPSED=0
FINAL_STATUS=""

while [ $ELAPSED -lt $MAX_WAIT ]; do
  STATUS_OUT=$(curl -sf \
    -H "Authorization: Bearer ${SUPASTACK_PAT}" \
    "${API}/v1/projects/${REF}/database/backups/restore-status") \
    || { sleep $POLL_INTERVAL; ELAPSED=$((ELAPSED + POLL_INTERVAL)); continue; }

  CURRENT_STATUS=$(echo "$STATUS_OUT" | jq -r '.current.status // "unknown"')
  if [ "$CURRENT_STATUS" = "success" ] || [ "$CURRENT_STATUS" = "failed" ]; then
    FINAL_STATUS="$CURRENT_STATUS"
    break
  fi
  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ -z "$FINAL_STATUS" ]; then
  _fail "restore_status_timeout" "step5_poll_status" "still pending/running after ${MAX_WAIT}s"
fi
if [ "$FINAL_STATUS" = "failed" ]; then
  ERR_MSG=$(echo "$STATUS_OUT" | jq -r '.current.error_message // "unknown"')
  _fail "restore_failed" "step5_poll_status" "$ERR_MSG"
fi
_step "restore_completed" "$FINAL_STATUS"

# ── STEP 6: verify restore-status shape ──────────────────────────────────────
echo "$STATUS_OUT" | jq -e '.current | has("id", "backup_id", "status", "started_at", "completed_at")' > /dev/null \
  || _fail "status_shape_invalid" "step6_shape" "$STATUS_OUT"
_step "status_shape" "ok"

# ── STEP 7: project should be running again ───────────────────────────────────
PROJ_OUT=$(curl -sf \
  -H "Authorization: Bearer ${SUPASTACK_PAT}" \
  "${API}/v1/projects/${REF}") || _fail "project_read_failed" "step7_project_status" ""
PROJ_STATUS=$(echo "$PROJ_OUT" | jq -r '.status')
[ "$PROJ_STATUS" = "ACTIVE_HEALTHY" ] \
  || _fail "project_not_healthy_after_restore" "step7_project_status" "status=${PROJ_STATUS}"
_step "project_healthy" "ACTIVE_HEALTHY"

ROTATED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
echo ""
echo "[backups-restore] PASS: backup restore validated | total_elapsed: $(_elapsed) | completed_at: ${ROTATED_AT} | project: ${REF} | backup_id: ${BACKUP_ID}"
