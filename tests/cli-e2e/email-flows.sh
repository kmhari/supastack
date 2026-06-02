#!/usr/bin/env bash
#
# email-flows.sh — feature 084 US6 (SC-004, SC-007): with SMTP configured,
# invitations + password reset are accepted (emails dispatched by GoTrue);
# without SMTP, email-dependent actions return a clear 409.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US6
# Task: T056
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_TOKEN=<owner/admin GoTrue JWT or PAT>
#   SUPASTACK_ORG=<20-char org id the token owns>
# Behavior depends on the deployment's SMTP config (infra/.env GOTRUE_SMTP_HOST):
#   - SMTP configured  → invite 200 + reset 200
#   - SMTP unconfigured → invite 409 + reset 409
# Set SUPASTACK_SMTP_CONFIGURED=1 to assert the configured branch.
#
# Output: [EMAIL] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL.

set -uo pipefail
: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_TOKEN:?SUPASTACK_TOKEN required}"
: "${SUPASTACK_ORG:?SUPASTACK_ORG required}"

BASE="https://${SUPASTACK_APEX}"
AUTH=(-H "authorization: Bearer ${SUPASTACK_TOKEN}" -H 'content-type: application/json')
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[EMAIL] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[EMAIL] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }

EMAIL="invitee-$(date +%s)@example.dev"
INVITE_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"emails\":[\"${EMAIL}\"],\"role_id\":3}" "${BASE}/api/v1/platform/organizations/${SUPASTACK_ORG}/members/invitations")
RESET_CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"email\":\"${EMAIL}\"}" "${BASE}/api/v1/platform/reset-password")

if [ "${SUPASTACK_SMTP_CONFIGURED:-0}" = "1" ]; then
  ok "invite-with-smtp-200" 200 "$INVITE_CODE"
  ok "reset-with-smtp-200" 200 "$RESET_CODE"
  echo "[EMAIL] NOTE: confirm the invite + reset emails actually arrived in the test inbox."
else
  ok "invite-without-smtp-409" 409 "$INVITE_CODE"
  ok "reset-without-smtp-409" 409 "$RESET_CODE"
fi

echo "[EMAIL] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
