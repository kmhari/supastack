#!/usr/bin/env bash
#
# T017 — Live-VM E2E for feature 011 CLI device-code login.
#
# Drives the FULL mint → poll → decrypt round-trip via curl (no `supabase
# login` interactive shell needed — the protocol is what we're testing).
#
# Verifies:
#   1. POST /api/v1/cli/login with a freshly-generated client P-256 keypair
#      returns 200 + 8-char device_code (SC-001 component)
#   2. Replay of the same session_id returns 409 session_in_use (SC-005)
#   3. GET /platform/cli/login/<id>?device_code=<code> returns the encrypted
#      bundle; same field shape as the upstream CLI's AccessTokenResponse
#   4. The encrypted access_token decrypts (with the client priv key) to a
#      valid sbp_ PAT — proving wire compatibility with the upstream CLI
#   5. Second GET returns 404 (single-use, SC-005)
#   6. SC-008 log-leak check: no `sbp_[0-9a-f]{40}` pattern in api/web logs
#
# Requirements: bash, curl, jq, openssl (≥3.0 for ECDH), python3 (with cryptography
# OR a node script as fallback for the decrypt step), ssh access to VM.
#
# Env:
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_DASHBOARD_COOKIE=<sb_sid cookie value from a logged-in browser>
#   SUPASTACK_VM_HOST=ubuntu@148.113.1.164  (optional — skips log-leak check if unset)

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_DASHBOARD_COOKIE:?SUPASTACK_DASHBOARD_COOKIE required (sb_sid value)}"

API="https://api.${SUPASTACK_APEX}"
SESSION_ID=$(python3 -c 'import uuid; print(uuid.uuid4())')

