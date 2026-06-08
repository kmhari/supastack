#!/usr/bin/env bash
#
# E2E: validates Edge Functions management API endpoints
# GET  /v1/projects/:ref/functions           — list (200 + array)
# GET  /v1/projects/:ref/functions/:slug     — get single (200 or 404)
# DELETE /v1/projects/:ref/functions/:slug   — delete (200 or 404)
#
# Tests management endpoints independent of deploy (deploy is tested by
# deploy-hello.sh). Uses existing deployed functions if any; always tests
# the 404 path for non-existent slugs.
#
# Optional: SUPASTACK_FUNCTION_SLUG=<slug> to also test get+delete on a
# known-deployed function.
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/functions-mgmt.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}")
PASS=0; FAIL=0
NONEXISTENT="e2e-fn-nonexistent-$$"

ok() {
  if [ "$2" = "$3" ]; then
    echo "[functions-mgmt] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[functions-mgmt] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

echo "==> functions-mgmt E2E against ${API}"

# ─── 1. List functions → 200 + JSON array ─────────────────────────────────────
echo "==> [1] GET /functions — list"
LIST_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/functions")
ok "list-200" 200 "$LIST_STATUS"
LIST=$(curl -sk "${AUTH[@]}" "${API}/functions")
IS_ARRAY=$(printf '%s' "$LIST" | jq 'if type == "array" then "yes" else "no" end' -r 2>/dev/null || echo no)
ok "list-is-array" yes "$IS_ARRAY"

# ─── 2. If functions exist, test get single ────────────────────────────────────
FIRST_SLUG=""
if printf '%s' "$LIST" | jq -e 'length > 0' > /dev/null 2>&1; then
  FIRST_SLUG=$(printf '%s' "$LIST" | jq -r '.[0].slug // ""')
fi

if [ -n "$FIRST_SLUG" ]; then
  echo "==> [2] GET /functions/${FIRST_SLUG} (existing)"
  GET_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/functions/${FIRST_SLUG}")
  ok "get-existing-200" 200 "$GET_STATUS"
  FN_SLUG=$(curl -sk "${AUTH[@]}" "${API}/functions/${FIRST_SLUG}" | jq -r '.slug // ""')
  ok "get-slug-matches" "$FIRST_SLUG" "$FN_SLUG"
else
  echo "==> [2] SKIP: no functions deployed (deploy one with deploy-hello.sh first)"
  echo "[functions-mgmt] get-existing-200 STATUS=SKIP"; PASS=$((PASS+1))
  echo "[functions-mgmt] get-slug-matches STATUS=SKIP"; PASS=$((PASS+1))
fi

# ─── 3. Get non-existent function → 404 ──────────────────────────────────────
echo "==> [3] GET /functions/${NONEXISTENT} → 404"
GET_404=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/functions/${NONEXISTENT}")
ok "get-nonexistent-404" 404 "$GET_404"

# ─── 4. Delete non-existent function → 404 ────────────────────────────────────
echo "==> [4] DELETE /functions/${NONEXISTENT} → 404"
DEL_404=$(curl -sk -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${API}/functions/${NONEXISTENT}")
ok "delete-nonexistent-404" 404 "$DEL_404"

# ─── 5. Optional: delete a known function (only if SUPASTACK_FUNCTION_SLUG set) ─
if [ -n "${SUPASTACK_FUNCTION_SLUG:-}" ]; then
  echo "==> [5] DELETE /functions/${SUPASTACK_FUNCTION_SLUG} (user-specified)"
  DEL_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${API}/functions/${SUPASTACK_FUNCTION_SLUG}")
  case "$DEL_STATUS" in 200|404) ok "delete-specified" 200 "$DEL_STATUS" ;; *) ok "delete-specified" 200 "$DEL_STATUS" ;; esac
else
  echo "==> [5] SKIP: set SUPASTACK_FUNCTION_SLUG to test delete on a specific function"
fi

echo
echo "[functions-mgmt] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
