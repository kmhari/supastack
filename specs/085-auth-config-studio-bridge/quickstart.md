# Quickstart: verify Auth Config Studio parity

Target: `supaviser.dev`, project `tbnqljlgozpxzhkjxats`, operator `hari@f22labs.com`. Replace the token each run.

```bash
APEX=supaviser.dev ; REF=tbnqljlgozpxzhkjxats
AT=$(curl -sS "https://$APEX/auth/v1/token?grant_type=password" -H 'content-type: application/json' \
  --data-raw '{"email":"hari@f22labs.com","password":"<pw>"}' | grep -oE '"access_token":"[^"]*"' | head -1 | cut -d'"' -f4)
P="https://$APEX/api/v1/platform/auth/$REF/config"
```

## 1. PATCH with the Studio-shaped (uppercase) payload → 200 (was 500)

```bash
curl -sS -o /dev/null -w 'PATCH config → %{http_code}\n' -X PATCH "$P" \
  -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  --data-raw '{"EXTERNAL_GITHUB_ENABLED":true,"EXTERNAL_GITHUB_CLIENT_ID":"id","EXTERNAL_GITHUB_SECRET":"secret","EXTERNAL_GITHUB_EMAIL_OPTIONAL":false}'
# expect 200   (SC-001)
```

## 2. GET returns uppercase keys; the change round-trips (US2/SC-003)

```bash
curl -sS "$P" -H "authorization: Bearer $AT" \
  | python3 -c "import sys,json;d=json.load(sys.stdin);print('GITHUB_ENABLED=',d.get('EXTERNAL_GITHUB_ENABLED'));print('SITE_URL key present=', 'SITE_URL' in d)"
# expect EXTERNAL_GITHUB_ENABLED True, uppercase keys present
```

## 3. Provider actually in effect after reload (SC-004)

```bash
ANON=$(curl -sS -H "authorization: Bearer $AT" "https://$APEX/api/v1/platform/projects/$REF/settings" \
  | python3 -c "import sys,json;print(json.load(sys.stdin)['service_api_keys'][0]['api_key'])")
sleep 30  # GoTrue reload window
curl -sS -H "apikey: $ANON" "https://$REF.$APEX/auth/v1/settings" \
  | python3 -c "import sys,json;print('github enabled =', json.load(sys.stdin)['external']['github'])"
# expect github enabled = True
```

## 4. Invalid field → 400 with the field named (uppercase), not 500 (SC-006)

```bash
curl -sS -w '\n→ %{http_code}\n' -X PATCH "$P" -H "authorization: Bearer $AT" -H 'content-type: application/json' \
  --data-raw '{"NONSENSE_FIELD_XYZ":1}'
# expect 400 + details naming NONSENSE_FIELD_XYZ (not {"code":"internal"} 500)
```

## 5. Hooks round-trip (US4/SC-007)

```bash
H="$P/hooks"
curl -sS -o /dev/null -w 'GET hooks → %{http_code}\n' "$H" -H "authorization: Bearer $AT"   # 200, loads
curl -sS -o /dev/null -w 'PATCH hooks → %{http_code}\n' -X PATCH "$H" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' \
  --data-raw '{"HOOK_CUSTOM_ACCESS_TOKEN_ENABLED":true,"HOOK_CUSTOM_ACCESS_TOKEN_URI":"pg-functions://postgres/public/my_hook"}'
# 200; then GET shows it enabled
```

## 6. No-regression: the CLI/Management `/v1` path unchanged (SC-005)

```bash
# lowercase still works on the /v1 host; uppercase still rejected there (intended)
curl -sS -o /dev/null -w 'mgmt lowercase PATCH → %{http_code}\n' -X PATCH \
  "https://api.$APEX/v1/projects/$REF/config/auth" -H "authorization: Bearer $AT" \
  -H 'content-type: application/json' --data-raw '{"site_url":"https://example.test"}'
# expect 200 (or the project-not-running 409); NOT changed by this feature
```

## Unit / contract (CI)

```bash
pnpm exec vitest run apps/api/tests/unit/auth-config-case.test.ts \
  apps/api/tests/unit/auth-config-bridge.test.ts \
  apps/api/tests/unit/auth-config-response-shape.test.ts
```
Expect: translation round-trip (happy), alias + `_supastack` meta untouched (edge), bridge uppercase PATCH→200 / GET uppercase (happy), unknown field→400 (sad), and the `/v1` shape snapshot unchanged.

## Done when

All of §1–6 pass on the VM, the unit/contract suite is green, and the 4 Auth Config rows in `API-FULL-COMPARISON.md` are flipped ⚠️→✅ behind the coverage guard.