echo "==> 0. Generate client ECDH-P256 keypair via Node (simulates the CLI)"
KEYS=$(node -e '
const c = require("crypto");
const e = c.createECDH("prime256v1");
e.generateKeys();
console.log(JSON.stringify({
  priv: e.getPrivateKey().toString("hex"),
  pub: e.getPublicKey().toString("hex"),
}));
')
CLIENT_PRIV=$(echo "$KEYS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["priv"])')
CLIENT_PUB=$(echo "$KEYS" | python3 -c 'import sys,json; print(json.load(sys.stdin)["pub"])')
echo "    session_id=${SESSION_ID}"
echo "    client_pub=${CLIENT_PUB:0:20}…${CLIENT_PUB:120:10}"

echo "==> 1. POST /api/v1/cli/login (mint)"
START_NS=$(date +%s%N)
RES=$(curl -sk -w '\n%{http_code}' -X POST "${API}/api/v1/cli/login" \
  -H "Cookie: sb_sid=${SUPASTACK_DASHBOARD_COOKIE}" \
  -H "Content-Type: application/json" \
  --data-raw "{\"session_id\":\"${SESSION_ID}\",\"token_name\":\"cli_e2e_$(date +%s)\",\"public_key\":\"${CLIENT_PUB}\"}")
END_NS=$(date +%s%N)
CODE=$(echo "$RES" | tail -1)
BODY=$(echo "$RES" | sed '$d')
echo "    HTTP ${CODE} in $(( (END_NS - START_NS) / 1000000 ))ms"
[ "$CODE" = "200" ] || { echo "FAIL: mint returned ${CODE}: ${BODY}"; exit 1; }
DEVICE_CODE=$(echo "$BODY" | python3 -c 'import sys,json; print(json.load(sys.stdin)["device_code"])')
[[ "$DEVICE_CODE" =~ ^[0-9a-f]{8}$ ]] || { echo "FAIL: device_code shape wrong: ${DEVICE_CODE}"; exit 1; }
echo "    ✓ device_code=${DEVICE_CODE}"

echo "==> 2. Replay same session_id → expect 409"
REPLAY_CODE=$(curl -sk -o /dev/null -w '%{http_code}' -X POST "${API}/api/v1/cli/login" \
  -H "Cookie: sb_sid=${SUPASTACK_DASHBOARD_COOKIE}" \
  -H "Content-Type: application/json" \
  --data-raw "{\"session_id\":\"${SESSION_ID}\",\"token_name\":\"cli_e2e_replay\",\"public_key\":\"${CLIENT_PUB}\"}")
[ "$REPLAY_CODE" = "409" ] || { echo "FAIL: replay returned ${REPLAY_CODE}, expected 409"; exit 1; }
echo "    ✓ replay rejected"

echo "==> 3. GET /platform/cli/login/<session>?device_code=<code>"
POLL_RES=$(curl -sk "${API}/platform/cli/login/${SESSION_ID}?device_code=${DEVICE_CODE}")
SHAPE=$(echo "$POLL_RES" | python3 -c 'import sys,json; b=json.load(sys.stdin); print(",".join(sorted(b.keys())))')
[ "$SHAPE" = "access_token,created_at,id,nonce,public_key" ] || { echo "FAIL: response shape wrong: ${SHAPE}"; exit 1; }
echo "    ✓ response shape matches CliLoginResponse"

echo "==> 4. Decrypt access_token with client priv key — recover sbp_ PAT"
PAT=$(node -e '
const c = require("crypto");
const bundle = JSON.parse(process.argv[1]);
const cliPriv = process.argv[2];
const ecdh = c.createECDH("prime256v1");
ecdh.setPrivateKey(Buffer.from(cliPriv, "hex"));
const secret = ecdh.computeSecret(Buffer.from(bundle.public_key, "hex"));
const all = Buffer.from(bundle.access_token, "hex");
const tag = all.subarray(all.length - 16);
const ct = all.subarray(0, all.length - 16);
const decipher = c.createDecipheriv("aes-256-gcm", secret, Buffer.from(bundle.nonce, "hex"));
decipher.setAuthTag(tag);
process.stdout.write(Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8"));
' "$POLL_RES" "$CLIENT_PRIV")
[[ "$PAT" =~ ^sbp_[0-9a-f]{40}$ ]] || { echo "FAIL: decrypted PAT shape wrong (length ${#PAT})"; exit 1; }
echo "    ✓ recovered ${PAT:0:12}… (40 hex)"

echo "==> 5. Second GET — expect 404 (single-use)"
SECOND_CODE=$(curl -sk -o /dev/null -w '%{http_code}' "${API}/platform/cli/login/${SESSION_ID}?device_code=${DEVICE_CODE}")
[ "$SECOND_CODE" = "404" ] || { echo "FAIL: second poll returned ${SECOND_CODE}, expected 404"; exit 1; }
echo "    ✓ single-use enforced"

echo "==> 6. Verify the minted PAT works against the management API"
PROJECTS=$(curl -sk "${API}/v1/projects" -H "Authorization: Bearer ${PAT}")
echo "$PROJECTS" | python3 -c 'import sys,json; assert isinstance(json.load(sys.stdin), list)' || {
  echo "FAIL: PAT didn't authenticate against /v1/projects"; echo "$PROJECTS"; exit 1;
}
echo "    ✓ PAT authenticates against /v1/projects"

if [ -n "${SUPASTACK_VM_HOST:-}" ]; then
  echo "==> 7. SC-008: log-leak check (no plaintext PATs in container logs)"
  set +o pipefail
  LEAK=$(ssh "${SUPASTACK_VM_HOST}" "sudo docker logs --since 2m supastack-api-1 supastack-web-1 2>&1 | grep -cE 'sbp_[0-9a-f]{40}' || true" 2>/dev/null | tr -d '[:space:]')
  set -o pipefail
  if [ "$LEAK" != "0" ]; then
    echo "FAIL: ${LEAK} sbp_ pattern matches in logs"
    exit 1
  fi
  echo "    ✓ zero plaintext PATs in logs"
fi

echo "==> ✓ feature 011 CLI device-code login E2E passed"
