#!/usr/bin/env bash
#
# auth-config-studio.sh — feature 085: the per-project auth-config bridge accepts
# Studio's UPPERCASE GoTrue-config field names, returns them upper-cased, surfaces
# validation 400s (not 500), supports /config/hooks, and does NOT regress the /v1
# (lowercase, CLI) Management API.
#
# NON-DESTRUCTIVE: this script mutates the target project's auth config, so it
# SNAPSHOTS the touched fields up front and RESTORES them on exit (trap), even on
# failure. It never sends secret fields (`*_SECRET`/`*_SECRETS`) — partial-update
# leaves the real provider/hook secrets untouched. Still, prefer a throwaway test
# project; do not point it at production.
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

# ── Snapshot the fields this script mutates, then restore them on exit ────────
# Bool fields default to false (an empty GoTrue bool crashes auth — never null).
# String fields default to "". Secrets are never read/written here.
MUTATED='["SITE_URL","EXTERNAL_GITHUB_ENABLED","EXTERNAL_GITHUB_CLIENT_ID","EXTERNAL_GITHUB_EMAIL_OPTIONAL","HOOK_CUSTOM_ACCESS_TOKEN_ENABLED","HOOK_CUSTOM_ACCESS_TOKEN_URI"]'
BOOLS='["EXTERNAL_GITHUB_ENABLED","EXTERNAL_GITHUB_EMAIL_OPTIONAL","HOOK_CUSTOM_ACCESS_TOKEN_ENABLED"]'
ORIG=$(curl -sS "${AUTH[@]}" "$P")
if ! printf '%s' "$ORIG" | python3 -c "import sys,json;json.load(sys.stdin)" 2>/dev/null; then
  echo "[AUTHCFG] snapshot STATUS=FAIL (could not read current config — aborting before any mutation)"
  exit 1
fi

restore_config() {
  local payload
  payload=$(printf '%s' "$ORIG" | python3 -c "
import sys, json
o = json.load(sys.stdin)
keys = json.loads('${MUTATED}'); bools = set(json.loads('${BOOLS}'))
out = {}
for k in keys:
    v = o.get(k)
    if k in bools:
        out[k] = bool(v) if v is not None else False
    else:
        out[k] = v if isinstance(v, str) else ''
print(json.dumps(out))
" 2>/dev/null)
  if [ -n "$payload" ]; then
    curl -sS -o /dev/null -X PATCH "${AUTH[@]}" -d "$payload" "$P" >/dev/null 2>&1 || true
    echo "[AUTHCFG] restored mutated config fields to their pre-run values"
  fi
}
trap restore_config EXIT

# 1. Studio-shaped (uppercase) PATCH → 200 (was 500). No secret sent (preserves the real one).
BODY='{"EXTERNAL_GITHUB_ENABLED":true,"EXTERNAL_GITHUB_CLIENT_ID":"test-id-085","EXTERNAL_GITHUB_EMAIL_OPTIONAL":false}'
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d "$BODY" "$P")
ok "uppercase-patch-200" 200 "$CODE"

# 2. GET returns UPPERCASE keys; the change round-trips. (_supastack meta legitimately
#    keeps lowercase fieldStatus keys, so only inspect TOP-LEVEL config keys.)
GETBODY=$(curl -sS "${AUTH[@]}" "$P")
printf '%s' "$GETBODY" | grep -q '"EXTERNAL_GITHUB_ENABLED"' && ok "get-uppercase-keys" yes yes || ok "get-uppercase-keys" yes no
LEAK=$(printf '%s' "$GETBODY" | python3 -c "import sys,json; d=json.load(sys.stdin); print('yes' if any(k!='_supastack' and k!=k.upper() for k in d) else 'no')" 2>/dev/null)
ok "get-no-toplevel-lowercase" no "$LEAK"

# 3. Invalid field → 400 naming the field (uppercase), not 500 internal.
ERR=$(curl -sS -X PATCH "${AUTH[@]}" -d '{"NONSENSE_FIELD_XYZ":1}' "$P")
CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d '{"NONSENSE_FIELD_XYZ":1}' "$P")
ok "invalid-field-400" 400 "$CODE"
printf '%s' "$ERR" | grep -q 'NONSENSE_FIELD_XYZ' && ok "invalid-names-field" yes yes || ok "invalid-names-field" yes no
printf '%s' "$ERR" | grep -q '"code":"internal"' && ok "not-masked-500" no yes || ok "not-masked-500" no no

# 4. Hooks round-trip. NOTE: the hook URI points to a function that may not exist; the
#    EXIT trap disables it again. (An enabled hook → missing pg-function 500s token
#    issuance — see issue #101 — so this MUST be restored, which the trap guarantees.)
ok "hooks-get-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' "${AUTH[@]}" "$P/hooks")"
HOOK='{"HOOK_CUSTOM_ACCESS_TOKEN_ENABLED":true,"HOOK_CUSTOM_ACCESS_TOKEN_URI":"pg-functions://postgres/public/my_hook_085_test"}'
ok "hooks-patch-200" 200 "$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d "$HOOK" "$P/hooks")"
curl -sS "${AUTH[@]}" "$P/hooks" | grep -q '"HOOK_CUSTOM_ACCESS_TOKEN_ENABLED":true' && ok "hooks-roundtrip" yes yes || ok "hooks-roundtrip" yes no

# 5. No-regression: the /v1 (lowercase) path still accepts lowercase (not changed by 085).
V1CODE=$(curl -sS -o /dev/null -w '%{http_code}' -X PATCH "${AUTH[@]}" -d '{"site_url":"https://example.test"}' "$V1")
case "$V1CODE" in 200|202|409) ok "v1-lowercase-no-regression" "$V1CODE" "$V1CODE" ;; *) ok "v1-lowercase-no-regression" "2xx-or-409" "$V1CODE" ;; esac

echo "[AUTHCFG] TOTAL=$((PASS+FAIL)) PASS=${PASS} FAIL=${FAIL}"
[ "$FAIL" -eq 0 ]
