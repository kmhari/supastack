#!/usr/bin/env bash
#
# E2E: validates Management API storage bucket CRUD
# POST /v1/projects/:ref/storage/buckets
# GET  /v1/projects/:ref/storage/buckets
# GET  /v1/projects/:ref/storage/buckets/:id
# PATCH /v1/projects/:ref/storage/buckets/:id
# DELETE /v1/projects/:ref/storage/buckets/:id
#
# Regression: Studio sends CreateStorageBucketBody {id, public, ...} (no name).
# The platform proxy must backfill id→name (backfillBucketName) before forwarding
# to the per-instance storage-api which requires {name}. This test sends the
# Studio-shaped body (with id, no name) and asserts it succeeds (SC-001).
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/storage-buckets.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}" -H 'Content-Type: application/json')
PASS=0; FAIL=0
BUCKET_ID="e2e-test-bucket-$$"

ok() {
  if [ "$2" = "$3" ]; then
    echo "[storage] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[storage] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

cleanup() {
  curl -sS -o /dev/null -X DELETE "${AUTH[@]}" "${API}/storage/buckets/${BUCKET_ID}" 2>/dev/null || true
}
trap cleanup EXIT

echo "==> storage-buckets E2E against ${API}"

# ─── 1. Create bucket with Studio-shaped body (id, no name) ──────────────────
echo "==> [1] POST studio-shaped {id, public} — no name (SC-001 regression)"
OUT=$(curl -sk -X POST "${AUTH[@]}" "${API}/storage/buckets" \
  -d "{\"id\": \"${BUCKET_ID}\", \"public\": false}" \
  -w '\n__STATUS:%{http_code}')
STATUS=$(printf '%s' "$OUT" | grep -oE '__STATUS:[0-9]+' | grep -oE '[0-9]+')
BODY=$(printf '%s' "$OUT" | grep -v '__STATUS:')
ok "create-studio-shaped" 200 "$STATUS"

# ─── 2. List buckets — new bucket appears ─────────────────────────────────────
echo "==> [2] GET /storage/buckets — bucket visible"
LIST=$(curl -sk "${AUTH[@]}" "${API}/storage/buckets")
FOUND=$(printf '%s' "$LIST" | jq --arg id "$BUCKET_ID" '[.[] | select(.id == $id or .name == $id)] | length' 2>/dev/null || echo "0")
ok "bucket-in-list" 1 "$FOUND"

# ─── 3. Get single bucket ─────────────────────────────────────────────────────
echo "==> [3] GET /storage/buckets/:id"
GET_OUT=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/storage/buckets/${BUCKET_ID}")
ok "get-bucket" 200 "$GET_OUT"

# ─── 4. Update bucket (make public) ───────────────────────────────────────────
echo "==> [4] PATCH /storage/buckets/:id — make public"
PATCH_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" \
  "${API}/storage/buckets/${BUCKET_ID}" -d '{"public": true}')
ok "patch-bucket" 200 "$PATCH_STATUS"

# ─── 5. Verify update ─────────────────────────────────────────────────────────
echo "==> [5] GET — public=true after PATCH"
BUCKET_JSON=$(curl -sk "${AUTH[@]}" "${API}/storage/buckets/${BUCKET_ID}")
IS_PUBLIC=$(printf '%s' "$BUCKET_JSON" | jq '.public // false' 2>/dev/null || echo false)
ok "bucket-public" true "$IS_PUBLIC"

# ─── 6. Delete bucket ─────────────────────────────────────────────────────────
echo "==> [6] DELETE /storage/buckets/:id"
DEL_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" \
  "${API}/storage/buckets/${BUCKET_ID}")
ok "delete-bucket" 200 "$DEL_STATUS"

# ─── 7. Gone from list ────────────────────────────────────────────────────────
echo "==> [7] GET list — bucket gone after delete"
LIST2=$(curl -sk "${AUTH[@]}" "${API}/storage/buckets")
STILL_THERE=$(printf '%s' "$LIST2" | jq --arg id "$BUCKET_ID" '[.[] | select(.id == $id or .name == $id)] | length' 2>/dev/null || echo "1")
ok "bucket-deleted" 0 "$STILL_THERE"

echo
echo "[storage] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
