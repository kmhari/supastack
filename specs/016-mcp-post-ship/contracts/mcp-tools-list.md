# Contract: MCP tools/list filtered response (US2)

**Endpoint**: `POST /mcp` (MCP JSON-RPC `tools/list` method)
**Service**: `selfbase-mcp` (apps/mcp)

## Expected tool surface after feature 016

The `tools/list` response MUST contain exactly the in-scope tools and MUST NOT contain any of the deferred tools.

### In-scope tools (MUST be present)

| Tool name | Feature | Backed by |
|-----------|---------|-----------|
| `list_projects` | 014 | GET /v1/projects |
| `get_project` | 014 | GET /v1/projects/:ref |
| `list_organizations` | 014 | GET /v1/organizations |
| `get_organization` | 014 | GET /v1/organizations/:id |
| `pause_project` | 014 | POST /v1/projects/:ref/pause |
| `restore_project` | 014 | POST /v1/projects/:ref/restore |
| `execute_sql` | 013 | POST /v1/projects/:ref/database/query |
| `list_tables` | 013 | via execute_sql |
| `list_extensions` | 013 | via execute_sql |
| `list_migrations` | 013 | via execute_sql |
| `apply_migration` | 006 | POST /v1/projects/:ref/database/migrations |
| `get_project_url` | 006 | GET /v1/projects/:ref/api-keys |
| `get_publishable_keys` | 006 | GET /v1/projects/:ref/api-keys |
| `generate_typescript_types` | 006 | GET /v1/projects/:ref/types/typescript |
| `list_edge_functions` | 003 | GET /v1/projects/:ref/functions |
| `get_edge_function` | 003 | GET /v1/projects/:ref/functions/:slug |
| `deploy_edge_function` | 003 | POST /v1/projects/:ref/functions |
| `get_logs` | 014 | GET /v1/projects/:ref/analytics/endpoints/logs.all |
| `list_storage_buckets` | 014 | GET /v1/projects/:ref/storage/buckets |
| `search_docs` | 014 | Supabase hosted docs |

### Deferred tools (MUST be absent after feature 016)

| Tool name | Why absent |
|-----------|-----------|
| `create_project` | Feature 017 follow-up |
| `get_cost` | Feature 017 follow-up |
| `confirm_cost` | Feature 017 follow-up |
| `get_security_advisors` | Feature 016 follow-up |
| `get_performance_advisors` | Feature 016 follow-up |
| `get_storage_config` | Feature 018 follow-up |
| `update_storage_config` | Feature 018 follow-up |

## Verification

```bash
TOOLS=$(curl -sk -X POST "https://mcp.$SELFBASE_APEX/mcp" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "mcp-session-id: $SESSION_ID" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}' | jq -r '.result.tools[].name')

# Must not contain any deferred tool
for t in create_project get_cost confirm_cost get_security_advisors get_performance_advisors get_storage_config update_storage_config; do
  echo "$TOOLS" | grep -qx "$t" && echo "FAIL: $t present" || echo "OK: $t absent"
done
```
