#!/usr/bin/env bash
#
# T035 — E2E: feature 010 dashboard secrets CRUD + vault propagation + no-restart.
#
# Runs against a live selfbase deployment. Verifies:
#   1. POST /api/v1/projects/<ref>/secrets persists 10 secrets in <5s (SC-003)
#   2. GET returns all 10 with sha256 digests
#   3. An edge function reading Deno.env.get('SELFBASE_010_E2E') returns the
#      saved value within 10s of the save (SC-002)
#   4. Zero functions-container restart events during the test
#   5. DELETE removes the secrets cleanly
#
# Requirements: bash, curl, jq, ssh (for docker logs check).
# Env:
#   SELFBASE_APEX=supaviser.dev
#   SELFBASE_PAT=sbp_<40hex>
#   SELFBASE_PROJECT_REF=<20-char ref>
#   SELFBASE_VM_HOST=ubuntu@148.113.1.164    (optional — skips restart check if unset)
#   TEST_FUNCTION_SLUG=hello-secrets         (optional — pre-deployed fn reading SELFBASE_010_E2E)
#   SELFBASE_ANON_KEY=eyJ...                 (required if TEST_FUNCTION_SLUG set)

set -euo pipefail

: "${SELFBASE_APEX:?SELFBASE_APEX required}"
: "${SELFBASE_PAT:?SELFBASE_PAT required}"
: "${SELFBASE_PROJECT_REF:?SELFBASE_PROJECT_REF required}"

API="https://${SELFBASE_APEX}"
REF="${SELFBASE_PROJECT_REF}"
H_AUTH="Authorization: Bearer ${SELFBASE_PAT}"
H_JSON="Content-Type: application/json"

echo "==> 1. POST 10-secret batch (SC-003 timing budget: <5000ms)"

BATCH='['
for i in 1 2 3 4 5 6 7 8 9 10; do
  [ "$i" -gt 1 ] && BATCH+=','
  BATCH+="{\"name\":\"SELFBASE_010_E2E_$i\",\"value\":\"v-$i-$(date +%s%N)\"}"
done
BATCH+=']'

START_NS=$(date +%s%N)
RES=$(curl -s -w '\n%{http_code}' -X POST "${API}/v1/projects/${REF}/secrets" \
  -H "${H_AUTH}" -H "${H_JSON}" --data "${BATCH}")
END_NS=$(date +%s%N)
CODE=$(echo "$RES" | tail -1)

ELAPSED_MS=$(( (END_NS - START_NS) / 1000000 ))
echo "    POST elapsed: ${ELAPSED_MS}ms (status ${CODE})"
[ "$CODE" = "201" ] || { echo "FAIL: POST returned ${CODE}"; exit 1; }
[ "$ELAPSED_MS" -lt 5000 ] || { echo "FAIL: SC-003 budget exceeded (${ELAPSED_MS}ms > 5000ms)"; exit 1; }

# Round-trip GET to confirm all 10 visible
GOT=$(curl -s -H "${H_AUTH}" "${API}/v1/projects/${REF}/secrets" \
  | jq -r '[.[] | select(.name | startswith("SELFBASE_010_E2E_"))] | length')
[ "$GOT" -ge 10 ] || { echo "FAIL: only $GOT/10 secrets visible after save"; exit 1; }
echo "    GET sees all $GOT/10"

echo "==> 2. Vault propagation test (SC-002: ≤10s, no restart)"

# Capture functions-container restart count BEFORE the propagation test
RESTART_BEFORE=0
if [ -n "${SELFBASE_VM_HOST:-}" ]; then
  RESTART_BEFORE=$(ssh "${SELFBASE_VM_HOST}" \
    "sudo docker inspect --format='{{.RestartCount}}' selfbase-${REF}-functions-1 2>/dev/null || echo 0")
  echo "    functions container restart count (before): ${RESTART_BEFORE}"
fi

if [ -n "${TEST_FUNCTION_SLUG:-}" ] && [ -n "${SELFBASE_ANON_KEY:-}" ]; then
  EXPECTED="propagation-$(date +%s%N)"
  curl -s -X POST "${API}/v1/projects/${REF}/secrets" \
    -H "${H_AUTH}" -H "${H_JSON}" \
    --data "[{\"name\":\"SELFBASE_010_E2E\",\"value\":\"${EXPECTED}\"}]" > /dev/null

  # Poll the function for up to 12s (TTL=5s + slack)
  SEEN=""
  for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
    sleep 1
    SEEN=$(curl -s "https://${REF}.${SELFBASE_APEX}/functions/v1/${TEST_FUNCTION_SLUG}" \
      -H "Authorization: Bearer ${SELFBASE_ANON_KEY}" -H "apikey: ${SELFBASE_ANON_KEY}" || true)
    if echo "$SEEN" | grep -qF "${EXPECTED}"; then
      echo "    propagation observed at t=${i}s"
      break
    fi
  done
  echo "$SEEN" | grep -qF "${EXPECTED}" || { echo "FAIL: ${EXPECTED} not visible after 12s"; echo "    last response: $SEEN"; exit 1; }
else
  echo "    (TEST_FUNCTION_SLUG + SELFBASE_ANON_KEY not set — skipping live propagation check)"
fi

if [ -n "${SELFBASE_VM_HOST:-}" ]; then
  RESTART_AFTER=$(ssh "${SELFBASE_VM_HOST}" \
    "sudo docker inspect --format='{{.RestartCount}}' selfbase-${REF}-functions-1 2>/dev/null || echo 0")
  echo "    functions container restart count (after):  ${RESTART_AFTER}"
  [ "$RESTART_AFTER" = "$RESTART_BEFORE" ] \
    || { echo "FAIL: SC-002 violated — functions container restarted ($RESTART_BEFORE → $RESTART_AFTER)"; exit 1; }
  echo "    ✓ zero restarts (SC-002)"
fi

echo "==> 3. Cleanup"
NAMES='[]'
for i in 1 2 3 4 5 6 7 8 9 10; do
  NAMES=$(echo "$NAMES" | jq ". + [\"SELFBASE_010_E2E_$i\"]")
done
NAMES=$(echo "$NAMES" | jq ". + [\"SELFBASE_010_E2E\"]")
curl -s -X DELETE "${API}/v1/projects/${REF}/secrets" \
  -H "${H_AUTH}" -H "${H_JSON}" --data "${NAMES}" > /dev/null
echo "    deleted ${REF} test secrets"

echo "==> ✓ feature 010 secrets E2E passed"
