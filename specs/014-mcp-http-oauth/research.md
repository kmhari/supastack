# Research — 014 MCP HTTP + OAuth 2.1

**Date**: 2026-05-26

All clarifications from spec.md → Clarifications (Session 2026-05-26) are resolved. The decisions below cover the implementation-specific choices needed on top of the clarified requirements.

---

## Decision 1 — Reuse upstream `@supabase/mcp-server-supabase` AS-IS; no fork

**Decision**: Add `@supabase/mcp-server-supabase@^0.8.1` + `@modelcontextprotocol/sdk` as dependencies of the new `apps/mcp` service. Build per-request `SupabasePlatform` via upstream's `createSupabaseApiPlatform({ accessToken, apiUrl })`. Pass to `createSupabaseMcpServer({ platform })`. Wrap in `StreamableHTTPServerTransport`. Done.

**Rationale**:
- Verified during research phase: upstream package is Apache 2.0, multi-project by design (`createSupabaseApiPlatform` takes `projectId` per method, not at construction), and is the **same code Cloud runs** (no closed-source superset).
- The platform abstraction (`SupabasePlatform` type) is explicitly designed to be swapped. We pass `apiUrl: 'http://api:3001'` (internal compose-network address) and every `/v1/*` call routes to our existing management API.
- `createSupabaseMcpServer({ platform })` filters its tool surface by which platform operation groups (`account`, `database`, `functions`, etc.) are present. Stripping deferred groups before construction = LLM never sees deferred tools.

**Alternatives considered**:
- Build a custom MCP server from scratch — rejected; ~2 weeks of reimplementing what upstream already maintains, including LLM-prompt-injection safety wrappers around `execute_sql` results.
- Fork upstream and patch — rejected; no patches needed (the strip-groups pattern works with their public API).
- Use `HenkDz/selfhosted-supabase-mcp` — rejected; single-project hardcoded credentials, bypasses the management API, no multi-tenancy.

---

## Decision 2 — Run MCP as a separate compose service (`apps/mcp`), not embedded in api

**Decision**: New compose service `supastack-mcp` running on port 3002 inside the container network. Caddy route `mcp.<apex>` → `supastack-mcp:3002`. Dockerfile based on `node:20-slim`.

**Rationale**:
- Per-session MCP server instances can hold non-trivial state (subscriptions, in-flight tool calls). Memory profile differs from api's request/response shape. Isolation prevents api OOM cascade.
- Upstream MCP SDK is a heavy peer dep (~5 MB unpacked). Keeping it out of api keeps api's bundle + startup time tight.
- The MCP library bumps frequently as new tools land upstream. Separate service = bump + redeploy without touching api.
- Reuses the existing Redis instance (revocation list); reuses the existing api at `http://api:3001` for `/v1/*` calls. Zero new infrastructure aside from one container.

**Alternatives considered**:
- Embed in api — rejected for memory + dependency reasons above.
- Embed in worker — wrong layer; worker is for background jobs, not HTTP.
- Run as a per-project sidecar — wrong scope; we want one platform-wide MCP, not N per-project MCPs.

---

## Decision 3 — JWT signing key: HKDF from master key, label `supastack-oauth-jwt-v1`

**Decision** (per Clarifications Q2): HKDF-SHA256 derive a 32-byte HS256 signing key from `loadMasterKey()` with the byte-string label `supastack-oauth-jwt-v1`. Algorithm chosen: HS256 (HMAC-SHA256). No DB-stored key.

```ts
// apps/api/src/services/oauth-jwt.ts
import { hkdfSync } from 'node:crypto';
const SIGNING_KEY = hkdfSync('sha256', loadMasterKey(), Buffer.alloc(0), 'supastack-oauth-jwt-v1', 32);
```

**Rationale**:
- HS256 is symmetric — both the api (which signs) and the mcp service (which verifies) hold the same key, both via `loadMasterKey()`. No public-key distribution problem.
- HKDF gives domain separation (a different label could mint a different key for other purposes later without compromise).
- No new operator-managed secret. Master-key rotation = OAuth-key rotation, blast radius bounded to ≤1h of forced re-auth (access TTL).

**Alternatives considered**:
- RS256 / EdDSA (asymmetric) — overkill for an in-cluster signing relationship; adds public-key publishing surface (`/.well-known/jwks.json`) for no real benefit when both signer + verifier are in the same trust domain.
- Dedicated key in DB — rejected per Clarifications Q2.
- Reuse SESSION_SECRET — rejected per Clarifications Q2.

---

## Decision 4 — Revocation propagation: Redis set keyed by `jti`

