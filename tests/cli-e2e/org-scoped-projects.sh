#!/usr/bin/env bash
#
# org-scoped-projects.sh — feature 084 US5 (SC-003): projects belong to one org;
# the org-projects list returns only that org's projects, and a non-member is 403.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US5
# Task: T052
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_TOKEN=<GoTrue access JWT or admin PAT>  (member of SUPASTACK_ORG)
#   SUPASTACK_ORG=<20-char org id the token belongs to>
# Env (optional):
#   SUPASTACK_OTHER_ORG=<20-char org id the token does NOT belong to>  (403 check)
#
# Note: provisioning a real project (the cross-org refusal) is heavy + needs a
# 2nd user; the org-scoped project authz is unit-covered (org-projects.test.ts,
# instances org-scoping). This script drives the org-projects listing + 403.
#
# Output: [ORGPROJ] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL.

set -uo pipefail
: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_TOKEN:?SUPASTACK_TOKEN required}"
: "${SUPASTACK_ORG:?SUPASTACK_ORG required}"

BASE="https://${SUPASTACK_APEX}"
AUTH=(-H "authorization: Bearer ${SUPASTACK_TOKEN}")
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[ORGPROJ] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[ORGPROJ] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }

# Member sees the org's project list (paginated shape).
RESP=$(curl -sS "${AUTH[@]}" "${BASE}/api/v1/platform/organizations/${SUPASTACK_ORG}/projects?limit=96&offset=0")
echo "$RESP" | grep -q '"pagination"' && ok "org-projects-paginated" yes yes || ok "org-projects-paginated" yes no
echo "$RESP" | grep -q '"projects"' && ok "org-projects-has-projects-array" yes yes || ok "org-projects-has-projects-array" yes no

# A non-member of an org gets 403 on its projects (SC-003).
if [ -n "${SUPASTACK_OTHER_ORG:-}" ]; then
  ok "non-member-org-projects-403" 403 \
    "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/v1/platform/organizations/${SUPASTACK_OTHER_ORG}/projects")"
else
  echo "[ORGPROJ] non-member-403 STATUS=SKIP (set SUPASTACK_OTHER_ORG)"
fi

echo "[ORGPROJ] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
