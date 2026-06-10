# MCP Server

Supastack ships a hosted multi-project **MCP server** at `mcp.<apex>/mcp`,
backed by an OAuth 2.1 authorization server. Authorize once in the browser —
no token wrangling — and every LLM tool call routes to the right project.

## Connect your editor

Paste into your MCP client config. Claude Code (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "supastack": {
      "type": "http",
      "url": "https://mcp.<your-apex>/mcp"
    }
  }
}
```

The same URL works for Cursor, Windsurf, and Claude Desktop (config format
varies). On the first MCP call your browser opens the supastack authorize page;
if you're logged into the dashboard, click **Authorize** and the tab closes.

## DNS

`mcp.<apex>` must resolve to the same A record as the apex/`api.<apex>`. The
wildcard cert already covers it — see [DNS & TLS](DNS-and-TLS).

## Tools

`list_projects` · `get_project` · `execute_sql` · `list_tables` ·
`list_extensions` · `list_migrations` · `apply_migration` ·
`generate_typescript_types` · `list_edge_functions` · `deploy_edge_function` ·
`get_logs` · `list_storage_buckets` · `pause_project` · `restore_project` ·
`list_organizations` · `get_organization` · `search_docs`.

## Revoke a client

Open `https://<apex>/settings/mcp-clients`. Each row shows the client name,
authorized/last-used times, and a **Revoke** button (takes effect within ~5 s).
