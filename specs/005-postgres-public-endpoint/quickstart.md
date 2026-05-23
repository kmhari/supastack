# Quickstart: Postgres Public Endpoint via SNI Routing

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23

---

## Scenario 1: supabase db push Without --db-url (SC-001)

**Pre-condition**: Selfbase deployment with wildcard cert active, one provisioned project.

```bash
# Set env vars
export SELFBASE_APEX=selfbase.example.com
export SELFBASE_PAT=sbp_abc123...
export SELFBASE_PROJECT_REF=abcdefghijklmnopqrst
export SELFBASE_DB_PASSWORD=<from-instance-settings>

# Run the full E2E suite
bash tests/cli-e2e/db-push.sh
```

Expected: all 7 test steps emit `✓` and script exits 0.

**Manual spot check**:
```bash
# Verify TLS cert is wildcard
openssl s_client -connect "db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}:5432" \
  -starttls postgres 2>&1 | grep "subject="
# → subject=CN=*.selfbase.example.com

# Apply a real migration
supabase --profile selfbase.toml db push --project-ref "$SELFBASE_PROJECT_REF"
# → Applied migration 20260523000001_my_table.sql  ✓
```

---

## Scenario 2: All Database Sub-Commands Work (SC-002)

```bash
# After db push is confirmed working:
supabase --profile selfbase.toml migration list --project-ref "$SELFBASE_PROJECT_REF"
supabase --profile selfbase.toml db diff   --project-ref "$SELFBASE_PROJECT_REF"
supabase --profile selfbase.toml db pull   --project-ref "$SELFBASE_PROJECT_REF" -f /tmp/schema.sql
supabase --profile selfbase.toml inspect db --project-ref "$SELFBASE_PROJECT_REF"
```

Expected: all exit 0 with meaningful output.

---

## Scenario 3: Existing Instance Works After Caddy Reload (SC-003)

**Pre-condition**: Instance was provisioned before feature 005 was deployed.

```bash
# Deploy feature 005 (docker compose rebuild caddy + up -d)
# Wait for Caddy reload (caddy logs show "config loaded successfully")

# Test the existing instance immediately — no restart required
psql "postgresql://postgres:${SELFBASE_DB_PASSWORD}@db.${SELFBASE_PROJECT_REF}.${SELFBASE_APEX}:5432/postgres" \
  -c "SELECT current_database();"
# → selfbase
```

Expected: connection succeeds within 60 seconds of Caddy reload. No instance restart required.

---

## Scenario 4: Studio Shows Correct Connection String (SC-004)

**Pre-condition**: New instance provisioned after feature 005 is deployed.

1. Open Studio for the new instance: `https://studio-<ref>.<apex>/`
2. Navigate to Settings → Database
3. Check "Connection string" or "Direct connection" panel

Expected: shows `postgresql://postgres:[YOUR-PASSWORD]@db.<ref>.<apex>:5432/postgres` — NOT `127.0.0.1:5432` or `db:5432`.

---

## Scenario 5: Old --db-url Connection Still Works (SC-005)

```bash
# Old direct-port URL still works
psql "postgresql://postgres:${SELFBASE_DB_PASSWORD}@${SELFBASE_PUBLIC_IP}:${PORT_POSTGRES}/postgres" \
  -c "SELECT 1;"
# → 1
```

Expected: exit 0. The old high-port path remains functional alongside the new `db.*:5432` path.

---

## Scenario 6: Backward Compat — No Wildcard Cert (FR-007/FR-008)

**Pre-condition**: Deployment with no wildcard cert (wildcard cert step skipped during /setup).

```bash
# Caddy config should have no layer4 block
curl -s http://localhost:2019/config/ | jq 'has("layer4")'
# → false
```

Expected: `layer4` key absent from Caddy config. Port 5432 is NOT exposed. The deployment continues to function identically to the pre-005 state. No regressions.

---

## Scenario 7: docs/supabase-cli.md Updated (SC-006)

Open `docs/supabase-cli.md` and search for "db push" or "--db-url". The caveat "db push requires --db-url" MUST NOT appear. The updated instructions must work end-to-end when followed on a fresh selfbase install with feature 005 deployed.
