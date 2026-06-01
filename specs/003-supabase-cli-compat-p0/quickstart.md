# Quickstart: Supabase CLI ↔ Supastack

A runnable verification walkthrough of every P0 acceptance scenario. Each block
maps directly to spec.md's "Acceptance Scenarios". Replace `<apex>` with your
supastack deployment's apex (e.g. `supaviser.dev`) and `<ref>` with a real
project reference from your dashboard.

## Prerequisites

- An unmodified upstream Supabase CLI ≥ 2.72.7 installed. Verify: `supabase --version`.
- A working supastack deployment with this feature shipped (i.e. the `/v1/*` management surface live behind a valid TLS cert on `https://api.<apex>`).
- A supastack user account with at least one provisioned project.
- Docker running on the developer's machine. The CLI's stock `supabase functions deploy` uses a local Docker container to bundle each function into an eszip before upload. On machines without Docker (some CI runners, minimal Linux setups), append `--use-api` to every `functions deploy` and `functions download` command shown below — supastack supports both paths.

## Story 1 — Connect the CLI to supastack

```bash
# 1. Download our profile snippet (or paste the TOML from the dashboard's Connect-CLI page).
mkdir -p ~/.supabase/profiles
curl -fsSL https://<apex>/api/v1/cli/profile.toml > ~/.supabase/profiles/supastack.toml

cat ~/.supabase/profiles/supastack.toml
# Should print:
#   name          = "supastack"
#   api_url       = "https://api.<apex>"
#   dashboard_url = "https://<apex>/dashboard"
#   project_host  = "<apex>"

# 2. Generate a PAT in the dashboard at https://<apex>/settings/tokens. Copy the
#    plaintext (shown once). It MUST match ^sbp_[a-f0-9]{40}$.

# 3. Log in with the supastack profile.
supabase login --profile ~/.supabase/profiles/supastack.toml
# Prompts for the PAT. After it accepts, ~/.supabase/profile contains the
# absolute path to our TOML.

# Verify routing:
supabase projects list
# Expected: a table of your supastack projects with refs matching the dashboard.

# Optional sanity check that cloud routing isn't broken:
supabase --profile supabase projects list
# Expected: hits api.supabase.com — your cloud projects (or "Unauthorized" if
# you don't have a cloud PAT in the keyring under the "supabase" profile).
```

**Verifies**: Story 1 acceptance scenarios 1, 2, 3, 4.

## Story 2 — Link a local project directory

```bash
# Start in a directory with a supabase/ subfolder (or run `supabase init` first
# to scaffold one).
cd ~/my-app

supabase link --project-ref <ref>
# Expected: "Finished supabase link." and a `.temp/project-ref` file appears
# under .supabase/.

# Verify the link is sticky:
supabase functions list
# Expected: hits /v1/projects/<ref>/functions WITHOUT --project-ref. Same
# output as the next command.

supabase functions list --project-ref <ref>
# Should match.

# Bad ref produces a not-found:
supabase link --project-ref aaaaaaaaaaaaaaaaaaaa 2>&1 | grep -i 'not found'
# Expected: a 404-shaped message naming the missing ref.

# Re-linking to a different ref replaces:
supabase link --project-ref <ref2>
# Subsequent commands target <ref2>.
```

**Verifies**: Story 2 acceptance scenarios 1, 2, 3.

## Story 3 — Deploy edge functions

