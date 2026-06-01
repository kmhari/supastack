#!/usr/bin/env bash
#
# T044 — E2E: drives the unmodified upstream `supabase` CLI against a live
# supastack deployment and asserts the full Connect-CLI + link + functions
# deploy flow works end-to-end.
#
# Runs BOTH wire formats:
#   1. `--use-api` (no Docker required on the runner)
#   2. default eszip path (requires Docker on the runner; CLI uses
#      `supabase/edge-runtime` locally to produce the bundle)
#
# Default off in PR CI. Run locally with:
#
#   SUPASTACK_APEX=cli-e2e.example.com \
#   SUPASTACK_PAT=sbp_<40hex> \
#   SUPASTACK_PROJECT_REF=<ref> \
#   SUPASTACK_ANON_KEY=eyJ... \
#   pnpm test:cli
#
# Requirements: supabase CLI ≥ 2.72.7 on PATH; curl, jq.
# For the eszip variant: Docker daemon running.
#
# Also covers FR-004: supabase login exit 0 + ~/.supabase/profile written +
# supabase projects list includes SUPASTACK_PROJECT_REF.

set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"
: "${SUPASTACK_ANON_KEY:=fake}"

# Skip eszip variant unless Docker is available.
RUN_ESZIP=1
if ! docker info >/dev/null 2>&1; then
  echo "[deploy-hello] Docker not running — skipping eszip variant; will only run --use-api."
  RUN_ESZIP=0
fi

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# --- 1. Write the profile -----------------------------------------------
cat > "$WORK/supastack.toml" <<EOF
name          = "supastack-e2e"
api_url       = "https://api.${SUPASTACK_APEX}"
dashboard_url = "https://${SUPASTACK_APEX}/dashboard"
project_host  = "${SUPASTACK_APEX}"
EOF

# --- 2. supabase login (FR-004 assertion) -------------------------------
echo "[deploy-hello] step 1/5: supabase login --profile <supastack.toml>"
# Use SUPABASE_ACCESS_TOKEN env to skip the interactive paste prompt.
SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase login --profile "$WORK/supastack.toml" --token "$SUPASTACK_PAT"
# Confirm ~/.supabase/profile was written by the login PostRunE hook.
test -f "$HOME/.supabase/profile" || {
  echo "FAIL: ~/.supabase/profile was not written"
  exit 1
}
echo "[deploy-hello] ✓ ~/.supabase/profile present"

# --- 3. supabase projects list includes our ref -------------------------
echo "[deploy-hello] step 2/5: supabase projects list"
LIST_OUTPUT=$(SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase --profile "$WORK/supastack.toml" projects list)
echo "$LIST_OUTPUT" | grep -q "$SUPASTACK_PROJECT_REF" || {
  echo "FAIL: projects list did not include $SUPASTACK_PROJECT_REF"
  echo "$LIST_OUTPUT"
  exit 1
}
echo "[deploy-hello] ✓ projects list includes the test ref"

# --- 4. Scaffold a minimal function -------------------------------------
SLUG="e2e-$$"
mkdir -p "$WORK/proj/supabase/functions/$SLUG"
cat > "$WORK/proj/supabase/functions/$SLUG/index.ts" <<EOF
Deno.serve(() => new Response('e2e-ok-$(date +%s)'));
EOF
# Minimal supabase config so the CLI doesn't complain.
cat > "$WORK/proj/supabase/config.toml" <<EOF
project_id = "$SUPASTACK_PROJECT_REF"
EOF
cd "$WORK/proj"

# --- 5a. Variant A: --use-api ------------------------------------------
echo "[deploy-hello] step 3/5: variant A (--use-api)"
SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase --profile "$WORK/supastack.toml" functions deploy "$SLUG" \
    --use-api --project-ref "$SUPASTACK_PROJECT_REF"
echo "[deploy-hello] ✓ --use-api deploy succeeded"

# Smoke the function. JWT verification may be on; tolerate either 200 or 401.
curl_status=$(curl -s -o /dev/null -w '%{http_code}' \
  "https://${SUPASTACK_PROJECT_REF}.${SUPASTACK_APEX}/functions/v1/${SLUG}" \
  -H "Authorization: Bearer ${SUPASTACK_ANON_KEY}") || true
echo "[deploy-hello]   public URL responded with ${curl_status}"
case "$curl_status" in
  2*|401) ;;
  *) echo "FAIL: unexpected status $curl_status from public URL"; exit 1;;
esac

# --- 5b. Variant B: default eszip --------------------------------------
if [ "$RUN_ESZIP" = "1" ]; then
  echo "[deploy-hello] step 4/5: variant B (default eszip)"
  SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
    supabase --profile "$WORK/supastack.toml" functions deploy "$SLUG" \
      --project-ref "$SUPASTACK_PROJECT_REF"
  echo "[deploy-hello] ✓ eszip deploy succeeded"
fi

# --- 6. Cleanup ---------------------------------------------------------
echo "[deploy-hello] step 5/5: cleanup"
SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase --profile "$WORK/supastack.toml" functions delete "$SLUG" \
    --project-ref "$SUPASTACK_PROJECT_REF"

echo "[deploy-hello] PASS"
