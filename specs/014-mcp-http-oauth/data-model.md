# Data Model — 014 MCP HTTP + OAuth 2.1

**Date**: 2026-05-26

## Persistent storage

### Control-plane DB (Drizzle): 4 new tables

All migrations idempotent (`CREATE TABLE IF NOT EXISTS`, `ADD CONSTRAINT IF NOT EXISTS`). Single migration file at `packages/db/migrations/0NNN-oauth-tables.sql`.

#### `oauth_clients`

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | DCR-assigned client_id |
| client_name | text NOT NULL | submitted by client at registration; shown in consent UI |
| redirect_uris | text[] NOT NULL | allow-list, validated on every authorize call |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| created_by_ip | inet | for rate-limit forensics |
| metadata | jsonb | extra RFC 7591 fields (logo_uri, tos_uri, …) — captured verbatim but not surfaced in UI for v1 |

Indices: PK on `id`. No additional indices for v1 (DCR rate-limit lookup is by IP, not client_id).

#### `oauth_codes`

| Column | Type | Notes |
|---|---|---|
| code | text PK | opaque random ≥256 bits, single-use |
| client_id | uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE | |
| user_id | uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE | which operator authorized |
| redirect_uri | text NOT NULL | locked at issue; must match on token exchange |
| code_challenge | text NOT NULL | S256 PKCE challenge |
| scope | text NOT NULL | granted scopes (CSV; v1 = "platform") |
| expires_at | timestamptz NOT NULL | issue + 60s |
| used_at | timestamptz | NULL until first use; second use → reject (one-time) |

Indices: PK on `code`. Index on `expires_at` for cleanup cron.

#### `oauth_refresh_tokens`

| Column | Type | Notes |
|---|---|---|
| token | text PK | opaque random ≥256 bits, single-use (rotated on every refresh) |
| client_id | uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE | |
| user_id | uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE | |
| scope | text NOT NULL | scope locked from the original grant |
| issued_at | timestamptz NOT NULL DEFAULT now() | |
| last_used_at | timestamptz NOT NULL DEFAULT now() | updated on every successful refresh |
| revoked_at | timestamptz | set on revoke; non-null = invalid |
| previous_token | text | optional — for refresh-token-rotation reuse-detection (RFC 6749 §10.4) |

Indices: PK on `token`. Compound index on `(user_id, client_id)` for the dashboard listing query + revoke-by-(user,client). Index on `last_used_at` for the 30-day idle-expiry cron.

#### `oauth_revocations` (audit-trail only — hot-path is Redis)

| Column | Type | Notes |
|---|---|---|
| id | bigserial PK | |
| jti | text NOT NULL | the access-token JTI that was revoked |
| user_id | uuid NOT NULL | |
| client_id | uuid NOT NULL | |
| revoked_at | timestamptz NOT NULL DEFAULT now() | |
| revoke_reason | text | 'operator_action' / 'client_deleted' / 'user_removed' |

Indices: PK on `id`. Index on `jti` for forensic lookups (cold-path; revocation check itself goes through Redis).

### `audit_log` (existing — extended action values)

No schema migration required. New action values appended:

| Action | Emitted when | Payload fields |
|---|---|---|
| `oauth.code.issued` | `/v1/oauth/authorize` consent → Authorize | `{ client_id, user_id, scope, redirect_uri }` |
| `oauth.token.issued` | `/v1/oauth/token` grant_type=authorization_code success | `{ client_id, user_id, scope, jti, expires_in }` |
| `oauth.token.refreshed` | `/v1/oauth/token` grant_type=refresh_token success | `{ client_id, user_id, jti_old, jti_new }` |
| `oauth.token.revoked` | dashboard revoke OR `oauth/revoke` endpoint | `{ client_id, user_id, jti, reason }` |
| `oauth.client.registered` | `/v1/oauth/register` success | `{ client_id, client_name, redirect_uris, requesting_ip }` |
| `oauth.consent.denied` | operator clicked Deny on authorize page | `{ client_id, user_id }` |
| `mcp.session.opened` | first MCP request with a new `mcp-session-id` | `{ session_id, client_id, user_id }` |
| `mcp.tool.invoked` | every `tools/call` over MCP | `{ session_id, client_id, user_id, tool_name, project_ref? }` |

Audit row uses the existing schema: `actor_user_id` (resolved from session/token), `target_kind` (`oauth_client` for OAuth events, `instance` for `mcp.tool.invoked` against a specific project, NULL otherwise), `target_id`.

### `api_tokens` (existing — no change)

The existing PAT system stays. The auth plugin learns to recognize a second credential type (OAuth JWT) alongside PATs. PAT issuance + revocation flows are unchanged.

## Redis-backed state

### Revocation set

```
KEY:    supastack:oauth:revoked:<jti>
VALUE:  "1"   (presence is the signal; value unused)
TTL:    <remaining_lifetime_of_token_in_seconds>  (set at insert; auto-expires)
```