**Decision** (per Clarifications Q3): Every issued access token includes a `jti` claim (UUID v4). On revoke, `SET supastack:oauth:revoked:<jti> "1" EX <remaining_seconds>` in the existing api Redis instance. Every authenticated request (api `/v1/*` + MCP `/mcp`) does `EXISTS supastack:oauth:revoked:<jti>` before processing — return 401 if present.

**Rationale**:
- ~1ms per request — well under the 100ms target.
- Auto-expires when the access token would have expired naturally (Redis TTL = remaining lifetime), so the set stays small.
- Reuses the existing Redis instance (already in api compose stack). MCP service needs to add an ioredis client + Redis URL env var.
- Refresh tokens are opaque + DB-stored; their revocation is a DB delete (no Redis needed). Revoking a client revokes BOTH: blacklists the access token's jti in Redis AND deletes the refresh token row.

**Alternatives considered**:
- DB-check every request — rejected per Q3 (latency cost too high for hot path).
- TTL-only (no revocation list) — rejected per Q3 (violates SC-004 <5s revoke).
- Local in-process cache of revoked jtis — wrong; api + MCP are separate processes; we need a shared store.

---

## Decision 5 — DCR-only client registration (no pre-registered allow-list)

**Decision** (per Clarifications Q4): Every MCP client (Claude Code, Cursor, Windsurf, Claude Desktop, custom) self-registers via `POST /v1/oauth/register`. No seed data. No "verified" tier in the consent UI.

Rate limit: 10 registrations per IP per hour (mitigates abuse). Per-client metadata stored in `oauth_clients` table.

**Rationale**:
- Matches what MCP spec expects clients to do.
- Eliminates the maintenance burden of tracking each client's official OAuth client_id (which we'd assign anyway, defeating the trust signal).
- Consent UI shows the operator the `client_name` + `redirect_uris` from the DCR submission — operator's responsibility to spot fakes (supastack is a single-operator-org product; the threat model is light).

**Alternatives considered**:
- Hybrid (seed top 4 clients) — rejected per Q4 (we can't issue trust signals for clients whose identity we don't actually verify).
- Allow-list mode — rejected per Q4 (adds friction; not what MCP spec expects).

---

## Decision 6 — Single-replica MCP service; in-process sessions

**Decision** (per Clarifications Q5): One container, in-memory session map keyed by `mcp-session-id` header. Idle TTL 30 minutes. Process restart = all sessions drop (MCP clients reconnect, opening fresh sessions transparently).

**Rationale**:
- Matches supastack's single-VM topology.
- SC-009 capacity (20 concurrent sessions @ <150 MiB) easily fits in process.
- Sessions hold MCP server instance + transport; rebuilding on reconnect is cheap (~10ms).
- Future option: if scale demands, swap the in-memory session map for a Redis-backed one (matches the revocation-list architecture).

**Alternatives considered**:
- Multi-replica + Redis sessions — premature per Q5.
- Sessionless (mint a fresh MCP server per request) — wrong; the MCP Streamable HTTP protocol requires session continuity for tool subscriptions, streaming responses, and request IDs.

---

## Decision 7 — Authorize-time identity check: reuse dashboard session cookie

**Decision**: The `GET /v1/oauth/authorize` endpoint reads the existing supastack dashboard session cookie. If no valid session, redirect to the dashboard login page (passing the entire authorize URL as a `next` query param), then bounce back to authorize on successful login.

**Implementation**:
- The authorize endpoint is rendered server-side (Fastify returns HTML) OR redirects to a React route in the web app. Either works; we'll pick based on which is less code (probably server-side simple HTML — fewer integration points).
- The "next" round-trip uses an existing `?next=<url>` pattern in the login flow (or we add one — check first).

**Rationale**:
- Operator is almost always already logged into the dashboard when triggering an OAuth dance. No need to re-enter credentials.
- Reuses session validation logic that already exists. Zero new authn surface.
- Failing case (not logged in) is a clean 302 → login → 302 back. Standard pattern.

**Alternatives considered**:
- Separate username/password form on the authorize page — rejected (duplicates dashboard login; awkward UX).
- OIDC-style passive auth check (silent iframe) — overkill for supastack's single-org model.

---

## Decision 8 — Status enum translation: introduce a thin mapping layer in `/v1/projects/*` responses

**Decision** (per FR-036): Add a single helper `mapSupastackStatusToCloud(status: string): string` that maps supastack's internal enum (`running`, `paused`, `provisioning`, `failed`, `stopped`, `deleting`, `creating`) to Cloud's wire enum (`ACTIVE_HEALTHY`, `INACTIVE`, `COMING_UP`, `UNKNOWN`, `INACTIVE`, `REMOVED`, `COMING_UP`). Apply at every `/v1/projects/*` response boundary (list_projects, get_project, pause_project response, restore_project response).

