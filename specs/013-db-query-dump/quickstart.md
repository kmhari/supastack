# Quickstart — 013 db query + db dump

End-to-end smoke for the live VM after deploy. Assumes the feature is fully implemented and rsync'd to `/opt/supastack`.

## Setup (one-time)

```bash
# On VM
cd /opt/supastack
sudo docker compose build api
sudo docker compose up -d api
```

No migration; no new schema. `audit_log.action` is unconstrained text — the new action values just start appearing.

## US1 — Operator runs ad-hoc SQL from laptop

```bash
# Assuming the supastack profile + supabase login from feature 011 are wired
cd ~/some-supastack-project   # has .supastack containing the apex

# Simple query
supabase db query --linked "SELECT 1 as one, 'hello' as greeting"
# Expected: 1 row, columns "one" + "greeting"

# Larger
supabase db query --linked "SELECT id, email, created_at FROM auth.users ORDER BY created_at DESC LIMIT 5"
# Expected: up to 5 rows of auth.users

# Parameterized (the CLI may or may not expose --param; raw HTTP test:)
PAT=$(cat ~/.supabase/access-token)
REF=<your-project-ref>
curl -sk -X POST "https://api.supaviser.dev/v1/projects/${REF}/database/query" \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"query":"SELECT id FROM auth.users WHERE email = $1","parameters":["alice@example.com"]}'
# Expected: 201 with { result: [{ id: "…" }] }

# Multi-statement → 400 (clarification Q1)
curl -sk -X POST "https://api.supaviser.dev/v1/projects/${REF}/database/query" \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"query":"SELECT 1; SELECT 2;"}'
# Expected: 400 { error: { code: "multi_statement_not_supported" } }

# read_only: true blocks writes
curl -sk -X POST "https://api.supaviser.dev/v1/projects/${REF}/database/query" \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" \
  -d '{"query":"DELETE FROM auth.users","read_only":true}'
# Expected: 400 { error: { code: "read_only_violation" } }
```

## US2 — Operator dumps for backup

```bash
# Dry-run for size estimate
supabase db dump --linked --data-only --dry-run
# Expected: small JSON output with bytes_estimated + duration_ms

# Real dump to file
supabase db dump --linked > /tmp/full-dump.sql
ls -la /tmp/full-dump.sql
# Expected: non-empty file

# Schema-only
supabase db dump --linked --schema-only > /tmp/schema.sql
grep -c "CREATE TABLE" /tmp/schema.sql
# Expected: > 0

# Restore round-trip on a fresh project (manual; provision a new supastack project first)
NEW_REF=<freshly-provisioned-ref>
NEW_PASSWORD=<the new project's postgres password from /var/supastack/instances/<NEW_REF>/.env>
psql "postgresql://postgres:${NEW_PASSWORD}@db.${NEW_REF}.supaviser.dev:5432/postgres" -f /tmp/full-dump.sql
# Expected: psql replays the dump; row counts in NEW match the original

# Cancel mid-stream
supabase db dump --linked > /tmp/big-dump.sql &
sleep 1
kill %1
# Verify no zombie pg_dump on the VM
ssh ubuntu@148.113.1.164 "sudo docker exec supastack-<REF>-db-1 pgrep pg_dump"
# Expected: empty (no zombie within ~5s of the disconnect)
```

## MCP-tool smoke (SC-007)

```bash
# In a Claude Code / MCP-aware editor session pointed at api.supaviser.dev
# (assuming the upstream Supabase MCP server is configured with the supastack PAT)

# execute_sql should now work
mcp__supabase__execute_sql({ query: "SELECT 1" })
# Expected: { result: [{ "?column?": 1 }] }

# list_tables should now work
mcp__supabase__list_tables({ schemas: ["public"] })
# Expected: list of public-schema tables
```

If both work without modifications to the MCP server, SC-007 is satisfied.

## Audit log spot-check (SC-007)

```bash
# After running a few queries, check audit_log on the control plane
ssh ubuntu@148.113.1.164 "sudo docker exec supastack-db-1 psql -U supastack -d supastack \
  -c \"SELECT action, target_id, payload->'query' AS sql, payload->'row_count' AS rows, created_at \
       FROM audit_log \
       WHERE action LIKE 'instance.db.%' \
       ORDER BY id DESC LIMIT 10\""
# Expected:
#   - One row per successful query with full SQL text + row count
#   - Failed queries also appear with instance.db.query.failed + error message
#   - Dumps appear with instance.db.dump + flags
```

## Log-leak check (SC-008)

```bash
# After running the US1/US2 quickstart steps
ssh ubuntu@148.113.1.164 "sudo docker logs --since 5m supastack-api-1 2>&1 | grep -cE 'sbp_[0-9a-f]{40}'"
# Expected: 0 (no plaintext PAT leakage)
```

## Cleanup

No cleanup needed beyond removing any test rows you inserted via `db query`. The dump output is on your laptop, not the VM.
