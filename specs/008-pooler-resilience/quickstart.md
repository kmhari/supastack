# Phase 1: Quickstart

**Feature**: 008-pooler-resilience

Operator walkthrough validating all three user stories against the test VM (`ubuntu@148.113.1.164`).

## Prerequisites

- selfbase main + feature 008 changes deployed
- Two running projects (ENZY `enzyxdtrbosuwjwzkmvl` + ASYO `asyobqcbycmqjeribjfv` or similar)
- Admin session cookie or PAT
- Pooler-tenants table populated (i.e., feature 005's backfill or reconciler has run)

## US1 — Reconciler auto-recovers tenant drift

```bash
# 1. Baseline — both tenants active
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.projects | map({ref, tenant_status})'
# expect: both 'active'

# 2. Simulate drift — delete the ASYO row from pooler_tenants directly
ssh ubuntu@148.113.1.164 'sudo docker exec selfbase-db-1 psql -U selfbase -d selfbase \
  -c "DELETE FROM pooler_tenants WHERE external_id = '\''asyobqcbycmqjeribjfv'\'';"'

# 3. Trigger reconciler manually (don't want to wait for 03:00 UTC)
curl -sS -X POST -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/reconciler/run
# expect: 202 with run_id

# 4. Poll status; within ~5s the ASYO row should reappear as active
sleep 5
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.projects | map({ref, tenant_status})'
# expect: both 'active' again

# 5. Verify event was logged
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.recent_events[] | select(.event == "reconciler.registered_missing")'
# expect: at least one row referencing ASYO

# 6. Verify run summary
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.recent_runs[0]'
# expect: status='success' or 'partial_failure', actions_taken.registered_missing=1
```

## US2 — Dashboard panel

```bash
# Open in browser: https://supaviser.dev/settings/database
# Verify:
#  - Supavisor health pill (green)
#  - Pooler endpoint URL (pooler.supaviser.dev:6543), with copy button
#  - Per-project table (both projects, tenant_status, last_reconciled_at)
#  - Recent events tail
#  - 'Re-register' button per row (try clicking on a healthy one — should refetch + stay active)
#  - 'Run reconciler now' button at top — clicking emits 202 + dashboard refetches
#  - Auto-refresh: leave page open 10s, watch network tab for repeated /pooler/status fetches
```

## US3 — PG password drift end-to-end

### Recovery path (existing project)

```bash
# 1. Simulate drift — manually ALTER the postgres role's password to something wrong
ssh ubuntu@148.113.1.164 'sudo docker exec selfbase-asyobqcbycmqjeribjfv-db-1 \
  psql -h 127.0.0.1 -U supabase_admin -d postgres \
  -c "ALTER USER postgres WITH PASSWORD '\''wrong'\'';"'

# 2. Trigger reconciler to detect
curl -sS -X POST -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/reconciler/run
sleep 3

# 3. Verify tenant_status flipped to pg_password_drift
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.projects[] | select(.ref == "asyobqcbycmqjeribjfv") | {ref, tenant_status, last_error}'
# expect: tenant_status='pg_password_drift', last_error mentions 28P01 / auth

# 4. Reset via the new endpoint
curl -sS -X POST -H "Cookie: session=$ADMIN" \
  https://supaviser.dev/api/v1/instances/asyobqcbycmqjeribjfv/reset-pg-password
# expect: 200 with pooler_tenant_status='active' (sync reconciler ran within 5s)

# 5. Verify
curl -sS -H "Cookie: session=$ADMIN" https://supaviser.dev/api/v1/pooler/status \
  | jq '.projects[] | select(.ref == "asyobqcbycmqjeribjfv") | .tenant_status'
# expect: "active"
```

### Prevention path (new provision)

```bash
# This test requires creating a project where the data dir is pre-populated
# with a different password than the freshly-generated encrypted_secrets.
# Simulated by:

# 1. Create a project normally
NEW_REF=$(curl -sS -X POST -H "Cookie: session=$ADMIN" -H "Content-Type: application/json" \
  https://supaviser.dev/api/v1/instances \
  -d '{"name":"drift-test","postgresPassword":"correct"}' | jq -r '.ref')

# Wait for it to be 'running'
while [ "$(curl -sS -H "Cookie: session=$ADMIN" \
  "https://supaviser.dev/api/v1/instances/$NEW_REF" | jq -r '.status')" != "running" ]; do
  sleep 2
done

# 2. Now stop it + manually corrupt the password to simulate a "wrong data dir"
ssh ubuntu@148.113.1.164 "sudo docker exec selfbase-${NEW_REF}-db-1 \
  psql -h 127.0.0.1 -U supabase_admin -d postgres \
  -c \"ALTER USER postgres WITH PASSWORD 'corrupted';\""

# 3. Trigger a re-provision via the lifecycle 'restart' action
curl -sS -X POST -H "Cookie: session=$ADMIN" \
  "https://supaviser.dev/api/v1/instances/$NEW_REF/lifecycle" \
  -d '{"action":"restart"}'

# 4. Watch for the new provision-time probe failure
sleep 30
curl -sS -H "Cookie: session=$ADMIN" "https://supaviser.dev/api/v1/instances/$NEW_REF" \
  | jq '{status, provision_error}'
# expect: status='failed', provision_error='pg_password_drift_at_provision'

# 5. Recover via reset
curl -sS -X POST -H "Cookie: session=$ADMIN" \
  "https://supaviser.dev/api/v1/instances/$NEW_REF/reset-pg-password"
# expect: 200

# 6. Retry provision (existing lifecycle action)
curl -sS -X POST -H "Cookie: session=$ADMIN" \
  "https://supaviser.dev/api/v1/instances/$NEW_REF/lifecycle" \
  -d '{"action":"retry-provision"}'
# Watch status flip back to 'running'

# Cleanup: delete the test project
curl -sS -X DELETE -H "Cookie: session=$ADMIN" "https://supaviser.dev/api/v1/instances/$NEW_REF"
```

## Negative tests

```bash
# Non-admin can't trigger reconciler
curl -sS -X POST -H "Cookie: session=$NON_ADMIN" \
  https://supaviser.dev/api/v1/pooler/reconciler/run
# expect: 403

# Concurrent reconciler triggers
( curl -sS -X POST -H "Cookie: session=$ADMIN" \
    https://supaviser.dev/api/v1/pooler/reconciler/run &
  curl -sS -X POST -H "Cookie: session=$ADMIN" \
    https://supaviser.dev/api/v1/pooler/reconciler/run &
  wait )
# expect: one 202, one 409 previous_run_still_active

# Reset on a paused project
curl -sS -X POST -H "Cookie: session=$ADMIN" \
  "https://supaviser.dev/api/v1/instances/$PAUSED_REF/reset-pg-password"
# expect: 409 project_not_running
```

## Success — all green

- US1: deleting + triggering reconciler restores state within ~5s, event emitted
- US2: dashboard panel renders state, refetches on action, copy buttons work
- US3 recovery: manual ALTER → reconciler detects → reset endpoint → reconciler verifies (all within 10s)
- US3 prevention: corrupted-data-dir provision fails fast with `pg_password_drift_at_provision`; reset + retry-provision recovers
- Existing feature 005 happy path (provision → register on running) unaffected
