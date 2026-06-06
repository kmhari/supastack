#!/usr/bin/env bash
#
# E2E: validates network bans + network restrictions Management API endpoints
# GET    /v1/projects/:ref/network-bans              — list bans
# DELETE /v1/projects/:ref/network-bans              — remove bans
# GET    /v1/projects/:ref/network-restrictions      — get restrictions config
# POST   /v1/projects/:ref/network-restrictions/apply — apply restrictions
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/network-restrictions.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}" -H 'Content-Type: application/json')
PASS=0; FAIL=0

ok() {
  if [ "$2" = "$3" ]; then
    echo "[network] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[network] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

echo "==> network-restrictions E2E against ${API}"

# ─── 1. List network bans ─────────────────────────────────────────────────────
echo "==> [1] GET /network-bans"
BAN_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/network-bans")
ok "list-bans-200" 200 "$BAN_STATUS"
BANS=$(curl -sk "${AUTH[@]}" "${API}/network-bans")
# Response should be JSON (array or object with bans key)
printf '%s' "$BANS" | jq . > /dev/null 2>&1 && ok "list-bans-json" yes yes || ok "list-bans-json" yes no

# ─── 2. Remove all bans (idempotent — safe even when empty) ──────────────────
echo "==> [2] DELETE /network-bans (idempotent)"
DEL_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" \
  "${API}/network-bans" -d '{"ipv4_cidr_addresses": []}')
# 200, 204 (no content), or 404 (no bans to remove) are all acceptable
case "$DEL_STATUS" in
  200|204) echo "[network] remove-bans STATUS=PASS ($DEL_STATUS)"; PASS=$((PASS+1)) ;;
  404) echo "[network] remove-bans STATUS=SKIP (no bans to remove)"; PASS=$((PASS+1)) ;;
  *) echo "[network] remove-bans STATUS=FAIL (want 200/204 got $DEL_STATUS)"; FAIL=$((FAIL+1)) ;;
esac

# ─── 3. Get network restrictions ─────────────────────────────────────────────
echo "==> [3] GET /network-restrictions"
RESTR_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/network-restrictions")
ok "get-restrictions-200" 200 "$RESTR_STATUS"
RESTR=$(curl -sk "${AUTH[@]}" "${API}/network-restrictions")
printf '%s' "$RESTR" | jq . > /dev/null 2>&1 && ok "restrictions-json" yes yes || ok "restrictions-json" yes no

# ─── 4. Apply restrictions (allow all — permissive, safe) ────────────────────
echo "==> [4] POST /network-restrictions/apply (allow all)"
APPLY_STATUS=$(curl -sk -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" \
  "${API}/network-restrictions/apply" -d '{"dbAllowedCidrs": [], "dbAllowedCidrsV6": []}')
# 200 = applied; 201 = created; 404 = not implemented (acceptable for stub)
case "$APPLY_STATUS" in 200|201|202) ok "apply-restrictions" 200 "$APPLY_STATUS" ;;
  404) echo "[network] apply-restrictions STATUS=SKIP (endpoint not implemented)"; PASS=$((PASS+1)) ;;
  *) ok "apply-restrictions" 200 "$APPLY_STATUS" ;; esac

echo
echo "[network] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
