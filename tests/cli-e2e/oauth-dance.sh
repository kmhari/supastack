#!/usr/bin/env bash
#
# E2E: wire-level OAuth 2.1 dance against the deployed selfbase api.
#
# Performs the full flow WITHOUT a browser, by:
#   1. POST /v1/oauth/register (DCR) → client_id
#   2. Mint a fresh dashboard session via the existing test helper
#      (or use SELFBASE_SESSION_COOKIE env if set)
#   3. POST /v1/oauth/authorize with consent → authorization code
#   4. POST /v1/oauth/token → access_token (JWT) + refresh_token
#   5. Use the access_token to call /v1/profile — must succeed
#   6. Refresh the token via grant_type=refresh_token — must succeed
#
# Spec: 014-mcp-http-oauth — quickstart.md US1 + US2.
#
# Run with:
#   SELFBASE_APEX=supaviser.dev \
#   SELFBASE_SESSION_COOKIE='xoZCpM5Q...' \
#   bash tests/cli-e2e/oauth-dance.sh
#
# Requirements: curl, jq, openssl (for PKCE verifier+challenge generation).

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required}"
: "${SELFBASE_SESSION_COOKIE:?SELFBASE_SESSION_COOKIE required — paste sb_sid cookie value from browser}"

API="https://api.${SELFBASE_APEX}"

echo "==> [1] DCR register"
REG_BODY='{"client_name":"e2e-test-client","redirect_uris":["http://localhost:56831/callback"]}'
REG_RES=$(curl -sk -X POST "${API}/v1/oauth/register" \
  -H "Content-Type: application/json" \
  -d "$REG_BODY")
CLIENT_ID=$(echo "$REG_RES" | jq -r '.client_id')
[[ "$CLIENT_ID" =~ ^[0-9a-f-]{36}$ ]] || { echo "FAIL: invalid client_id: $CLIENT_ID"; echo "$REG_RES"; exit 1; }
echo "    client_id=${CLIENT_ID}"

echo "==> [2] Generate PKCE verifier + challenge"
VERIFIER=$(openssl rand -base64 32 | tr -d '=' | tr '/+' '_-')
CHALLENGE=$(printf '%s' "$VERIFIER" | openssl dgst -sha256 -binary | openssl base64 -A | tr -d '=' | tr '/+' '_-')
STATE=$(openssl rand -hex 16)

echo "==> [3] POST consent to /v1/oauth/authorize (Authorize)"
# Note: the consent submit is a POST with form-urlencoded body
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
STATUS=$(echo "$CONSENT_RES" | grep -oE '__STATUS:[0-9]+' | grep -oE '[0-9]+' | tail -1)
LOCATION=$(echo "$CONSENT_RES" | grep -oE '__LOCATION:[^[:space:]]*' | sed 's/^__LOCATION://')
[[ "$STATUS" == "302" || "$STATUS" == "303" ]] || { echo "FAIL: expected 302/303 from authorize, got $STATUS"; echo "$CONSENT_RES"; exit 1; }
CODE=$(echo "$LOCATION" | grep -oE 'code=[^&]+' | cut -d= -f2)
[[ -n "$CODE" ]] || { echo "FAIL: no code in redirect: $LOCATION"; exit 1; }
echo "    code received"

echo "==> [4] POST /v1/oauth/token (authorization_code)"
TOKEN_RES=$(curl -sk -X POST "${API}/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"authorization_code\",\"code\":\"${CODE}\",\"redirect_uri\":\"http://localhost:56831/callback\",\"client_id\":\"${CLIENT_ID}\",\"code_verifier\":\"${VERIFIER}\"}")
ACCESS_TOKEN=$(echo "$TOKEN_RES" | jq -r '.access_token')
REFRESH_TOKEN=$(echo "$TOKEN_RES" | jq -r '.refresh_token')
[[ -n "$ACCESS_TOKEN" && "$ACCESS_TOKEN" != "null" ]] || { echo "FAIL: no access_token"; echo "$TOKEN_RES"; exit 1; }
[[ -n "$REFRESH_TOKEN" && "$REFRESH_TOKEN" != "null" ]] || { echo "FAIL: no refresh_token"; echo "$TOKEN_RES"; exit 1; }
JTI_PARTS=$(echo "$ACCESS_TOKEN" | tr '.' '\n' | wc -l)
[[ "$JTI_PARTS" == "3" ]] || { echo "FAIL: access_token not a JWT (got $JTI_PARTS parts)"; exit 1; }
echo "    access_token + refresh_token issued"

echo "==> [5] Use access_token to call /v1/profile"
PROFILE_RES=$(curl -sk "${API}/v1/profile" \
  -H "Authorization: Bearer ${ACCESS_TOKEN}" \
  -w '\nHTTP %{http_code}')
echo "$PROFILE_RES" | grep -q 'HTTP 200' || { echo "FAIL: profile call failed"; echo "$PROFILE_RES"; exit 1; }
echo "    profile call succeeded with OAuth JWT bearer"

echo "==> [6] Refresh token grant"
REFRESH_RES=$(curl -sk -X POST "${API}/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"${REFRESH_TOKEN}\",\"client_id\":\"${CLIENT_ID}\"}")
NEW_ACCESS=$(echo "$REFRESH_RES" | jq -r '.access_token')
NEW_REFRESH=$(echo "$REFRESH_RES" | jq -r '.refresh_token')
[[ -n "$NEW_ACCESS" && "$NEW_ACCESS" != "null" ]] || { echo "FAIL: no refreshed access_token"; echo "$REFRESH_RES"; exit 1; }
[[ "$NEW_REFRESH" != "$REFRESH_TOKEN" ]] || { echo "FAIL: refresh token not rotated"; exit 1; }
echo "    refresh succeeded; new tokens issued"

echo "==> [7] Reuse-detection: try refreshing the ORIGINAL refresh token again"
REUSE_RES=$(curl -sk -X POST "${API}/v1/oauth/token" \
  -H "Content-Type: application/json" \
  -d "{\"grant_type\":\"refresh_token\",\"refresh_token\":\"${REFRESH_TOKEN}\",\"client_id\":\"${CLIENT_ID}\"}" \
  -w '\nHTTP %{http_code}\n')
echo "$REUSE_RES" | grep -q 'HTTP 400' || { echo "FAIL: expected 400 on reuse"; echo "$REUSE_RES"; exit 1; }
echo "$REUSE_RES" | grep -q 'invalid_grant' || { echo "FAIL: expected invalid_grant"; exit 1; }
echo "    reuse-detection fired correctly"

echo
echo "==> ALL OAUTH FLOW CHECKS PASSED"
