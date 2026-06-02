#!/usr/bin/env bash
#
# cli-mcp-regression.sh — feature 084 US2 (SC-002): after migrating identity to
# GoTrue, the Supabase-CLI PAT path and the MCP OAuth path still authenticate.
# The wire protocols are unchanged; this proves no regression on a live build.
#
# Spec: specs/084-gotrue-control-plane-auth/spec.md US2 (SC-002)
# Task: T028
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_PAT=sbp_xxxxx        (a freshly re-issued admin PAT — greenfield)
# Env (optional):
#   SUPASTACK_MCP_TOKEN=<oauth jwt>  (if set, calls the MCP surface too;
#                                     otherwise the full flow lives in mcp-roundtrip.sh)
#
# Output: [CLIMCP] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL. Exit 0 iff zero FAILs.

set -uo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required (re-issue after the greenfield cutover)}"

BASE="https://${SUPASTACK_APEX}"
PAT_AUTH=(-H "authorization: Bearer ${SUPASTACK_PAT}")
PASS=0
FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[CLIMCP] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[CLIMCP] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }
notcode() { if [ "$2" != "$3" ]; then echo "[CLIMCP] $1 STATUS=PASS (got $3, not $2)"; PASS=$((PASS+1)); else echo "[CLIMCP] $1 STATUS=FAIL (got forbidden $2)"; FAIL=$((FAIL+1)); fi; }

# ── CLI: PAT authenticates against the Management API ────────────────────────
# A valid PAT must NOT 401 on the management surface (the CLI's `supabase` calls).
ORGS=$(curl -sS -o /dev/null -w '%{http_code}' "${PAT_AUTH[@]}" "https://api.${SUPASTACK_APEX}/v1/organizations")
notcode "pat-mgmt-organizations-not-401" 401 "$ORGS"
PROJ=$(curl -sS -o /dev/null -w '%{http_code}' "${PAT_AUTH[@]}" "https://api.${SUPASTACK_APEX}/v1/projects")
notcode "pat-mgmt-projects-not-401" 401 "$PROJ"

# Sad: a garbage PAT must 401.
ok "bad-pat-401" 401 "$(curl -sS -o /dev/null -w '%{http_code}' -H 'authorization: Bearer sbp_0000000000000000000000000000000000000000' "https://api.${SUPASTACK_APEX}/v1/organizations")"

# ── Studio token UI alias resolves the same api_tokens store ─────────────────
ok "platform-access-tokens-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${PAT_AUTH[@]}" "${BASE}/api/v1/platform/profile/access-tokens")"

# Create + revoke a token via the platform alias (round-trips the real store).
CREATED=$(curl -sS -X POST "${PAT_AUTH[@]}" -H 'content-type: application/json' \
  -d '{"name":"cli-mcp-regression"}' "${BASE}/api/v1/platform/profile/access-tokens")
echo "$CREATED" | grep -qE '"token":"sbp_[a-f0-9]{40}"' && ok "platform-token-create" yes yes || ok "platform-token-create" yes no
NEW_ID=$(printf '%s' "$CREATED" | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4)
if [ -n "$NEW_ID" ]; then
  ok "platform-token-revoke-204" 204 "$(curl -sS -o /dev/null -w '%{http_code}' -X DELETE "${PAT_AUTH[@]}" "${BASE}/api/v1/platform/profile/access-tokens/${NEW_ID}")"
fi

# ── MCP: discovery reachable; full OAuth round-trip is in mcp-roundtrip.sh ────
ok "mcp-protected-resource-discovery" 200 \
  "$(curl -sS -o /dev/null -w '%{http_code}' "https://mcp.${SUPASTACK_APEX}/.well-known/oauth-protected-resource")"
if [ -n "${SUPASTACK_MCP_TOKEN:-}" ]; then
  notcode "mcp-bearer-not-401" 401 \
    "$(curl -sS -o /dev/null -w '%{http_code}' -H "authorization: Bearer ${SUPASTACK_MCP_TOKEN}" -H 'accept: application/json, text/event-stream' "https://mcp.${SUPASTACK_APEX}/mcp")"
else
  echo "[CLIMCP] mcp-oauth-roundtrip STATUS=SKIP (set SUPASTACK_MCP_TOKEN, or run mcp-roundtrip.sh)"
fi

echo "[CLIMCP] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
