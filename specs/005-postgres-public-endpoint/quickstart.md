# Quickstart: Postgres Public Endpoint via Top-Level Pooler

**Feature**: 005-postgres-public-endpoint | **Date**: 2026-05-23 (rewritten post-pivot)

---

## Scenario 1: supabase db push Works Without --db-url (SC-001)

**Pre-condition**: Wildcard cert active, supavisor running, at least one provisioned project.

```bash
export SELFBASE_APEX=selfbase.example.com
export SELFBASE_PAT=sbp_...
export SELFBASE_PROJECT_REF=abcdefghijklmnopqrst
export SELFBASE_DB_PASSWORD=<from-Studio-or-instance-secrets>

bash tests/cli-e2e/db-push.sh
```

Expected: all 7 steps emit ✓, script exits 0. The `db push` step uses NO `--db-url` flag.

---

## Scenario 2: All Database Sub-Commands (SC-002)

Same env as above:
```bash
supabase --profile selfbase.toml migration list --project-ref "$SELFBASE_PROJECT_REF"
supabase --profile selfbase.toml db diff        --project-ref "$SELFBASE_PROJECT_REF"
supabase --profile selfbase.toml db pull        --project-ref "$SELFBASE_PROJECT_REF" -f /tmp/schema.sql
supabase --profile selfbase.toml inspect db     --project-ref "$SELFBASE_PROJECT_REF"
```

All exit 0. `db pull` produces a non-empty schema.sql.

---

## Scenario 3: New Project Immediately Reachable (SC-003)

```bash
# Create a project from the dashboard. Once it shows "running":
psql "postgresql://postgres:<NEW_PASSWORD>@db.<NEW_REF>.<apex>:5432/postgres?sslmode=require" \
  -c "SELECT current_database();"
```

Expected: row returned within seconds of project creation. No restart, no extra config.

---

## Scenario 4: Studio Direct Connection Display (SC-004) — deferred to follow-up

In v1, Studio may still show `db:5432`. The dashboard's Settings → Database panel shows the correct `db.<ref>.<apex>:5432` — copy from there until Studio is patched separately.

---

## Scenario 5: Old --db-url Connection Still Works (SC-005)

```bash
psql "postgresql://postgres:${PWD}@${VM_IP}:${PORT_POSTGRES}/postgres" -c "SELECT 1"
```

Expected: exit 0. The per-instance high port mapping remains live for backward compat.

---

## Scenario 6: Connection Pooling Effective (SC-006)

```bash
# 50 concurrent connections via pgbench
pgbench -h db.<ref>.<apex> -p 5432 -U postgres -d postgres -c 50 -T 60 \
  -P 5 -S --connect <<<"$PASSWORD"

# In another shell on the VM:
docker exec selfbase-<ref>-db-1 \
  psql -U postgres -d postgres -c "SELECT count(*) FROM pg_stat_activity WHERE state='active'"
```

Expected: pgbench reports <50ms p95 for SELECT 1; `pg_stat_activity` shows <25 active backends (pooler is pooling).

---

## Scenario 7: Pooler Recovery After Crash (SC-007)

```bash
# Kill supavisor
docker compose -f infra/docker-compose.yml restart supavisor
# Watch dashboard: "Pooler: down" within 30s, then "Pooler: healthy" within 10s after restart
# Existing clients reconnect automatically
psql "postgresql://postgres:$PWD@db.<ref>.<apex>:5432/postgres?sslmode=require" -c "SELECT 1"
```

Expected: SELECT 1 succeeds within 10s of pooler returning healthy.

---

## Scenario 8: Backfill Existing Instances (SC-008)

After deploying this feature for the first time:

```bash
# On VM, after `docker compose up -d`:
docker exec selfbase-api-1 \
  pnpm --filter @selfbase/api exec tsx scripts/backfill-pooler-tenants.ts
```

Expected output:
```
✓ abcdefghijklmnopqrst
✓ qrstuvwxyzabcdefghij
skip lmnopqrstuvwxyzabcde (already registered)
done — 2 registered, 1 skipped, 0 errors
```

Then verify any pre-existing project is reachable:
```bash
psql "postgresql://postgres:$EXISTING_PWD@db.<existing-ref>.<apex>:5432/postgres?sslmode=require" -c "SELECT 1"
```

---

## Scenario 9: Reconciler Heals Drift

```bash
# Manually delete a pooler_tenants row (simulating drift):
docker exec selfbase-db-1 \
  psql -U selfbase -d selfbase -c "DELETE FROM pooler_tenants WHERE external_id='abcdefghijklmnopqrst'"

# Trigger reconciler manually (or wait for next 3 AM cron):
docker exec selfbase-api-1 \
  pnpm --filter @selfbase/api exec tsx -e 'import { runReconciler } from "./src/services/pooler-reconciler.js"; runReconciler()'

# Verify row recreated:
docker exec selfbase-db-1 \
  psql -U selfbase -d selfbase -c "SELECT external_id, status FROM pooler_tenants WHERE external_id='abcdefghijklmnopqrst'"
```

Expected: row exists again with status='active'.

---

## Scenario 10: Tenant Registration Atomicity

```bash
# Simulate supavisor being down during project creation:
docker compose stop supavisor

# Try to create a project from the dashboard:
# → expect a clear error "Pooler registration failed: ..."
# → no half-created project in supabase_instances
# → no orphan pooler_tenants row

docker compose start supavisor
# Now project creation succeeds.
```

Verify atomicity:
```bash
docker exec selfbase-db-1 psql -U selfbase -d selfbase -c "SELECT count(*) FROM supabase_instances WHERE ref='<the-failed-ref>'"
# → 0
docker exec selfbase-db-1 psql -U selfbase -d selfbase -c "SELECT count(*) FROM pooler_tenants WHERE external_id='<the-failed-ref>'"
# → 0
```

Expected: both counts are 0 — no half-created state.