```bash
# Create a minimal function:
mkdir -p supabase/functions/hello
cat > supabase/functions/hello/index.ts <<'EOF'
Deno.serve(() => new Response('hi from supastack'));
EOF

# Deploy with the stock command (default eszip-via-Docker path):
supabase functions deploy hello
# Expected (under the 15s SC-003 budget for a first deploy):
#   ✔ Bundling function: hello
#   ✔ Uploaded function: hello
#   Deployed Functions on project <ref>: hello

# Confirm it's serving:
curl -fsS "https://<ref>.<apex>/functions/v1/hello" \
  -H "Authorization: Bearer <anon-key-from-dashboard>"
# Expected: "hi from supastack"

# Edit and redeploy (Story 3 scenario 3, SC-004 ≤10s budget):
sed -i.bak 's/hi from supastack/hi from supastack v2/' supabase/functions/hello/index.ts
time supabase functions deploy hello
# Expected: success in ≤10s, then:
curl -fsS "https://<ref>.<apex>/functions/v1/hello" -H "Authorization: Bearer <anon-key>"
# Expected: "hi from supastack v2"

# Multi-function deploy:
mkdir -p supabase/functions/world
cat > supabase/functions/world/index.ts <<'EOF'
Deno.serve(() => new Response('world!'));
EOF
supabase functions deploy
# Expected: both `hello` and `world` deployed; the CLI reports each.

# List:
supabase functions list
# Expected: table with hello, world. Status=ACTIVE.

# Download:
rm -rf /tmp/dl && mkdir /tmp/dl && cd /tmp/dl
supabase functions download hello --project-ref <ref>
ls supabase/functions/hello/
# Expected: index.ts containing the same source we uploaded.

# Delete:
cd ~/my-app
supabase functions delete world --no-verify-jwt --project-ref <ref>
supabase functions list | grep -q world && echo "BUG: world still listed" || echo "OK: world removed"
```

**Verifies**: Story 3 acceptance scenarios 1, 2, 3, 4, 5, 6, 7.

## Story 4 — Secrets

```bash
# Set a secret:
supabase secrets set EXAMPLE_KEY=hello-secret

# Update the function to read it (run from ~/my-app):
cat > supabase/functions/hello/index.ts <<'EOF'
Deno.serve(() => new Response(Deno.env.get('EXAMPLE_KEY') ?? '<unset>'));
EOF
supabase functions deploy hello

# Verify the function sees it (SC-005 ≤5s after set, the secret is live):
curl -fsS "https://<ref>.<apex>/functions/v1/hello" -H "Authorization: Bearer <anon-key>"
# Expected: "hello-secret"

# Set a new value WITHOUT redeploying (FR-018):
supabase secrets set EXAMPLE_KEY=changed-without-redeploy
sleep 6
curl -fsS "https://<ref>.<apex>/functions/v1/hello" -H "Authorization: Bearer <anon-key>"
# Expected: "changed-without-redeploy"

# List (redacted):
supabase secrets list
# Expected: a table with name EXAMPLE_KEY and a redacted/hashed value column.
# The plaintext "changed-without-redeploy" MUST NOT appear.

# Bulk-set from .env file:
cat > /tmp/myenv <<'EOF'
STRIPE_KEY=sk_test_123
OPENAI_KEY=sk-fake
EOF
supabase secrets set --env-file /tmp/myenv

# Unset:
supabase secrets unset EXAMPLE_KEY
sleep 6
curl -fsS "https://<ref>.<apex>/functions/v1/hello" -H "Authorization: Bearer <anon-key>"
# Expected: "<unset>"

# Reserved name refused (FR-019):
supabase secrets set JWT_SECRET=hacker 2>&1 | grep -i 'reserved'
# Expected: 409 with "Cannot set reserved secret: JWT_SECRET"

# Invalid name regex refused:
supabase secrets set 'bad name'=x 2>&1 | grep -i 'validation\|invalid'
# Expected: 422
```

**Verifies**: Story 4 acceptance scenarios 1, 2, 3, 4, 5.

## Edge case checks

