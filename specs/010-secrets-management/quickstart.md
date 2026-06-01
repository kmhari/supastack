# Quickstart — 010 Secrets management

End-to-end smoke for the live VM after deploy. Assumes the feature is fully implemented and rsync'd to `/opt/supastack`.

## Setup (one-time)

```bash
# On VM
cd /opt/supastack
sudo docker compose build api worker web caddy
sudo docker compose up -d api worker web caddy
```

Existing per-project functions containers get the patched `main/index.ts` on their next restart (re-deploy each instance via the dashboard, or `sudo docker compose -p supastack-<ref> restart functions`).

## Verify provision-time vault enablement (FR-001, SC-005)

```bash
# Provision a fresh project via the dashboard or curl
# Then check that vault_enabled_at is set BEFORE the instance reaches 'running'
sudo docker compose exec db psql -U postgres -d supastack -c \
  "SELECT ref, status, vault_enabled_at FROM supabase_instances ORDER BY created_at DESC LIMIT 5"
# Expected: latest project has both status='running' AND vault_enabled_at NOT NULL
```

After provision completes:

```bash
# Pick any project ref
REF=<existing-ref>

# Verify extensions enabled
sudo docker exec supastack-${REF}-db-1 psql -U supabase_admin -d postgres -c \
  "SELECT extname FROM pg_extension WHERE extname IN ('pgsodium','supabase_vault')"
# Expected: both rows present
```

## Verify SQL-side vault works (US2, SC-006)

```bash
sudo docker exec supastack-${REF}-db-1 psql -U supabase_admin -d postgres <<'SQL'
SELECT vault.create_secret('test-value', 'quickstart_test');
SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'quickstart_test';
DELETE FROM vault.secrets WHERE name = 'quickstart_test';
SQL
# Expected: middle SELECT returns 'test-value'
```

Open Studio's Vault page in browser: `https://studio-${REF}.<apex>/project/default/settings/vault` — page must render without errors.

## Verify dashboard CRUD (US1, SC-001/002/003)

In a browser, signed in as admin:

1. Navigate to `https://<apex>/dashboard/project/${REF}/secrets`.
2. Add `TEST_KEY=alpha`, click Save. Toast: "Saved." Custom secrets table shows the row with a digest within 2 seconds.
3. Note the time. Wait 1 second.
4. From a separate terminal, invoke an edge function that returns `Deno.env.get('TEST_KEY')`:
   ```bash
   curl -s https://${REF}.<apex>/functions/v1/<test-fn> \
     -H "Authorization: Bearer <anon-key>" -H "apikey: <anon-key>"
   ```
   Expected output: `"alpha"` — within ≤10s of the Save click (typically 1–6s).
5. Confirm zero restarts during the test:
   ```bash
   sudo docker logs supastack-${REF}-functions-1 --since 1m | grep -ic 'started\|restart'
   ```
   Expected: 0.

## Verify TTL propagation (US3, SC-002)

```bash
# Update vault row directly via the vault helper (bypassing the dashboard)
sudo docker exec supastack-${REF}-db-1 psql -U supabase_admin -d postgres <<SQL
SELECT vault.update_secret(
  (SELECT id FROM vault.secrets WHERE name = 'TEST_KEY'),
  'beta'
);
SQL

# Wait 6 seconds (TTL=5s + slack)
sleep 6

# Re-invoke the function
curl -s https://${REF}.<apex>/functions/v1/<test-fn> -H "Authorization: Bearer <anon-key>" -H "apikey: <anon-key>"
# Expected: "beta"
```

## Verify wire contract preservation (SC-008)

```bash
PAT=<existing-pat-with-instance.secrets.write>

# List
curl -s https://<apex>/v1/projects/${REF}/secrets -H "Authorization: Bearer ${PAT}" | jq

# Upsert via CLI surface
curl -s -X POST https://<apex>/v1/projects/${REF}/secrets \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"secrets":[{"name":"WIRE_TEST","value":"hello"}]}' | jq
# Expected: 200, response includes WIRE_TEST with valueSha256

# Verify it shows up in the dashboard list immediately
curl -s https://<apex>/v1/projects/${REF}/secrets -H "Authorization: Bearer ${PAT}" | jq '.secrets[] | select(.name=="WIRE_TEST")'

# Reserved name rejection
curl -s -X POST https://<apex>/v1/projects/${REF}/secrets \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"secrets":[{"name":"SUPABASE_URL","value":"x"}]}'
# Expected: 400 {"code":"reserved_name","name":"SUPABASE_URL"}

# Delete
curl -s -X DELETE https://<apex>/v1/projects/${REF}/secrets \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"names":["WIRE_TEST"]}' | jq
# Expected: 200 {"deleted":["WIRE_TEST"]}
```

## Verify Studio redirect (US4, SC-007)

```bash
# 302 from Studio's broken page → supastack dashboard
curl -sI -o /dev/null -w '%{http_code} %{redirect_url}\n' \
  https://studio-${REF}.<apex>/project/default/functions/secrets
# Expected: 302 https://<apex>/dashboard/project/${REF}/secrets?

# Other Studio paths pass through
curl -sI -o /dev/null -w '%{http_code}\n' \
  https://studio-${REF}.<apex>/project/default/sql
# Expected: 200 (or whatever Studio normally returns; NOT 302)
```

Also in browser: click "Secrets" in Studio's Edge Functions sidebar → must land on the working supastack secrets page, already authenticated.

## Verify breaking-change is documented

After upgrade, any operator who had pre-existing `project_secrets` rows must see no secrets in the dashboard until they re-enter them. This is intentional (clarification Q3). Release notes MUST call this out — verify the deploy PR description includes the re-entry checklist.

## Cleanup

```bash
# Remove the quickstart's test secret if you set one via dashboard
curl -s -X DELETE https://<apex>/v1/projects/${REF}/secrets \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"names":["TEST_KEY"]}'
```
