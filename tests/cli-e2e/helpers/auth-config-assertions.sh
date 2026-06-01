#!/usr/bin/env bash
#
# auth-config-assertions.sh — per-field behavioral assertions consumed by
# tests/cli-e2e/auth-config-behavioral-parity.sh.
#
# Each function is named `assert_<dispatch_key>` and:
#   - takes no arguments (reads $SUPASTACK_APEX, $SUPASTACK_PAT,
#     $SUPASTACK_TEST_PROJECT_REF, $FIELD_NAME, $NEW_VALUE from env)
#   - returns 0 on PASS, non-zero on FAIL
#   - emits a one-line `[ASSERT] FIELD=<name> RESULT=<PASS|FAIL>` log
#
# Spec: specs/020-auth-providers-dashboard/data-model.md §5
# Plan: specs/020-auth-providers-dashboard/plan.md §B2
# Task: T035
#
# Coverage: this library implements assertions for the high-signal honored
# fields (the ones operators care about and that exercise distinct GoTrue
# code paths). Fields with no dedicated assertion fall back to
# `assert_env_var_present` which checks that the container's env contains
# the mapped env line — a weak but always-applicable safety net that
# proves the runtime-config-store → .env pipeline worked end-to-end.

set -euo pipefail

# ─── helpers ────────────────────────────────────────────────────────────────

mgmt_url() {
  echo "https://${SUPASTACK_APEX}/v1/projects/${SUPASTACK_TEST_PROJECT_REF}/config/auth"
}

inst_url() {
  echo "https://${SUPASTACK_APEX}/api/v1/instances/${SUPASTACK_TEST_PROJECT_REF}"
}

provider_authorize_url() {
  local provider="$1"
  echo "https://${SUPASTACK_TEST_PROJECT_REF}.${SUPASTACK_APEX}/auth/v1/authorize?provider=${provider}"
}

container_name() {
  echo "supastack-${SUPASTACK_TEST_PROJECT_REF}-auth"
}

# Wait for the per-instance auth container to be healthy (status === 'running'
# in the control plane + /auth/v1/health 200).
wait_for_healthy() {
  local timeout_s=60 elapsed=0 delay=2
  while [ "$elapsed" -lt "$timeout_s" ]; do
    local status
    status=$(curl -sS -H "Authorization: Bearer ${SUPASTACK_PAT}" "$(inst_url)" | jq -r '.status // empty' || true)
    if [ "$status" = "running" ]; then
      if curl -sSf "https://${SUPASTACK_TEST_PROJECT_REF}.${SUPASTACK_APEX}/auth/v1/health" >/dev/null 2>&1; then
        return 0
      fi
    fi
    sleep "$delay"
    elapsed=$((elapsed + delay))
  done
  return 1
}

# Patch a single field and wait for the restart to settle.
patch_field() {
  local field="$1" value_json="$2"
  curl -sSf -X PATCH "$(mgmt_url)" \
    -H "Authorization: Bearer ${SUPASTACK_PAT}" \
    -H "Content-Type: application/json" \
    -d "{\"${field}\": ${value_json}}" >/dev/null
  wait_for_healthy || return 1
}

# Read a single env var inside the per-instance auth container.
exec_get_env() {
  local var="$1"
  ssh "${SUPASTACK_VM_HOST:-ubuntu@148.113.1.164}" \
    "sudo docker exec $(container_name) printenv ${var}" 2>/dev/null || echo ""
}

# ─── universal fallback assertion ───────────────────────────────────────────

# Asserts that the env-var mapped to $FIELD_NAME is set inside the auth
# container to a value derived from $NEW_VALUE (best-effort substring match).
# Used for any honored field without a dedicated assertion.
assert_env_var_present() {
  local env_name="$1"
  local expected="$2"
  local actual
  actual=$(exec_get_env "${env_name}")
  if [ -z "$actual" ] && [ -z "$expected" ]; then
    return 0  # both empty — env line correctly absent
  fi
  if [ "$actual" = "$expected" ]; then
    return 0
  fi
  echo "  env mismatch: expected ${env_name}=${expected!r}, got ${actual!r}" >&2
  return 1
}

# ─── per-field assertions ───────────────────────────────────────────────────

# Decode the exp - iat span on a freshly-minted JWT.
assert_jwt_exp() {
  local expected_ttl="${NEW_VALUE}"
  # Trigger an anonymous sign-in to get a JWT (requires anonymous_users_enabled).
  # If anonymous is disabled, fall back to env-var check.
  local resp
  resp=$(curl -sS -X POST "https://${SUPASTACK_TEST_PROJECT_REF}.${SUPASTACK_APEX}/auth/v1/signup" \
    -H "apikey: ${SUPASTACK_TEST_ANON_KEY:-}" \
    -H "Content-Type: application/json" \
    -d '{"email":"jwtprobe+'$$'@example.com","password":"hunter2hunter2"}' || true)
  local jwt
  jwt=$(echo "$resp" | jq -r '.access_token // empty')
  if [ -n "$jwt" ]; then
    local payload exp iat
    payload=$(echo "$jwt" | cut -d. -f2 | tr '_-' '/+' | base64 -d 2>/dev/null || true)
    exp=$(echo "$payload" | jq -r '.exp')
    iat=$(echo "$payload" | jq -r '.iat')
    local ttl=$((exp - iat))
    if [ "$ttl" = "$expected_ttl" ]; then return 0; fi
    echo "  jwt_exp mismatch: expected ttl=${expected_ttl}, got ${ttl}" >&2
    return 1
  fi
  # Fallback: check the env var
  assert_env_var_present "JWT_EXPIRY" "$expected_ttl"
}

# Verify a provider's authorize endpoint redirects to the IdP.
assert_oauth_authorize_redirects() {
  local provider="$1"
  local http_code
  http_code=$(curl -sS -o /dev/null -w '%{http_code}' "$(provider_authorize_url "$provider")")
  if [ "$http_code" = "302" ] || [ "$http_code" = "303" ]; then
    return 0
  fi
  echo "  ${provider} authorize returned ${http_code}, expected 302/303" >&2
  return 1
}

# Verify a rate-limit's effect by triggering N+1 requests.
assert_rate_limit_429() {
  local endpoint="$1"  # e.g. /auth/v1/recover
  local limit="${NEW_VALUE}"
  local i seen_429=0
  for i in $(seq 1 "$((limit + 2))"); do
    local code
    code=$(curl -sS -o /dev/null -w '%{http_code}' \
      -X POST "https://${SUPASTACK_TEST_PROJECT_REF}.${SUPASTACK_APEX}${endpoint}" \
      -H "apikey: ${SUPASTACK_TEST_ANON_KEY:-}" \
      -H "Content-Type: application/json" \
      -d "{\"email\":\"ratelimit+${i}@example.com\"}" || true)
    if [ "$code" = "429" ]; then seen_429=1; break; fi
  done
  [ "$seen_429" = "1" ]
}
