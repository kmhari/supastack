# Feature 014 — Hosted multi-project MCP + OAuth 2.1

**Branch**: `014-*` (multi-PR — phases 1+2+3 in #44, phase 4 in #46, phases 5+6+7 in #47, phase 8+9 in #48)

**Spec**: [`specs/014-mcp-http-oauth/spec.md`](../../specs/014-mcp-http-oauth/spec.md)

## What shipped

A hosted multi-project MCP server at `mcp.<apex>/mcp` backed by a new OAuth 2.1 authorization server in selfbase. Operators paste **one URL** into any MCP-aware editor (Claude Code, Cursor, Windsurf, Claude Desktop), authorize in the browser using their existing dashboard session, and immediately drive their selfbase deployment through LLM tool calls — same UX as Cloud's `mcp.supabase.com/mcp`.

## Operator setup

### 1. DNS

`mcp.<apex>` must resolve to the same A-record as `api.<apex>`. The existing `*.<apex>` wildcard cert (feature 004) covers it — no new cert provisioning.

### 2. Connect from your MCP client

Paste into your editor's MCP config (the exact format depends on the editor; example for Claude Code's `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "selfbase": {
      "type": "http",
      "url": "https://mcp.<apex>/mcp"
    }
  }
}
```

First time you trigger an MCP call from the LLM, your browser opens to the selfbase authorize page. If you're already logged into the selfbase dashboard, you'll see only the consent dialog — click **Authorize**. The tab closes automatically and the MCP client receives an access token.

### 3. Revoke a connected client

Open **`/settings/mcp-clients`** in the dashboard. Each row shows: client_name, authorized_at, last_used_at, scope, plus a **Revoke** button. Revoke takes effect within 5 seconds (verified live: ~189ms typical).

## MCP tool surface

| Tool                                                                     | Backed by                                            | Notes                                                                                                        |
| ------------------------------------------------------------------------ | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `list_projects`                                                          | `GET /v1/projects`                                   | Cloud-status enum (ACTIVE_HEALTHY/INACTIVE/etc.)                                                             |
| `get_project`                                                            | `GET /v1/projects/:ref`                              |                                                                                                              |
| `list_organizations` / `get_organization`                                | `GET /v1/organizations*`                             |                                                                                                              |
| `pause_project` / `restore_project`                                      | `POST /v1/projects/:ref/{pause,restore}`             | Async — pause returns INACTIVE immediately; restore returns COMING_UP, transitions to ACTIVE_HEALTHY in <60s |
| `execute_sql`                                                            | `POST /v1/projects/:ref/database/query`              | Wire-compatible with upstream; multi-statement rejected                                                      |
| `list_tables` / `list_extensions` / `list_migrations`                    | (via execute_sql)                                    | Driven by upstream MCP                                                                                       |
| `apply_migration`                                                        | `POST /v1/projects/:ref/database/migrations`         | Feature 006                                                                                                  |
| `get_project_url` / `get_publishable_keys` / `generate_typescript_types` | `GET /v1/projects/:ref/{api-keys,types/typescript}`  | Feature 003 + 006                                                                                            |
| `list_edge_functions` / `get_edge_function` / `deploy_edge_function`     | `GET/POST /v1/projects/:ref/functions*`              | Feature 003 US3                                                                                              |
| `get_logs`                                                               | `GET /v1/projects/:ref/analytics/endpoints/logs.all` | Routes through per-project Kong (`/analytics/v1/*`) — see below                                              |
| `list_storage_buckets` (a.k.a. `list_all_buckets`)                       | `GET /v1/projects/:ref/storage/buckets`              | Routes through per-project Kong (`/storage/v1/*`)                                                            |
| `search_docs`                                                            | Supabase docs (hosted)                               | No backend dep                                                                                               |

### Deferred tools (still appear in `tools/list` but error at call time)

Upstream `@supabase/mcp-server-supabase` registers MCP tools by **operation-group** presence, not per-method. So even though selfbase deliberately omits these capabilities, the tools still show up. Calling any of them surfaces a clean "not implemented" error (not a crash):

- `create_project`, `get_cost`, `confirm_cost` — see feature 017 follow-up
- `get_advisors` (security + perf) — see feature 016 follow-up
- `get_storage_config` / `update_storage_config` — see feature 018 follow-up
- All `*_branch` tools — see issue #41

Long-term fix is either upstream per-method gating OR post-construction tool-unregister via `@modelcontextprotocol/sdk`'s `Server` API.

## One-time per-project op required for `get_logs`

The per-project `kong.yml` has the analytics routes **commented out by default** in the upstream supabase-template. For `get_logs` to work, operators must:

```bash
# On the VM
PROJ_KONG=/var/selfbase/instances/<ref>/volumes/api/kong.yml

# Uncomment the analytics-v1-api block in the analytics section (lines ~310-318):
sudo python3 <<EOF
path = '$PROJ_KONG'
with open(path) as f: txt = f.read()
old = (
  "  # - name: analytics-v1-api\n"
  "  #   _comment: 'Analytics: /analytics/v1/api/endpoints/* -> http://logflare:4000/api/endpoints/*'\n"
  "  #   url: http://analytics:4000/api/endpoints\n"
  "  #   routes:\n"
  "  #     - name: analytics-v1-api\n"
  "  #       strip_path: true\n"
  "  #       paths:\n"
  "  #         - /analytics/v1/api/endpoints/\n"
)
new = old.replace('  # ', '  ').replace('  - ', '  - ')  # uncomment
with open(path, 'w') as f: f.write(new)
EOF

# Restart that project's Kong
sudo docker restart selfbase-<ref>-kong-1
```

**TODO** (follow-up): patch `infra/supabase-template/volumes/api/kong.yml` to uncomment by default, and add a worker job that patches existing projects' kong.yml.

## OAuth design

- **Access tokens**: JWT (HS256) signed via HKDF-derived key from selfbase master key (label `selfbase-oauth-jwt-v1`). 1h TTL. Matches Cloud's gotrue defaults.
- **Refresh tokens**: opaque random strings (≥256 bits), stored in `oauth_refresh_tokens`. Single-use (rotated on every refresh). 30-day idle expiry. Reuse-detection per RFC 6749 §10.4 revokes the entire grant.
- **Revocation**: Redis-backed by JWT `jti` claim. `selfbase:oauth:revoked:<jti>` with TTL = remaining token lifetime. Auto-expires; no GC needed for the hot path. Cleanup crons handle the cold-path DB rows.
- **DCR**: Per RFC 7591 at `POST /v1/oauth/register`. Per-IP rate-limited to 10/hour. Every MCP client (including Claude Code, Cursor, etc.) self-registers — no allow-list, no "verified" tier in the consent UI.
- **Discovery**: `/.well-known/oauth-authorization-server` (RFC 8414) on the api host + `/.well-known/oauth-protected-resource` (RFC 9728) on the mcp host. MCP clients auto-find both via these.

## Architecture

```
Operator's MCP client (Claude Code etc.)
   │
   │  HTTPS + OAuth Bearer
   ▼
┌──────────────────┐
│ Caddy (apex)     │
│  mcp.<apex>      │──► selfbase-mcp:3002
│  api.<apex>      │──► api:3001
│  *.<apex>        │──► various per-project Kong via host-mapped ports
└──────────────────┘
                          │
                          ▼
            ┌──────────────────────────────────┐
            │ selfbase-mcp:3002                │
            │  - Bearer auth via @selfbase/oauth│
            │  - Per-session createSupabaseMcpServer({platform})│
            │  - Strips deferred groups (storage write, branching, etc.) │
            └──────────────────────────────────┘
                          │
                          │  /v1/* with OAuth JWT (dual-auth plugin accepts both PAT and JWT)
                          ▼
            ┌──────────────────────────────────┐
            │ selfbase api                     │
            │  - dual-auth (PAT + OAuth JWT)   │
            │  - /v1/oauth/* OAuth 2.1 server  │
            │  - /v1/projects/:ref/*           │
            └──────────────────────────────────┘
```

## Files

```
packages/oauth/                                  NEW workspace package
  src/jwt.ts                                     HKDF + HS256 sign/verify
  src/revocation.ts                              Redis revocation list
apps/mcp/                                        NEW compose service
  src/server.ts                                  Streamable HTTP transport mount
  src/bearer-auth.ts                             Bearer validation + WWW-Authenticate
  src/platform-build.ts                          buildPlatform with deferred-group stripping
apps/api/src/services/
  oauth-pkce.ts                                  S256 verifier
  oauth-clients-store.ts / oauth-codes-store.ts / oauth-refresh-store.ts
  oauth-register-bucket.ts                       Per-IP token bucket
  logflare-client.ts                             get_logs forwarder (Kong-routed)
  storage-buckets-proxy.ts                       list_storage_buckets reverse-proxy (Kong-routed)
  service-role-jwt.ts                            Per-project service-role JWT minter (24h cache)
apps/api/src/routes/oauth/
  discovery.ts / register.ts / authorize.ts / token.ts
  clients-dashboard.ts                           GET/DELETE /api/v1/oauth/clients{,/:id}
apps/api/src/routes/management/
  logs.ts / storage-buckets.ts / pause-restore.ts
apps/api/src/plugins/auth.ts                     MODIFIED — dual-credential (PAT + OAuth JWT)
apps/api/src/services/caddy-config.ts            MODIFIED — adds mcp.<apex> route
apps/worker/src/jobs/
  cleanup-oauth-codes.ts                         1-min interval, DELETE expired
  cleanup-oauth-refresh.ts                       1-hour interval, DELETE 30-day-idle
apps/web/src/pages/SettingsMcpClients.tsx        NEW dashboard page
packages/db/migrations/0013_oauth_tables.sql     NEW 4 OAuth tables (idempotent)
infra/docker-compose.yml                         MODIFIED — adds selfbase-mcp service + SELFBASE_APEX env on api+caddy
```

## Test summary

- **357 api tests pass** (+74 new across 8 new test files)
- **14 mcp tests pass** (bearer-auth + platform-build)
- **19 oauth tests pass** (HKDF JWT + Redis revocation)
- **23 worker tests pass** (+4 cleanup-cron tests)
- Live-VM E2E shells: `oauth-dance.sh`, `mcp-roundtrip.sh`, `dcr-hardening.sh`

## Live-VM verified

- ✅ OAuth dance end-to-end (register → consent → token → refresh → reuse-detection)
- ✅ MCP `initialize → tools/list → tools/call execute_sql + list_tables`
- ✅ SC-004 revoke propagation: **189ms** (target <5000ms)
- ✅ Phase 6 `get_logs` (post Kong patch)
- ✅ Phase 7 `list_storage_buckets`
- ✅ Phase 8 `pause_project` / `restore_project`
- ✅ Audit log entries for every OAuth event

## Known limitations

1. **`tools/list` includes 4 tools that error at call time** (`create_project`, `get_cost`, `confirm_cost`, `get_advisors`) — upstream architecture; see "Deferred tools" above.
2. **`get_logs` requires manual Kong patch** per project — see "One-time per-project op" above.
3. **No granular OAuth scopes** in v1 — all grants are all-or-nothing within the operator's RBAC role. Finer scopes deferred to a later feature.
4. **No OAuth admin UI** for managing client metadata (only revoke). v1 is sufficient — operator just revokes + re-authorizes if something's wrong.
