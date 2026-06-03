#!/usr/bin/env bash
#
# gotrue-signin.sh — feature 084 US1: operator signs in via the real
# control-plane GoTrue and the dashboard bootstraps (profile + permissions +
# orgs), with NO legacy sb_sid session cookie.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US1 (SC-001, SC-006)
# Task: T023
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_OP_EMAIL=operator@example.dev
#   SUPASTACK_OP_PASSWORD=...
#
# Output: [SIGNIN] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL. Exit 0 iff zero FAILs.

set -uo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_OP_EMAIL:?SUPASTACK_OP_EMAIL required}"
: "${SUPASTACK_OP_PASSWORD:?SUPASTACK_OP_PASSWORD required}"

BASE="https://${SUPASTACK_APEX}"
PASS=0
FAIL=0
check() { # name expected_status actual_status
  if [ "$2" = "$3" ]; then echo "[SIGNIN] $1 STATUS=PASS ($3)"; PASS=$((PASS + 1));
  else echo "[SIGNIN] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL + 1)); fi
}

# ── Happy: sign in via GoTrue /auth/v1/token (password grant) ────────────────
TOKEN_RESP=$(curl -sS -D /tmp/signin-hdrs.txt \
  -X POST "${BASE}/auth/v1/token?grant_type=password" \
  -H 'content-type: application/json' \
  -d "{\"email\":\"${SUPASTACK_OP_EMAIL}\",\"password\":\"${SUPASTACK_OP_PASSWORD}\"}")
ACCESS=$(printf '%s' "$TOKEN_RESP" | grep -o '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)
[ -n "$ACCESS" ] && check "gotrue-token-issued" yes yes || check "gotrue-token-issued" yes no

# SC-006: the token endpoint must NOT set a legacy sb_sid cookie.
if grep -qi 'set-cookie:.*sb_sid' /tmp/signin-hdrs.txt; then check "no-sb_sid-cookie" yes no;
else check "no-sb_sid-cookie" yes yes; fi

AUTH=(-H "authorization: Bearer ${ACCESS}")

# Dashboard bootstrap: profile + permissions + orgs all 200.
check "profile-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/v1/platform/profile")"
check "permissions-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/v1/platform/profile/permissions")"
check "organizations-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "${BASE}/api/v1/platform/organizations")"

# Profile carries the GoTrue identity.
PROFILE=$(curl -sS "${AUTH[@]}" "${BASE}/api/v1/platform/profile")
printf '%s' "$PROFILE" | grep -q "\"primary_email\":\"${SUPASTACK_OP_EMAIL}\"" \
  && check "profile-has-email" yes yes || check "profile-has-email" yes no

# ── Sad: tampered / garbage bearer → 401 ─────────────────────────────────────
TAMPERED="${ACCESS%?}X"
check "tampered-jwt-401" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${TAMPERED}" "${BASE}/api/v1/platform/profile")"
check "garbage-jwt-401" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -H 'authorization: Bearer not.a.jwt' "${BASE}/api/v1/platform/profile")"
check "no-token-401" 401 "$(curl -sS -o /dev/null -w '%{http_code}' "${BASE}/api/v1/platform/profile")"

echo "[SIGNIN] TOTAL=$((PASS + FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