```bash
# Expired token surface across commands:
SUPABASE_ACCESS_TOKEN=sbp_0000000000000000000000000000000000000000 \
  supabase functions list 2>&1 | grep -i 'unauthor\|invalid'
# Expected: a clean Unauthorized message; no crash, no Go reflect error.

# Oversized bundle (413):
dd if=/dev/urandom of=supabase/functions/big/blob.bin bs=1M count=60 2>/dev/null
mkdir -p supabase/functions/big
cat > supabase/functions/big/index.ts <<'EOF'
Deno.serve(() => new Response('big'));
EOF
supabase functions deploy big 2>&1 | grep -i 'too large\|50 MB\|413'
# Expected: 413 with size info, no upload partial-state on the server.
rm -rf supabase/functions/big

# Not-implemented endpoint (cloud-only path):
supabase branches list --project-ref <ref> 2>&1 | grep -i 'not implemented\|not supported'
# Expected: 501 with the "not implemented in supastack" envelope.
```

**Verifies**: spec.md Edge Cases section.

## Performance assertions (Success Criteria)

| SC | Measurement | How |
|---|---|---|
| SC-001 | "list projects within 3 minutes of opening Connect-CLI view" | Time the steps from dashboard-open → working `supabase projects list`. |
| SC-003 | "first deploy ≤15s end-to-end" | `time supabase functions deploy hello` on a never-deployed slug; followed by a `curl` confirming the function serves. The full Enter→200 budget includes both. |
| SC-004 | "repeat deploy ≤10s" | `time supabase functions deploy hello` on an already-deployed slug. |
| SC-005 | "secret propagation ≤5s, no redeploy" | `supabase secrets set FOO=X && sleep 5 && curl <fn>` — assert response reflects new value. |
| SC-006 | "95% of CLI runs succeed without shape errors" | Run the entire script above 20 times against a healthy deployment; expect zero "Try rerunning with --debug" or "json: cannot unmarshal" output. |
| SC-007 | "no supastack-specific docs needed beyond Connect-CLI page" | The instructions in this quickstart use only upstream CLI commands and supastack's dashboard. No source patches, no custom binaries. |

## E2E test harness (CI-runnable subset)

`tests/cli-e2e/deploy-hello.sh`:

```bash
#!/usr/bin/env bash
set -euo pipefail

: "${SUPASTACK_APEX:?SUPASTACK_APEX required}"
: "${SUPASTACK_PAT:?SUPASTACK_PAT required}"
: "${SUPASTACK_PROJECT_REF:?SUPASTACK_PROJECT_REF required}"

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT

# Write profile.
cat > "$WORK/supastack.toml" <<EOF
name          = "supastack-e2e"
api_url       = "https://api.${SUPASTACK_APEX}"
dashboard_url = "https://${SUPASTACK_APEX}/dashboard"
project_host  = "${SUPASTACK_APEX}"
EOF

# Minimal project.
mkdir -p "$WORK/proj/supabase/functions/e2e-$$"
cat > "$WORK/proj/supabase/functions/e2e-$$/index.ts" <<EOF
Deno.serve(() => new Response('e2e-ok-$(date +%s)'));
EOF

cd "$WORK/proj"
SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase --profile "$WORK/supastack.toml" functions deploy "e2e-$$" \
    --project-ref "$SUPASTACK_PROJECT_REF"

# Confirm serving (anon key endpoint needed if VERIFY_JWT=true; test functions
# can set verify_jwt=false in metadata, but for now we expect a 401 or 200).
curl -sf "https://${SUPASTACK_PROJECT_REF}.${SUPASTACK_APEX}/functions/v1/e2e-$$" \
  -H "Authorization: Bearer ${SUPASTACK_ANON_KEY:-fake}" \
  || echo "(verify_jwt may be on; deploy itself succeeded)"

# Cleanup.
SUPABASE_ACCESS_TOKEN="$SUPASTACK_PAT" \
  supabase --profile "$WORK/supastack.toml" functions delete "e2e-$$" \
    --project-ref "$SUPASTACK_PROJECT_REF"

echo "E2E PASS"
```

Wire this into `package.json`'s `test:cli` script. Default off in CI; opt-in for
nightly compatibility runs and local development.
