#!/usr/bin/env bash
#
# T077: Silent OAuth token refresh validation.
#
# Proves SC-003 from feature 014: after an MCP client's access token expires,
# the next call succeeds via a refresh token exchange — no browser intervention.
#
# Steps:
#   1. DCR register → client_id
#   2. PKCE + state
#   3. POST /v1/oauth/authorize (consent) → authorization code
#   4. POST /v1/oauth/token (authorization_code) → access_token + refresh_token + expires_in
#   5. GET /v1/profile with access_token → assert 200 (baseline)
#   6. sleep(expires_in + 60)  — wait for genuine expiry
#   7. GET /v1/profile with access_token → assert 401 (negative-path gate)
#   8. POST /v1/oauth/token (refresh_token) → new access_token + rotated refresh_token
#   9. GET /v1/profile with new access_token → assert 200 (SC-003 confirmed)
#  10. Print [T077] PASS with timestamps → exit 0
#
# Usage:
#   SELFBASE_APEX=supaviser.dev \
#   SELFBASE_SESSION_COOKIE='<sb_sid cookie value>' \
#   bash tests/cli-e2e/t077-silent-refresh.sh
#
# Requirements: curl, jq, openssl
# Duration: ~62 minutes (1h access-token TTL + 60s buffer + setup)
# Closes: issue #54 T077 / SC-003 (feature 014)

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required (e.g. supaviser.dev)}"
: "${SELFBASE_SESSION_COOKIE:?SELFBASE_SESSION_COOKIE required — paste sb_sid cookie value from browser}"

API="https://api.${SELFBASE_APEX}"
RUN_START=$(date +%s)

_step() {
  local name="$1" status="$2"
  local elapsed=$(( $(date +%s) - RUN_START ))
  echo "[T077] STEP: ${name} | STATUS: ${status} | ELAPSED: ${elapsed}s"
}

_fail() {
  local reason="$1" step="$2" status="${3:-n/a}" body="${4:-}"
  local truncated="${body:0:300}"
  echo "[T077] FAIL: ${reason} | step: ${step} | status: ${status} | body: ${truncated}"
  exit 1
}

# ── Step 1: DCR register ──────────────────────────────────────────────────────
REG_RES=$(curl -sk -X POST "${API}/v1/oauth/register" \
  -H "Content-Type: application/json" \
  -d '{"client_name":"t077-smoke","redirect_uris":["http://localhost:56831/callback"]}')
CLIENT_ID=$(echo "$REG_RES" | jq -r '.client_id')
[[ "$CLIENT_ID" =~ ^[0-9a-f-]{36}$ ]] || _fail "invalid_client_id" "step1_dcr" "" "$REG_RES"
_step "dcr_register" "ok"

# ── Step 2: PKCE + state ──────────────────────────────────────────────────────
VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '/+' '_-')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr -d '=' | tr '/+' '_-')
STATE=$(openssl rand -hex 16)
_step "pkce_setup" "ok"

# ── Step 3: POST consent to /v1/oauth/authorize ───────────────────────────────
CONSENT_RES=$(curl -sk -X POST "${API}/v1/oauth/authorize" \
  -H "Cookie: sb_sid=${SELFBASE_SESSION_COOKIE}" \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data-urlencode "response_type=code" \
  --data-urlencode "client_id=${CLIENT_ID}" \
  --data-urlencode "redirect_uri=http://localhost:56831/callback" \
  --data-urlencode "state=${STATE}" \
  --data-urlencode "code_challenge=${CHALLENGE}" \
  --data-urlencode "code_challenge_method=S256" \
  --data-urlencode "scope=platform" \
  --data-urlencode "decision=authorize" \
  -w '\n__STATUS:%{http_code}__LOCATION:%{redirect_url}\n')
CONSENT_STATUS=$(echo "$CONSENT_RES" | grep -oE '__STATUS:[0-9]+' | grep -oE '[0-9]+' | tail -1)
LOCATION=$(echo "$CONSENT_RES" | grep -oE '__LOCATION:[^[:space:]]*' | sed 's/^__LOCATION://')
[[ "$CONSENT_STATUS" == "302" || "$CONSENT_STATUS" == "303" ]] || \
  _fail "authorize_unexpected_status" "step3_authorize" "$CONSENT_STATUS" "$CONSENT_RES"
CODE=$(echo "$LOCATION" | grep -oE 'code=[^&]+' | cut -d= -f2)
[[ -n "$CODE" ]] || _fail "no_code_in_redirect" "step3_authorize" "$CONSENT_STATUS" "$LOCATION"
_step "authorize" "$CONSENT_STATUS"