Check on every authenticated request: `EXISTS supastack:oauth:revoked:<jti>` → if 1, return 401.

### DCR rate-limit (existing token-bucket pattern from feature 012)

```
KEY:    supastack:oauth:dcr:<ip>
TYPE:   token bucket (refresh ~1 per 6 min, capacity 10)
```

10 registrations per IP per hour. Reuses the existing `cli-login-role-bucket.ts` pattern (rename/generalize to `rate-limit-bucket.ts` or copy).

### MCP session map (in-process — NOT Redis)

Per Clarifications Q5: in-process map in the MCP service.

```ts
type SessionEntry = {
  sessionId: string;
  userId: string;
  clientId: string;
  mcpServer: McpServer;             // upstream library instance
  transport: StreamableHTTPServerTransport;
  lastUsedAt: number;
};
const sessions = new Map<string, SessionEntry>();
```

Idle TTL 30 minutes. Background interval (1 min) sweeps stale entries.

## Validation rules

| Rule | Enforced at |
|---|---|
| `code_challenge_method` MUST be `S256` (no `plain` per OAuth 2.1) | api (Zod) |
| `redirect_uri` MUST exactly match one of the client's registered `redirect_uris` | api (oauth-clients-store) |
| Authorization code is single-use (second use → reject + audit) | api (oauth-codes-store, atomic UPDATE) |
| Refresh token is single-use (rotation) — reuse-detection MUST revoke the entire grant | api (oauth-refresh-store) |
| Bearer token JWT signature MUST verify against the HKDF-derived signing key | api auth plugin + mcp bearer-auth |
| Bearer token `exp` MUST be in the future | api auth plugin + mcp bearer-auth |
| Bearer token `jti` MUST NOT be in the Redis revocation set | api auth plugin + mcp bearer-auth |
| Bearer token `iss` MUST match `https://api.<apex>` | api auth plugin + mcp bearer-auth |
| Bearer token `scope` claim MUST contain the required scope for the action | api `app.authorize()` |
| DCR client metadata: `client_name` non-empty + ≤200 chars; `redirect_uris` array of http(s) URLs only | api (Zod) |
| DCR rate limit: 10 registrations per IP per hour | api (redis token-bucket) |
| Idle dashboard session at authorize → redirect to login with `next=<authorize-url>` | api (oauth-authorize route) |
| Project must be `running` for `db_query` / `db_dump` MCP tools (existing feature 013 invariant) | api (per-instance-pg) |
| Tools list filtered by platform-implementation presence | mcp service (platform-build) |

## Entity relationships

```
operator (user)                           OAuth client (DCR-registered)
     │                                            │
     │                                            │
     ├─authorizes──> oauth_code ────────exchanged──> oauth access token (JWT, in-memory)
     │                                            │     +
     │                                            │   oauth refresh token (opaque, DB)
     │                                            │
     │ (uses access token as Bearer)              │
     ▼                                            │
supastack api OR supastack-mcp                      │
     ├─ JWT verify (HS256, HKDF key)              │
     ├─ Redis revocation check (jti)              │
     ├─ scope check (RBAC)                        │
     │                                            │
     │  api: route handler runs (PATs and OAuth   │
     │       JWTs share the resolved user_id      │
     │       beyond this point)                   │
     │                                            │
     │  mcp: createSupabaseApiPlatform(token,     │
     │       apiUrl) builds platform; createSupa- │
     │       baseMcpServer(platform) builds       │
     │       server; transport.handleRequest()    │
     │       routes the JSON-RPC call             │
     │                                            │
     ▼                                            │
[platform call /v1/projects/<ref>/database/query  │
 OR /v1/projects/<ref>/storage/buckets etc.       │
 — same auth path as PAT; same operator identity] │

revoke flow:
operator (dashboard /settings/mcp-clients)
     │
     ├─ DELETE oauth_refresh_token row(s) for (user, client)
     ├─ INSERT oauth_revocation audit row(s) for the live access token's jti
     ├─ Redis SET supastack:oauth:revoked:<jti> EX <remaining_seconds>
     │
     ▼
next api/mcp request with the access token → Redis EXISTS hits → 401
```

No cross-project state. Each request is self-contained. The control-plane DB grows linearly with authorized clients (small number) + active refresh tokens (one per operator-client pair).

## Cleanup / GC

- **Authorization codes**: cron (1 min interval) deletes expired rows (`WHERE expires_at < now()`).
- **Refresh tokens**: cron (1 hour interval) deletes rows where `last_used_at < now() - interval '30 days'` AND `revoked_at IS NULL`.
- **Revocation audit rows**: retained indefinitely (audit trail, small data).
- **Redis revocation set**: auto-expires via TTL (no GC needed).
- **MCP sessions**: 1-min interval sweeps idle sessions in the MCP service.
