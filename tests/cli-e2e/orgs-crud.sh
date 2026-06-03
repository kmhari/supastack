#!/usr/bin/env bash
#
# orgs-crud.sh — feature 084 US3 (SC-008, SC-010): create / rename / delete
# organizations with 20-char ref ids; delete refused when the org owns projects.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US3
# Task: T034
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_TOKEN=<GoTrue access JWT or admin PAT>   (authenticates as an operator)
#
# Output: [ORGS] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL. Exit 0 iff zero FAILs.

set -uo pipefail
: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_TOKEN:?SUPASTACK_TOKEN required}"

BASE="https://${SUPASTACK_APEX}"
AUTH=(-H "authorization: Bearer ${SUPASTACK_TOKEN}" -H 'content-type: application/json')
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[ORGS] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[ORGS] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }

create_org() { # name -> echoes id
  curl -sS -X POST "${AUTH[@]}" -d "{\"name\":\"$1\"}" "${BASE}/api/v1/platform/organizations" \
    | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
}

# Create two orgs; each id must be a 20-char ref (SC-010).
ID1=$(create_org "E2E Org One")
ID2=$(create_org "E2E Org Two")
echo "$ID1" | grep -qE '^[a-z]{20}$' && ok "org1-20char-id" yes yes || ok "org1-20char-id" yes no
echo "$ID2" | grep -qE '^[a-z]{20}$' && ok "org2-20char-id" yes yes || ok "org2-20char-id" yes no
[ "$ID1" != "$ID2" ] && ok "distinct-ids" yes yes || ok "distinct-ids" yes no

# Rename org1.
ok "rename-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d '{"name":"E2E Renamed"}' "${BASE}/api/v1/platform/organizations/${ID1}")"
curl -sS "${AUTH[@]}" "${BASE}/api/v1/platform/organizations/${ID1}" | grep -q '"name":"E2E Renamed"' \
  && ok "rename-applied" yes yes || ok "rename-applied" yes no

# Org appears in the list.
curl -sS "${AUTH[@]}" "${BASE}/api/v1/platform/organizations" | grep -q "$ID2" \
  && ok "org2-in-list" yes yes || ok "org2-in-list" yes no

# Delete the empty orgs (SC-008). Note: the "delete-with-projects → 409" path is
# covered by the unit test (platform-organizations.test.ts) to avoid provisioning
# a real project here.
ok "delete-empty-org1-204" 204 "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${BASE}/api/v1/platform/organizations/${ID1}")"
ok "delete-empty-org2-204" 204 "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${BASE}/api/v1/platform/organizations/${ID2}")"

echo "[ORGS] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