# ── Step 4: POST /v1/oauth/token (authorization_code) ────────────────────────
TOKEN_RES=$(curl -sk -X POST "${API}/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"authorization_code\",\"code\":\"${CODE}\",\"redirect_uri\":\"http://localhost:56831/callback\",\"client_id\":\"${CLIENT_ID}\",\"code_verifier\":\"${VERIFIER}\"}")
ACCESS_TOKEN=$(echo "$TOKEN_RES" | jq -r '.access_token')
REFRESH_TOKEN=$(echo "$TOKEN_RES" | jq -r '.refresh_token')
EXPIRES_IN=$(echo "$TOKEN_RES" | jq -r '.expires_in')
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || \
  _fail "no_access_token" "step4_token_exchange" "" "$TOKEN_RES"
[[ -n "$REFRESH_TOKEN" && "$REFRESH_TOKEN" != "null" ]] || \
  _fail "no_refresh_token" "step4_token_exchange" "" "$TOKEN_RES"
[[ "$EXPIRES_IN" =~ ^[0-9]+$ && "$EXPIRES_IN" -gt 0 ]] || \
  _fail "unexpected_expires_in_value" "step4_token_exchange" "" "$TOKEN_RES"
ISSUED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
_step "token_exchange" "200"

# ── Step 5: Baseline — access_token valid at issuance ────────────────────────
BASELINE_RES=$(curl -sk "${API}/v1/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -w '\nHTTP %{http_code}')
echo "$BASELINE_RES" | grep -q 'HTTP 200' || \
  _fail "baseline_profile_call_failed" "step5_baseline" \
    "$(echo "$BASELINE_RES" | grep -oE 'HTTP [0-9]+')" "$BASELINE_RES"
_step "baseline_profile" "200"

# ── Step 6: Sleep until access token expires ──────────────────────────────────
WAIT_SEC=$(( EXPIRES_IN + 60 ))
echo "[T077] STEP: sleeping | duration: ${WAIT_SEC}s (~$(( WAIT_SEC / 60 ))min) | waiting for access token to expire"
sleep "$WAIT_SEC"

# ── Step 7: Negative-path gate — original access_token must now be 401 ────────
EXPIRED_RES=$(curl -sk "${API}/v1/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -w '\nHTTP %{http_code}')
echo "$EXPIRED_RES" | grep -q 'HTTP 401' || \
  _fail "access_token_not_expired" "step7_expiry_gate" \
    "$(echo "$EXPIRED_RES" | grep -oE 'HTTP [0-9]+')" "$EXPIRED_RES"
_step "expiry_gate" "401"

# ── Step 8: Refresh token exchange ───────────────────────────────────────────
REFRESH_RES=$(curl -sk -X POST "${API}/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"${REFRESH_TOKEN}\",\"client_id\":\"${CLIENT_ID}\"}")
NEW_ACCESS_TOKEN=$(echo "$REFRESH_RES" | jq -r '.access_token')
NEW_REFRESH_TOKEN=$(echo "$REFRESH_RES" | jq -r '.refresh_token')
[[ -n "$NEW_ACCESS_TOKEN" && "$NEW_ACCESS_TOKEN" != "null" ]] || \
  _fail "no_new_access_token" "step8_refresh" "" "$REFRESH_RES"
[[ -n "$NEW_REFRESH_TOKEN" && "$NEW_REFRESH_TOKEN" != "null" ]] || \
  _fail "no_new_refresh_token" "step8_refresh" "" "$REFRESH_RES"
[[ "$NEW_REFRESH_TOKEN" != "$REFRESH_TOKEN" ]] || \
  _fail "refresh_token_not_rotated" "step8_refresh" "" "$REFRESH_RES"
_step "refresh_exchange" "200"

# ── Step 9: Post-refresh validation — new access_token must be 200 ────────────
NEW_PROFILE_RES=$(curl -sk "${API}/v1/profile" \
  -H "Authorization: Bearer ${NEW_ACCESS_TOKEN}" \
  -w '\nHTTP %{http_code}')
echo "$NEW_PROFILE_RES" | grep -q 'HTTP 200' || \
  _fail "post_refresh_profile_failed" "step9_new_token" \
    "$(echo "$NEW_PROFILE_RES" | grep -oE 'HTTP [0-9]+')" "$NEW_PROFILE_RES"
_step "post_refresh_profile" "200"

# ── Step 10: PASS ─────────────────────────────────────────────────────────────
REFRESHED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)
TOTAL_ELAPSED=$(( $(date +%s) - RUN_START ))
echo
echo "[T077] PASS: SC-003 validated | total_elapsed: ${TOTAL_ELAPSED}s | issued_at: ${ISSUED_AT} | refreshed_at: ${REFRESHED_AT}"