**Rationale**:
- Without this, MCP and CLI clients see supastack-native enum values they don't know how to interpret.
- Cloud's enum is the wire-shape contract; we owe consumers this translation.
- Single helper = single point of update if Cloud adds a new status value.

**Alternatives considered**:
- Change supastack's internal enum to match Cloud — too disruptive; affects existing dashboard code, audit logs, etc.
- Pass-through supastack enum + rely on consumers to handle "UNKNOWN" — breaks the wire-compat goal.

---

## Decision 9 — Logflare forwarding: HTTP GET against the analytics container

**Decision**: `GET /v1/projects/:ref/analytics/endpoints/logs.all` resolves the per-project analytics container address (`supastack-<ref>-analytics-1:4000` internally), forwards the SQL query (either constructed from `service` + time-range params or passed verbatim via `sql=`), authenticates with the per-project Logflare API key.

**Per-project Logflare key storage**: We currently DO store a `logflareApiKey` field on `supabase_instances.encryptedSecrets` (verified during research — the analytics container needs it for ingestion at startup). The forwarder decrypts via existing master-key helpers.

**Service → table mapping** (matches upstream `chunk-IO3RHCXN.js` getLogs handler):
- `api` → `edge_logs`
- `postgres` → `postgres_logs`
- `edge-function` → `function_edge_logs`
- `auth` → `auth_logs`
- `storage` → `storage_logs`
- `realtime` → `realtime_logs`

**Rationale**:
- Logflare exposes a SQL-like HTTP endpoint; forwarding is straightforward.
- The per-project analytics container is on the shared compose network — addressable directly.
- Reuses existing encrypted-secrets infrastructure for the API key.

**Alternatives considered**:
- Direct PG query against logflare's underlying DB — couples us to logflare's schema (which changes); the HTTP API is the stable contract.
- Aggregate logs platform-side (run our own logflare clone) — over-engineering; per-project is fine.

---

## Decision 10 — Storage bucket listing: reverse-proxy with service-role JWT swap

**Decision**: `GET /v1/projects/:ref/storage/buckets` reverse-proxies `GET supastack-<ref>-storage-1:5000/bucket`. The proxy strips the client's PAT/OAuth Bearer and substitutes a freshly-minted per-project service-role JWT (24-hour TTL, cached) signed with the per-project JWT secret stored in `encryptedSecrets`.

**Rationale**:
- The storage container's REST API trusts JWT Bearer tokens signed with the project's JWT secret. It doesn't know about supastack PATs or our OAuth tokens.
- Service-role JWT minting is the same pattern used by the existing reveal-credentials infrastructure.
- 24-hour caching of the minted JWT avoids re-signing on every request (negligible compute but reduces noise in logs).

**Alternatives considered**:
- Query storage's underlying DB tables directly (`storage.buckets`) — couples us to internals; the HTTP API is the stable contract.
- Forward the operator's supastack JWT — storage doesn't trust it.

---

## Decision 11 — Pause/restore wire-up: enqueue, return immediately, status flips asynchronously

**Decision**: `POST /v1/projects/:ref/pause` calls existing `lifecycle-pause` worker enqueue, marks project status `paused` synchronously in control-plane DB, returns 200 with project response (status translated to `INACTIVE` via Decision 8). Same shape for `/restore` with status `provisioning` → `COMING_UP`. Caller polls `get_project` for `ACTIVE_HEALTHY` to know restore completed.

**Rationale**:
- Container shutdown/startup is slow (5-30s). Synchronously waiting blocks the MCP client.
- Existing lifecycle worker handles the actual container ops; we just enqueue.
- Status transitions follow the existing state machine; no new states needed.

**Alternatives considered**:
- Synchronous (block until containers settle) — bad latency; clients would time out for slow restores.
- Webhook callback — adds new infrastructure for no benefit (caller can just poll).

---

## Resolved NEEDS CLARIFICATION

All 5 questions from spec.md Session 2026-05-26 are addressed:

| Clarification | Resolution |
|---|---|
| Access-token TTL | 1h access + 30-day refresh (matches Cloud gotrue defaults) |
| JWT signing key | HKDF from master key, label `supastack-oauth-jwt-v1` (Decision 3) |
| Revocation propagation | Redis set keyed by `jti`, ≤100ms (Decision 4) |
| Client registration | DCR-only, no pre-registered allow-list (Decision 5) |
| MCP horizontal scalability | Single replica, in-process sessions (Decision 6) |

Plus implementation-specific choices documented above (upstream library reuse, separate compose service, dashboard-session-anchored authorize, status-enum translation, Logflare forwarding, storage reverse-proxy, async pause/restore).

Phase 0 complete. Proceeding to Phase 1 design.
