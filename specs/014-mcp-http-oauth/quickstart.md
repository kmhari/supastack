# Quickstart — 014 MCP HTTP + OAuth 2.1

End-to-end smoke after deploy. Assumes the feature is fully implemented + rsync'd to `/opt/selfbase` + redeployed.

## Setup (one-time per VM)

```bash
# On VM
cd /opt/selfbase

# Run the OAuth tables migration
sudo docker compose exec api node -e "import('@selfbase/db').then(m => m.migrate(process.env.DATABASE_URL))"

# Build + deploy the new MCP service alongside api
sudo docker compose build api selfbase-mcp
sudo docker compose up -d api selfbase-mcp

# Confirm Caddy picked up the mcp.<apex> route
sudo docker compose exec caddy caddy reload --config /etc/caddy/Caddyfile
```

DNS prerequisite: `mcp.<apex>` MUST resolve to the same A-record as `api.<apex>` (covered by the existing wildcard `*.<apex>` setup).

## US1 — Operator OAuth dance + list_projects via MCP

```bash
# 1. Operator logs into the selfbase dashboard at https://<apex>/dashboard
#    (this creates the session cookie that the authorize endpoint reads)

# 2. Operator opens any MCP client and pastes the config:
cat > ~/.claude/mcp.json <<'EOF'
{
  "mcpServers": {
    "selfbase": {
      "type": "http",
      "url": "https://mcp.<apex>/mcp"
    }
  }
}
EOF
# Replace <apex> with the actual apex (e.g. supaviser.dev)

# 3. Open the MCP client (e.g. Claude Code). On first MCP call:
#    a. Client fetches https://mcp.<apex>/.well-known/oauth-protected-resource
#    b. Client follows the authorization_servers URL to api.<apex>'s OAuth metadata
#    c. Client POSTs /v1/oauth/register to mint a client_id
#    d. Client opens browser to /v1/oauth/authorize?... with PKCE challenge
#    e. Operator (already logged in) sees consent dialog, clicks Authorize
#    f. Browser redirects to localhost callback, MCP client picks up code, exchanges for JWT
#    g. Client uses JWT as Bearer for /mcp requests

# 4. Verify by asking the LLM "list my projects" — expect a structured response

# 5. Verify the wire-level dance via curl (skip the browser):
APEX=supaviser.dev
# Discover
curl -sk https://mcp.${APEX}/.well-known/oauth-protected-resource
curl -sk https://api.${APEX}/.well-known/oauth-authorization-server
```

## US2 — DCR self-registration

```bash
# Register a bespoke MCP client (no pre-existing client_id)
curl -sk -X POST https://api.${APEX}/v1/oauth/register \
  -H "Content-Type: application/json" \
  -d '{
    "client_name": "MyTestEditor",
    "redirect_uris": ["http://localhost:8765/cb"]
  }'
# Expected: 201 + { client_id: "<uuid>", ... }

# Use that client_id in the standard authorize flow — full OAuth roundtrip should succeed
```

## US3 — Revoke from dashboard, verify <5s propagation

```bash
# 1. With an authorized MCP client running, capture its access token (from MCP service logs or
#    by inspecting the OAuth dance interactively)
TOKEN=eyJ...   # an active JWT

# 2. Confirm it works
curl -sk -X POST https://mcp.${APEX}/mcp \
  -H "Authorization: Bearer ${TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/list"}'
# Expected: 200 + tools list

# 3. Open https://<apex>/dashboard/settings/mcp-clients, click Revoke on this client

# 4. Within 5s, replay the curl
curl -sk -X POST https://mcp.${APEX}/mcp \
  -H "Authorization: Bearer ${TOKEN}" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/list"}'
# Expected: 401 invalid_token (revoked via Redis)
```

## US4 — get_logs

```bash
# Direct API check (skip MCP for clarity)
PAT=sbp_...
REF=hpeoubhyupioiezzgjzx
curl -sk "https://api.${APEX}/v1/projects/${REF}/analytics/endpoints/logs.all?service=api&iso_timestamp_start=$(date -u -v-1H +%Y-%m-%dT%H:%M:%SZ)&iso_timestamp_end=$(date -u +%Y-%m-%dT%H:%M:%SZ)" \
  -H "Authorization: Bearer ${PAT}"
# Expected: { "result": [...log rows...] }

# Through MCP (via Claude Code or smoke script)
# Ask the LLM: "show me the last 50 api log entries from my <ref> project"
```

## US5 — list_storage_buckets

```bash
curl -sk "https://api.${APEX}/v1/projects/${REF}/storage/buckets" \
  -H "Authorization: Bearer ${PAT}"
# Expected: bare-array of bucket objects
```

## US6 — pause + restore

```bash
# Pause
curl -sk -X POST "https://api.${APEX}/v1/projects/${REF}/pause" \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" -d '{}'
# Expected: 200 + { ..., "status": "INACTIVE" }

# Verify
curl -sk "https://api.${APEX}/v1/projects/${REF}" -H "Authorization: Bearer ${PAT}" | jq .status
# Expected: "INACTIVE"

# Restore
curl -sk -X POST "https://api.${APEX}/v1/projects/${REF}/restore" \
  -H "Authorization: Bearer ${PAT}" -H "Content-Type: application/json" -d '{}'
# Expected: 200 + { ..., "status": "COMING_UP" }

# Poll until ACTIVE_HEALTHY
until curl -sk "https://api.${APEX}/v1/projects/${REF}" -H "Authorization: Bearer ${PAT}" \
  | jq -e '.status == "ACTIVE_HEALTHY"' >/dev/null; do
  echo "waiting..."; sleep 5
done
echo "restored"
```

## Multi-MCP-client smoke (SC-005)

Run the OAuth dance from 3+ different MCP clients. Each goes through DCR independently. Verify each gets a unique `client_id`. Verify each works for `execute_sql` simultaneously without cross-talk.

## Audit log spot-check

```bash
ssh ubuntu@148.113.1.164 "sudo docker exec selfbase-db-1 psql -U selfbase -d selfbase \
  -c \"SELECT action, target_kind, target_id, payload->>'client_id' as client, created_at \
       FROM audit_log \
       WHERE action LIKE 'oauth.%' OR action LIKE 'mcp.%' \
       ORDER BY id DESC LIMIT 20\""
# Expected: every step of the OAuth dance + MCP tool calls logged
```

## Memory check (SC-009)

```bash
# After 20 concurrent OAuth sessions are open (use the smoke script in a loop)
ssh ubuntu@148.113.1.164 "sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' selfbase-mcp"
# Expected: < 150 MiB
```

## Log-leak check (SC-008)

```bash
ssh ubuntu@148.113.1.164 "sudo docker logs --since 10m selfbase-api-1 selfbase-mcp-1 2>&1 \
  | grep -cE 'sbp_[0-9a-f]{40}|eyJ[A-Za-z0-9_-]{60,}'"
# Expected: 0 — no PAT prefix, no JWT prefix in logs
```

## Cleanup

No state to clean up beyond standard dashboard revoke of any test OAuth clients you created.
