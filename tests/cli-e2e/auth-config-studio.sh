#!/usr/bin/env bash
#
# auth-config-studio.sh — feature 085: the per-project auth-config bridge accepts
# Studio's UPPERCASE GoTrue-config field names, returns them upper-cased, surfaces
# validation 400s (not 500), supports /config/hooks, and does NOT regress the /v1
# (lowercase, CLI) Management API.
#
# Spec: specs/085-auth-config-studio-bridge/spec.md · quickstart.md §1–6
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_TOKEN=<operator GoTrue JWT or admin PAT>
#   SUPASTACK_REF=<a running project ref the operator owns>
#
# Output: [AUTHCFG] <CHECK> STATUS=<PASS|FAIL>  + end TOTAL/PASS/FAIL. Exit 0 iff zero FAILs.

set -uo pipefail
: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_TOKEN:?SUPASTACK_TOKEN required}"
: "${SUPASTACK_REF:?SUPASTACK_REF required (a running project)}"

AUTH=(-H "authorization: Bearer ${SUPASTACK_TOKEN}" -H 'content-type: application/json')
P="https://${SUPASTACK_APEX}/api/v1/platform/auth/${SUPASTACK_REF}/config"
V1="https://api.${SUPASTACK_APEX}/v1/projects/${SUPASTACK_REF}/config/auth"
PASS=0; FAIL=0
ok() { if [ "$2" = "$3" ]; then echo "[AUTHCFG] $1 STATUS=PASS ($3)"; PASS=$((PASS+1)); else echo "[AUTHCFG] $1 STATUS=FAIL (want $2 got $3)"; FAIL=$((FAIL+1)); fi; }

# 1. Studio-shaped (uppercase) PATCH → 200 (was 500).
BODY='{"EXTERNAL_GITHUB_ENABLED":true,"EXTERNAL_GITHUB_CLIENT_ID":"id","EXTERNAL_GITHUB_SECRET":"secret","EXTERNAL_GITHUB_EMAIL_OPTIONAL":false}'
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d "$BODY" "$P")
ok "uppercase-patch-200" 200 "$CODE"

# 2. GET returns UPPERCASE keys; the change round-trips.
GETBODY=$(curl -sS "${AUTH[@]}" "$P")
printf '%s' "$GETBODY" | grep -q '"EXTERNAL_GITHUB_ENABLED"' && ok "get-uppercase-keys" yes yes || ok "get-uppercase-keys" yes no
printf '%s' "$GETBODY" | grep -q '"external_github_enabled"' && ok "get-no-lowercase-leak" no yes || ok "get-no-lowercase-leak" no no

# 3. Invalid field → 400 naming the field (uppercase), not 500 internal.
ERR=$(curl -sS -X PATCH "${AUTH[@]}" -d '{"NONSENSE_FIELD_XYZ":1}' "$P")
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d '{"NONSENSE_FIELD_XYZ":1}' "$P")
ok "invalid-field-400" 400 "$CODE"
printf '%s' "$ERR" | grep -q 'NONSENSE_FIELD_XYZ' && ok "invalid-names-field" yes yes || ok "invalid-names-field" yes no
printf '%s' "$ERR" | grep -q '"code":"internal"' && ok "not-masked-500" no yes || ok "not-masked-500" no no

# 4. Hooks round-trip.
ok "hooks-get-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$P/hooks")"
HOOK='{"HOOK_CUSTOM_ACCESS_TOKEN_ENABLED":true,"HOOK_CUSTOM_ACCESS_TOKEN_URI":"pg-functions://postgres/public/my_hook"}'
ok "hooks-patch-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d "$HOOK" "$P/hooks")"
curl -sS "${AUTH[@]}" "$P/hooks" | grep -q '"HOOK_CUSTOM_ACCESS_TOKEN_ENABLED":true' && ok "hooks-roundtrip" yes yes || ok "hooks-roundtrip" yes no

# 5. No-regression: the /v1 (lowercase) path still accepts lowercase (not changed by 085).
V1CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d '{"site_url":"https://example.test"}' "$V1")
# 200 (applied) or 409 (project transiently not running) — anything but a 4xx-validation/5xx regression.
case "$V1CODE" in 200|202|409) ok "v1-lowercase-no-regression" ok "$V1CODE" ;; *) ok "v1-lowercase-no-regression" ok "FAIL-$V1CODE" ;; esac

echo "[AUTHCFG] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
