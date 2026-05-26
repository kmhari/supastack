# Quickstart: Feature 016 — MCP Post-Ship Hardening

## Smoke test after deploy

### 1. Verify statement_timeout on a new project (US1)

```bash
# Provision a new project via the dashboard, then:
psql "postgresql://postgres:<password>@db.<ref>.<apex>:5432/postgres" \
  -c "SHOW statement_timeout;"
# Expected: 8s
```

### 2. Verify MCP tool filter (US2)

```bash
SELFBASE_APEX=supaviser.dev \
SELFBASE_OAUTH_JWT='<mint-via-oauth-dance.sh>' \
bash tests/cli-e2e/mcp-roundtrip.sh
# Expected: "[2] tools/list" step prints "WARN: deferred tools still in tools/list" → should be absent after 016
```

Quick manual check:
```bash
# In the mcp-roundtrip.sh output, look for the tool count line.
# After 016: tool count should be ~20, no create_project/get_cost/confirm_cost/get_advisors warnings.
```

### 3. Verify get_logs works on existing project (US3)

```bash
# After worker restart (which triggers the kong-analytics-patch job):
curl -sk "https://api.$SELFBASE_APEX/v1/projects/$REF/analytics/endpoints/logs.all?service=api" \
  -H "Authorization: Bearer $JWT"
# Expected: 200 (with log data) or 503 (analytics container not running)
# NOT: 404 or 502 (which indicate missing Kong route)
```

### 4. Verify OAuth route-level tests pass (US4)

```bash
cd apps/api
pnpm test -- oauth-authorize oauth-token
# Expected: all tests pass (14 new tests + existing suite green)
```

## Kong patch worker — manual trigger

If the boot-time job doesn't run (e.g., worker was already running):

```bash
# On the VM, restart the worker to trigger the one-shot job:
sudo docker compose -f /opt/selfbase/infra/docker-compose.yml restart worker
# Watch logs:
sudo docker compose -f /opt/selfbase/infra/docker-compose.yml logs -f worker | grep kong-analytics
```

## Existing project statement_timeout (opt-in)

Existing projects keep their current setting. To apply the 8s default manually:
```bash
psql "postgresql://postgres:<password>@host:port/postgres" \
  -c "ALTER DATABASE postgres SET statement_timeout = 8000;"
# Or via the MCP execute_sql tool:
# execute_sql({ sql: "ALTER DATABASE postgres SET statement_timeout = 8000;", project_id: "<ref>" })
```
