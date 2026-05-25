#!/usr/bin/env bash
#
# E2E: validates `supabase postgres-config` + `supabase config --auth-*`
# against a live selfbase deployment.
#
# Acceptance gate for spec 009 FR-012, FR-013, SC-007, SC-009.
#
# Run locally:
#
#   SELFBASE_APEX=supaviser.dev \
#   SELFBASE_PAT=sbp_<40hex> \
#   SELFBASE_PROJECT_REF=<20-char-ref> \
#     bash tests/cli-e2e/postgres-config-and-auth-config.sh
#
# Exit non-zero if any step fails or if the upstream CLI version drifts past
# the pin (R-010): we want CLI upgrades to be a deliberate test-update PR,
# not a silent CI passthrough.

set -euo pipefail

# ─── CLI version pin (research.md R-010, FR-013) ─────────────────────────────
# Validated against this version. If the CLI is older or newer and a flag has
# renamed / a response shape has shifted, the assertions below will catch it;
# we still fail fast here so the test author has to acknowledge the bump.
SUPABASE_CLI_VERSION_PIN="2.41.0"

if ! command -v supabase >/dev/null; then
  echo "FAIL: 'supabase' CLI not on PATH" >&2
  exit 1
fi

cli_version=$(supabase --version 2>/dev/null | awk '{print $NF}')
if [[ "$cli_version" != "$SUPABASE_CLI_VERSION_PIN" ]]; then
  echo "FAIL: supabase CLI version mismatch." >&2
  echo "      Validated against: $SUPABASE_CLI_VERSION_PIN" >&2
  echo "      Found:             $cli_version" >&2
  echo "      Re-validate the script against the new CLI version, update the pin," >&2
  echo "      and document any flag/response shape drift before removing this gate." >&2
  exit 1
fi

: "${SELFBASE_APEX:?SELFBASE_APEX required}"
: "${SELFBASE_PAT:?SELFBASE_PAT required}"
: "${SELFBASE_PROJECT_REF:?SELFBASE_PROJECT_REF required}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

cat > "$WORK/selfbase.toml" <<EOF
name          = "selfbase-config-e2e"
api_url       = "https://api.${SELFBASE_APEX}"
dashboard_url = "https://${SELFBASE_APEX}/dashboard"
project_host  = "${SELFBASE_APEX}"
EOF

export SUPABASE_ACCESS_TOKEN="$SELFBASE_PAT"
REF="$SELFBASE_PROJECT_REF"

cd "$WORK"

# ─── 1. postgres-config get/update/get round-trip ────────────────────────────
echo "[1/6] postgres-config get (baseline)"
supabase postgres-config get --project-ref "$REF" > pg-before.json
original_max_rows=$(jq -r '.max_rows' pg-before.json)
echo "      baseline max_rows = $original_max_rows"

echo "[2/6] postgres-config update --max-rows 5000"
supabase postgres-config update --project-ref "$REF" --max-rows 5000
supabase postgres-config get --project-ref "$REF" > pg-after.json
got_max=$(jq -r '.max_rows' pg-after.json)
if [[ "$got_max" != "5000" ]]; then
  echo "FAIL: max_rows after update is '$got_max', expected 5000" >&2
  exit 1
fi
echo "      OK — max_rows = 5000"

# ─── 2. Validation rejection (negative max_rows) ─────────────────────────────
echo "[3/6] postgres-config update --max-rows -1 (must fail)"
if supabase postgres-config update --project-ref "$REF" --max-rows -1 > /dev/null 2>&1; then
  echo "FAIL: negative max_rows was accepted" >&2
  exit 1
fi
# Re-fetch and confirm the value did NOT change to -1.
supabase postgres-config get --project-ref "$REF" > pg-after-reject.json
still_max=$(jq -r '.max_rows' pg-after-reject.json)
if [[ "$still_max" != "5000" ]]; then
  echo "FAIL: max_rows changed after rejected update (now '$still_max')" >&2
  exit 1
fi
echo "      OK — rejection preserved prior value"

# ─── 3. auth-config get baseline ─────────────────────────────────────────────
echo "[4/6] config get (auth baseline)"
supabase config get --project-ref "$REF" > auth-before.json
original_jwt_exp=$(jq -r '.jwt_exp' auth-before.json)
echo "      baseline jwt_exp = $original_jwt_exp"

# ─── 4. auth-config update jwt expiry ────────────────────────────────────────
echo "[5/6] config update --auth-jwt-expiry 7200"
supabase config update --project-ref "$REF" --auth-jwt-expiry 7200
supabase config get --project-ref "$REF" > auth-after.json
got_jwt_exp=$(jq -r '.jwt_exp' auth-after.json)
if [[ "$got_jwt_exp" != "7200" ]]; then
  echo "FAIL: jwt_exp after update is '$got_jwt_exp', expected 7200" >&2
  exit 1
fi
echo "      OK — jwt_exp = 7200"

# ─── 5. Restore originals so the script is re-runnable ───────────────────────
echo "[6/6] restoring original values"
supabase postgres-config update --project-ref "$REF" --max-rows "$original_max_rows" >/dev/null
supabase config update --project-ref "$REF" --auth-jwt-expiry "$original_jwt_exp" >/dev/null

echo "PASS — all postgres-config + auth-config CLI commands validated against CLI $cli_version"
