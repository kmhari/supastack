#!/usr/bin/env bash
#
# E2E: validates GET /v1/projects/:ref/services
# Returns array of service objects with name/version/status fields.
#
# Run locally with:
#
#   SUPASTACK_APEX=supaviser.dev \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<20-char-ref> \
#   bash tests/cli-e2e/services.sh
#
# Requirements: curl, jq on PATH.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

API="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_PROJECT_REF}"
AUTH=(-H "Authorization: Bearer ${SUPASTACK_PAT}")
PASS=0; FAIL=0

ok() {
  if [ "$2" = "$3" ]; then
    echo "[services] $1 STATUS=PASS ($3)"; PASS=$((PASS+1))
  else
    echo "[services] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1))
  fi
}

echo "==> services E2E against ${API}"

# ─── 1. GET /services → 200 + JSON array ─────────────────────────────────────
echo "==> [1] GET /services"
STATUS=$(curl -sk -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${API}/services")
ok "services-200" 200 "$STATUS"

BODY=$(curl -sk "${AUTH[@]}" "${API}/services")
IS_ARRAY=$(printf '%s' "$BODY" | jq 'if type == "array" then "yes" else "no" end' -r 2>/dev/null || echo no)
ok "services-array" yes "$IS_ARRAY"

# ─── 2. Array is non-empty ────────────────────────────────────────────────────
COUNT=$(printf '%s' "$BODY" | jq 'length' 2>/dev/null || echo 0)
[ "$COUNT" -gt 0 ] && ok "services-nonempty" yes yes || ok "services-nonempty" yes no

# ─── 3. Each entry has name + version fields ──────────────────────────────────
echo "==> [3] Each entry has name + version"
MALFORMED=$(printf '%s' "$BODY" | jq '[.[] | select((.name | type) != "string" or (.version | type) != "string")] | length' 2>/dev/null || echo 1)
ok "services-shape" 0 "$MALFORMED"

# ─── 4. Known services present ────────────────────────────────────────────────
echo "==> [4] Expected service names present"
for svc in auth db rest; do
  FOUND=$(printf '%s' "$BODY" | jq --arg s "$svc" '[.[] | select(.name == $s)] | length' 2>/dev/null || echo 0)
  ok "has-${svc}" 1 "$FOUND"
done

echo
echo "[services] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
