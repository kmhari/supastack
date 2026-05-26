# Contract — `POST /mcp` at `mcp.<apex>`

**Purpose**: MCP Streamable HTTP transport. The single endpoint operators paste into their MCP client config.

**Transport spec**: MCP Streamable HTTP per MCP spec 2025-06-18 (`@modelcontextprotocol/sdk`'s `StreamableHTTPServerTransport`). Accepts JSON-RPC over HTTP POST with optional Server-Sent Events streaming.

## Request

```http
POST /mcp
Host: mcp.<apex>
Authorization: Bearer <OAuth JWT access token>
Content-Type: application/json
Accept: application/json, text/event-stream
MCP-Protocol-Version: 2025-06-18
mcp-session-id: <UUID, optional on first call>

{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "tools/call",
  "params": {
    "name": "execute_sql",
    "arguments": {
      "project_id": "<ref>",
      "query": "SELECT 1"
    }
  }
}
```

## Auth flow (per request)

1. Extract `Authorization: Bearer <token>`. Missing → 401 + `WWW-Authenticate` (per `oauth-discovery-endpoints.md`).
2. Verify JWT signature via HS256 + HKDF-derived key. Bad signature → 401.
3. Verify claims: `exp` > now, `iss` matches our issuer, `aud` matches our resource. Else → 401.
4. Redis EXISTS `selfbase:oauth:revoked:<jti>` → if 1, 401 `invalid_token` (revoked).
5. Resolve `user_id` from `sub` claim.
6. If `mcp-session-id` header present and session is in-memory map → reuse session's MCP server + transport.
7. Else → mint a new session: build `createSupabaseApiPlatform({ accessToken: <bearer>, apiUrl: 'http://api:3001' })`, strip deferred operation groups, call `createSupabaseMcpServer({ platform })`, wrap in new `StreamableHTTPServerTransport({ sessionIdGenerator: () => crypto.randomUUID() })`. Store in session map.
8. Call `transport.handleRequest(req.raw, reply.raw, parsedBody)` — upstream handles all JSON-RPC routing.

## Response — typical (JSON over HTTP)

```http
HTTP/1.1 200 OK
Content-Type: application/json
mcp-session-id: <UUID — generated on first response if not provided in request>

{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "content": [
      { "type": "text", "text": "{\"result\":\"[bare-array of rows here]\"}" }
    ]
  }
}
```

(Specific tool result shapes are upstream's responsibility — we don't enumerate every tool here.)

## Response — streaming (SSE)

```http
HTTP/1.1 200 OK
Content-Type: text/event-stream
mcp-session-id: <UUID>
Cache-Control: no-cache

event: message
data: {"jsonrpc":"2.0","id":1,"result":{...partial...}}

event: message
data: {"jsonrpc":"2.0","id":1,"result":{...complete...}}
```

Used when tools want to stream incremental output. Upstream transport handles framing; we just pipe.

## Tool list (`tools/list` method)

What `tools/list` returns is determined by the platform groups we expose. Per FR-016 + Decision 1, **only** the following groups are present in our `SupabasePlatform`:

| Group | Tools exposed |
|---|---|
| `account` (read-only subset) | `list_projects`, `get_project`, `list_organizations`, `get_organization`, `pause_project`, `restore_project` |
| `database` | `list_tables`, `list_extensions`, `list_migrations`, `apply_migration`, `execute_sql` |
| `development` | `get_project_url`, `get_publishable_keys`, `generate_typescript_types` |
| `functions` | `list_edge_functions`, `get_edge_function`, `deploy_edge_function` |
| `debugging` (subset) | `get_logs` only — `get_advisors` stripped |
| `storage` (subset) | `list_storage_buckets` only — `get_storage_config` + `update_storage_config` stripped |
| `docs` | `search_docs` |

Stripped tools: `create_project`, `get_cost`, `confirm_cost`, all `branching` tools. SC-006 verifies these are absent from `tools/list`.

## Error responses

| Status | When |
|---|---|
| 401 | Missing/expired/revoked/invalid Bearer; emits `WWW-Authenticate` header |
| 400 | Malformed JSON-RPC body |
| 405 | Wrong HTTP method (only POST is supported on `/mcp`) |
| 500 | Internal MCP server error (audited) |

JSON-RPC-level errors (e.g., tool not found, tool arg validation failure) are returned per JSON-RPC 2.0 spec as `{"jsonrpc":"2.0","id":N,"error":{"code":-32601,"message":"..."}}`. The HTTP status stays 200.

## Session lifecycle

- Created on first request with no/unknown `mcp-session-id`. Server generates a UUID, returns it in the `mcp-session-id` response header.
- Sticky to the in-process session map for the configured idle TTL (30 min).
- Garbage-collected by a background interval (1 min) when `lastUsedAt < now - 30min`.
- On MCP service restart: all sessions drop. MCP clients reconnect transparently (open a fresh session with no `mcp-session-id`, get a new one).

## Side effects

- First request for a new session: emit `mcp.session.opened` audit
- Every `tools/call`: emit `mcp.tool.invoked` audit with `{ session_id, client_id, user_id, tool_name, project_ref? (from arguments) }`
- `execute_sql` calls flow through to `/v1/projects/<ref>/database/query` which already emits `instance.db.query.executed` (feature 013) — no double-logging

## Test obligations

- Unauthenticated POST → 401 + `WWW-Authenticate` header
- Expired token → 401 + `invalid_token`
- Revoked-via-Redis token → 401 + `invalid_token`
- Valid token, first request → 200 + `mcp-session-id` header in response
- Subsequent request with same `mcp-session-id` → reuses session (verify via instrumented `createSupabaseMcpServer` mock)
- `tools/list` → returns ONLY the in-scope tools; `create_project`/`get_advisors`/`get_storage_config`/branching tools all absent
- `tools/call` for `execute_sql` → forwards to `/v1/projects/<ref>/database/query`, returns wrapped result
- Session idle > 30min → entry removed; next request mints a new session
- Two concurrent sessions for the same operator → independent state, no cross-talk
- Live MCP smoke: extend `/tmp/mcp-smoke.mjs` to use OAuth bearer instead of PAT; both `execute_sql` and `list_tables` pass
