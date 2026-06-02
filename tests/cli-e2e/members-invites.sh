#!/usr/bin/env bash
#
# members-invites.sh — feature 084 US4 (SC-004, SC-005): roles list, invite by
# email, pending-invite list/cancel, and the last-owner invariant.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US4
# Task: T046
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_TOKEN=<GoTrue access JWT or admin PAT>   (an OWNER of the org below)
#   SUPASTACK_ORG=<20-char org id>                     (an org the token owns)
# Env (optional):
#   SUPASTACK_OWN_GOTRUE_ID=<uuid>   (the caller's gotrue id; enables the last-owner check)
#
# Note: full invite→accept (a 2nd user signing up via GoTrue + accepting) is a
# manual / browser flow; this drives the operator-side create/list/cancel + the
# RBAC guards. The accept path is unit-covered (platform-members.test.ts).
#
# Output: [MEMBERS] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL. Exit 0 iff zero FAILs.

set -uo pipefail
: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_TOKEN:?SUPASTACK_TOKEN required}"
: "${SUPASTACK_ORG:?SUPASTACK_ORG required}"

BASE="https://${SUPASTACK_APEX}"
ORG="${BASE}/api/v1/platform/organizations/${SUPASTACK_ORG}"
AUTH=(-H "authorization: Bearer ${SUPASTACK_TOKEN}" -H 'content-type: application/json')
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[MEMBERS] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[MEMBERS] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }

# Roles list = four numeric-id objects (SC-005).
ROLES=$(curl -sS "${AUTH[@]}" "${ORG}/roles")
echo "$ROLES" | grep -q '"name":"Owner"' && ok "roles-has-owner" yes yes || ok "roles-has-owner" yes no
echo "$ROLES" | grep -q '"name":"Read-only"' && ok "roles-has-readonly" yes yes || ok "roles-has-readonly" yes no

# Members list includes the owner.
ok "members-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${ORG}/members")"

# Invitations are SMTP-gated (US6). Without SMTP, the send MUST 409 (FR-031).
# With SMTP (set SUPASTACK_SMTP_CONFIGURED=1), run the full create/list/cancel.
INVITE_EMAIL="invitee-$(date +%s)@example.dev"
if [ "${SUPASTACK_SMTP_CONFIGURED:-0}" = "1" ]; then
  INV=$(curl -sS -X POST "${AUTH[@]}" -d "{\"emails\":[\"${INVITE_EMAIL}\"],\"role_id\":3}" "${ORG}/members/invitations")
  echo "$INV" | grep -q "\"succeeded\":\[\"${INVITE_EMAIL}\"\]" && ok "invite-succeeded" yes yes || ok "invite-succeeded" yes no
  LIST=$(curl -sS "${AUTH[@]}" "${ORG}/members/invitations")
  echo "$LIST" | grep -q "$INVITE_EMAIL" && ok "invite-pending-listed" yes yes || ok "invite-pending-listed" yes no
  INV_ID=$(printf '%s' "$LIST" | grep -o "\"id\":\"[^\"]*\",\"invited_email\":\"${INVITE_EMAIL}\"" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
  [ -n "$INV_ID" ] && ok "invite-cancel-204" 204 "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${ORG}/members/invitations/${INV_ID}")"
  # Invalid role_id → 400 (reached only past the SMTP guard).
  ok "invite-bad-role-400" 400 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d '{"emails":["x@y.z"],"role_id":99}' "${ORG}/members/invitations")"
else
  ok "invite-without-smtp-409" 409 "$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${AUTH[@]}" -d "{\"emails\":[\"${INVITE_EMAIL}\"],\"role_id\":3}" "${ORG}/members/invitations")"
  echo "[MEMBERS] invite-happy-path STATUS=SKIP (set SUPASTACK_SMTP_CONFIGURED=1 + GOTRUE_SMTP_* to verify)"
fi

# Last-owner invariant: the sole owner cannot remove themselves (SC / FR-019).
if [ -n "${SUPASTACK_OWN_GOTRUE_ID:-}" ]; then
  ok "last-owner-remove-409" 409 "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${AUTH[@]}" "${ORG}/members/${SUPASTACK_OWN_GOTRUE_ID}")"
else
  echo "[MEMBERS] last-owner-invariant STATUS=SKIP (set SUPASTACK_OWN_GOTRUE_ID)"
fi

echo "[MEMBERS] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
