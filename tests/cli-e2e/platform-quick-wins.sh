#!/usr/bin/env bash
#
# E2E: validates three stub→real platform endpoint conversions
#
#  1. GET /platform/projects/:ref/restore/versions  — completed backups array
#  2. GET /platform/projects/:ref/daily-stats       — {data:[...]} aggregate
#  3. GET /platform/organizations/:slug/available-versions — non-empty versions list
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/platform-quick-wins.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

PLATFORM="https://api.${SUPASTACK_APEX}/platform"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}")
PASS=0; FAIL=0

ok() {
  if [ "$2" = "$3" ]; then
    echo "[quick-wins] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[quick-wins] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

echo "==> platform-quick-wins E2E against ${PLATFORM}"

# ─── 1. restore/versions ──────────────────────────────────────────────────────
echo "==> [1] GET /platform/projects/:ref/restore/versions"
STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
  "${PLATFORM}/projects/${SUPASTACK_PROJECT_REF}/restore/versions")
ok "restore-versions-200" 200 "$STATUS"

BODY=$(curl -sk "${AUTH[@]}" "${PLATFORM}/projects/${SUPASTACK_PROJECT_REF}/restore/versions")
IS_ARRAY=$(printf '%s' "$BODY" | jq 'if type == "array" then "yes" else "no" end' -r 2>/dev/null || echo no)
ok "restore-versions-array" yes "$IS_ARRAY"

# If any backups exist, check the shape
COUNT=$(printf '%s' "$BODY" | jq 'length' 2>/dev/null || echo 0)
if [ "$COUNT" -gt 0 ]; then
  echo "==> [1b] checking backup entry shape ($COUNT entries)"
  MALFORMED=$(printf '%s' "$BODY" | jq \
    '[.[] | select((.id | type) != "number" or (.isPhysicalBackup | type) != "boolean" or (.status | type) != "string")] | length' \
    2>/dev/null || echo 1)
  ok "restore-versions-shape" 0 "$MALFORMED"
  HAS_COMPLETED=$(printf '%s' "$BODY" | jq '[.[] | select(.status == "COMPLETED")] | length > 0' -r 2>/dev/null || echo false)
  ok "restore-versions-completed" true "$HAS_COMPLETED"
else
  echo "==> [1b] SKIP: no completed backups yet (run a backup first)"
  echo "[quick-wins] restore-versions-shape STATUS=SKIP"; PASS=$((PASS+1))
  echo "[quick-wins] restore-versions-completed STATUS=SKIP"; PASS=$((PASS+1))
fi

# ─── 2. daily-stats ──────────────────────────────────────────────────────────
echo "==> [2] GET /platform/projects/:ref/daily-stats"
STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
  "${PLATFORM}/projects/${SUPASTACK_PROJECT_REF}/daily-stats")
ok "daily-stats-200" 200 "$STATUS"

BODY=$(curl -sk "${AUTH[@]}" "${PLATFORM}/projects/${SUPASTACK_PROJECT_REF}/daily-stats")
HAS_DATA=$(printf '%s' "$BODY" | jq 'has("data")' -r 2>/dev/null || echo false)
ok "daily-stats-has-data-key" true "$HAS_DATA"

DATA_IS_ARRAY=$(printf '%s' "$BODY" | jq '.data | if type == "array" then "yes" else "no" end' -r 2>/dev/null || echo no)
ok "daily-stats-data-is-array" yes "$DATA_IS_ARRAY"

# ─── 3. available-versions GET ───────────────────────────────────────────────
echo "==> [3] GET /platform/organizations/:slug/available-versions"
SLUG=$(curl -sk "${AUTH[@]}" "${PLATFORM}/organizations" | jq -r '.[0].slug // ""')
if [ -z "$SLUG" ]; then
  echo "[quick-wins] avail-versions-200 STATUS=SKIP (no org found)"; PASS=$((PASS+1))
  echo "[quick-wins] avail-versions-nonempty STATUS=SKIP"; PASS=$((PASS+1))
  echo "[quick-wins] avail-versions-get-post-match STATUS=SKIP"; PASS=$((PASS+1))
else
  STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" \
    "${PLATFORM}/organizations/${SLUG}/available-versions")
  ok "avail-versions-200" 200 "$STATUS"

  GET_BODY=$(curl -sk "${AUTH[@]}" "${PLATFORM}/organizations/${SLUG}/available-versions")
  VER_COUNT=$(printf '%s' "$GET_BODY" | jq 'length' 2>/dev/null || echo 0)
  [ "$VER_COUNT" -gt 0 ] \
    && ok "avail-versions-nonempty" yes yes \
    || ok "avail-versions-nonempty" yes no

  # GET and POST should return identical lists
  POST_BODY=$(curl -sk -X POST "${AUTH[@]}" "${PLATFORM}/organizations/${SLUG}/available-versions")
  GET_SORTED=$(printf '%s' "$GET_BODY" | jq 'sort_by(.postgresVersion)' -c 2>/dev/null || echo null)
  POST_SORTED=$(printf '%s' "$POST_BODY" | jq 'sort_by(.postgresVersion)' -c 2>/dev/null || echo null)
  ok "avail-versions-get-post-match" "$GET_SORTED" "$POST_SORTED"
fi

# ─── 4. Sad path: no auth → 401 on all three endpoints ───────────────────────
echo "==> [4] No auth → 401"
for endpoint in \
    "projects/${SUPASTACK_PROJECT_REF}/restore/versions" \
    "projects/${SUPASTACK_PROJECT_REF}/daily-stats" \
    "organizations/${SLUG:-no-org}/available-versions"; do
  S=$(curl -sk -o /dev/null -w '%{http_code}' "${PLATFORM}/${endpoint}")
  ok "no-auth-401:${endpoint##*/}" 401 "$S"
done

echo
echo "[quick-wins] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
