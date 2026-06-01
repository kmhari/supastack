#!/usr/bin/env bash
#
# auth-config-behavioral-parity.sh — drives PATCH+assert cycles for every
# honored field in AUTH_CONFIG_FIELD_STATUS against a live supastack project.
#
# Spec: specs/020-auth-providers-dashboard/spec.md US3, FR-006, SC-004
# Plan: specs/020-auth-providers-dashboard/plan.md §B1
# Task: T036
#
# Strategy: read the honored field set from the Management API GET response's
# `_supastack.fieldStatus` extension (US4) — that's the source of truth and
# auto-stays-in-sync with the backend. For each honored field, PATCH a known
# new value, wait for the container restart, and run a corresponding assertion
# from the helper library. Fields without a dedicated assertion fall back to
# `assert_env_var_present` (container-level env grep).
#
# Env (required):
#   SUPASTACK_APEX=supaviser.dev
#   SUPASTACK_PAT=sbp_xxxxx                 (admin PAT)
#   SUPASTACK_TEST_PROJECT_REF=<20-char>    (a project to mutate)
# Env (optional):
#   SUPASTACK_VM_HOST=ubuntu@148.113.1.164  (for `docker exec` env checks)
#   SUPASTACK_TEST_ANON_KEY=eyJ...          (for endpoints that require apikey)
#
# Output:
#   Per-field: [BEHAVIORAL] FIELD=<name> STATUS=<PASS|FAIL|SKIP> ELAPSED=<s>s
#   End:       [BEHAVIORAL] TOTAL=<n> PASS=<n> FAIL=<n> SKIP=<n>
#   Exit 0 only if zero FAILs.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_TEST_PROJECT_REF:?SUPASTACK_TEST_PROJECT_REF required}"

# shellcheck source=helpers/auth-config-assertions.sh
source "$(dirname "$0")/helpers/auth-config-assertions.sh"

MGMT_URL="https://${SUPASTACK_APEX}/v1/projects/${SUPASTACK_TEST_PROJECT_REF}/config/auth"
START_TS=$(date +%s)

echo "[BEHAVIORAL] start ref=${SUPASTACK_TEST_PROJECT_REF}"

# Pull the field-status extension (US4 must be deployed for this to work).
status_json=$(curl -sSf -H "Authorization: Bearer ${SUPASTACK_PAT}" "$MGMT_URL")
honored_fields=$(echo "$status_json" | jq -r '._supastack.fieldStatus | to_entries[] | select(.value.status=="honored") | .key')
total=$(echo "$honored_fields" | wc -l | tr -d ' ')
echo "[BEHAVIORAL] honored_count=$total"

pass=0; fail=0; skip=0

# Pick a value to PATCH for each field type. The combination of strategies
# below covers booleans, numbers, strings, and URLs.
choose_test_value() {
  local field="$1"
  case "$field" in
    *_enabled)              echo "true" ;;
    *_optional)             echo "true" ;;
    *_skip_nonce_check)     echo "true" ;;
    *_secret|*_pass|*_auth_token)
                            echo '"probe-secret-'$$'"' ;;
    *_client_id|*_url|*_additional_client_ids|*_sender_name|*_admin_email)
                            echo '"probe-'$$'@example.test"' ;;
    jwt_exp)                echo "7200" ;;
    sessions_timebox)       echo "86400" ;;
    sessions_inactivity_timeout) echo "3600" ;;
    *_min_length)           echo "10" ;;
    *_required_characters)  echo '"abcd"' ;;
    *_otp_exp|*_otp_length) echo "300" ;;
    *_max_frequency|*_max_pool_size|*_max_request_duration|*_reuse_interval)
                            echo "30" ;;
    rate_limit_*)           echo "100" ;;
    *_subjects_*|*_templates_*_content|disable_signup|mailer_*|webauthn_rp_*|site_url|uri_allow_list|sessions_tags|*_sb_forwarded_for_enabled|*_require_reauthentication)
                            echo '"probe-value"' ;;
    *)                      echo '"probe"' ;;
  esac
}

# Dispatch table: field → assertion function.
choose_assertion() {
  local field="$1"
  case "$field" in
    jwt_exp)                echo "assert_jwt_exp" ;;
    external_*_enabled)
      # external_<provider>_enabled → check OAuth authorize redirects to provider
      local provider="${field#external_}"
      provider="${provider%_enabled}"
      # OIDC-suffixed providers redirect via the same authorize route, but
      # the provider name in the URL is the un-prefixed key.
      provider="${provider%_oidc}"
      echo "assert_oauth_authorize_redirects ${provider}"
      ;;
    rate_limit_email_sent)  echo "assert_rate_limit_429 /auth/v1/recover" ;;
    *)
      # Look up the field's envName and fall back to env-var presence.
      local envname
      envname=$(echo "$status_json" | jq -r --arg f "$field" '._supastack.fieldStatus[$f].envName // empty')
      if [ -n "$envname" ]; then
        echo "assert_env_var_present ${envname} STRINGIFIED"
      else
        echo "skip"
      fi
      ;;
  esac
}

while IFS= read -r FIELD_NAME; do
  [ -z "$FIELD_NAME" ] && continue
  iter_start=$(date +%s)
  NEW_VALUE=$(choose_test_value "$FIELD_NAME")
  assertion=$(choose_assertion "$FIELD_NAME")
  if [ "$assertion" = "skip" ]; then
    skip=$((skip + 1))
    echo "[BEHAVIORAL] FIELD=$FIELD_NAME STATUS=SKIP REASON=no-assertion"
    continue
  fi

  # PATCH + restart wait
  if ! patch_field "$FIELD_NAME" "$NEW_VALUE"; then
    fail=$((fail + 1))
    echo "[BEHAVIORAL] FIELD=$FIELD_NAME STATUS=FAIL REASON=patch-or-restart"
    continue
  fi

  # Substitute STRINGIFIED placeholder with the (unquoted) NEW_VALUE
  expected="${NEW_VALUE//\"/}"
  assertion="${assertion/STRINGIFIED/$expected}"

  export FIELD_NAME NEW_VALUE
  if eval "$assertion"; then
    pass=$((pass + 1))
    echo "[BEHAVIORAL] FIELD=$FIELD_NAME STATUS=PASS ELAPSED=$(( $(date +%s) - iter_start ))s"
  else
    fail=$((fail + 1))
    echo "[BEHAVIORAL] FIELD=$FIELD_NAME STATUS=FAIL ELAPSED=$(( $(date +%s) - iter_start ))s"
  fi
done <<< "$honored_fields"

total_elapsed=$(( $(date +%s) - START_TS ))
echo "[BEHAVIORAL] TOTAL=$total PASS=$pass FAIL=$fail SKIP=$skip ELAPSED=${total_elapsed}s"

[ "$fail" -eq 0 ]
