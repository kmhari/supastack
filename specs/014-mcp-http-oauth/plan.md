# Implementation Plan: Hosted multi-project MCP + OAuth 2.1

**Branch**: `014-mcp-http-oauth` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)

## Summary

A hosted multi-project MCP server at `mcp.<apex>/mcp` backed by an OAuth 2.1 authorization server built into the existing `apps/api` Fastify process. Operators paste one URL into any MCP client (Claude Code, Cursor, Windsurf, Claude Desktop), authorize in the browser using their existing dashboard session, and immediately drive their selfbase deployment through LLM tool calls — same UX as Cloud's `mcp.supabase.com/mcp`.

Implementation pivots on a key insight: **the upstream `@supabase/mcp-server-supabase` package (Apache 2.0) is the same code Cloud runs**, with a `SupabasePlatform` abstraction designed to swap underlying APIs. So the MCP-server side of this feature is ~150 LoC of Fastify glue around the upstream library. The OAuth 2.1 server is the bulk of new domain logic: authorize UI + token + DCR + discovery metadata, all signed via HKDF-derived JWTs and revoked via Redis.

Six in-scope MCP tools beyond the OAuth+host plumbing: `list_projects`/`get_project`/`list_organizations`/`get_organization` (read-only account, already implemented in `/v1`), `database` group (full, shipped in feature 013), `development` group (api-keys + types/typescript, shipped in features 003+006), `functions` group (shipped in feature 003), `docs` (search_docs — hits Supabase docs directly, no backend), plus three new `/v1/*` endpoints: `get_logs` (Logflare forward, US4), `list_storage_buckets` (storage container reverse-proxy, US5), and `pause_project`/`restore_project` (wire-up to existing lifecycle worker, US6).

## Technical Context

**Language/Version**: TypeScript on Node 20 (api + new mcp service)

**Primary Dependencies**:
- New: `@supabase/mcp-server-supabase@^0.8.1` (Apache 2.0 upstream MCP server library), `@modelcontextprotocol/sdk` (peer dep, for `StreamableHTTPServerTransport`)
- New shared workspace package `@selfbase/oauth` (under `packages/oauth/`): houses `oauth-jwt.ts` (HKDF sign/verify) + `oauth-revocation.ts` (Redis revocation check). Consumed by BOTH `apps/api` (auth plugin) AND `apps/mcp` (bearer-auth). Avoids cross-app source imports + duplicate-implementation drift. Per analysis remediation I1.
- Existing: Fastify (api + new mcp service), Drizzle ORM (control-plane DB: new tables `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens`, `oauth_revocations`)
- Existing: `ioredis` (already in api stack — reused for revocation list and the existing session store)

**Storage**:
- **Control-plane DB** (Drizzle migrations under `packages/db/migrations/`): 4 new tables — `oauth_clients`, `oauth_codes`, `oauth_refresh_tokens`, `oauth_revocations` (the last only used as a fallback/audit trail; the hot-path revocation check is Redis). `audit_log.action` extended with new values (no schema change required — unconstrained text).
- **Redis**: revocation set keyed by JWT `jti`, with TTL = remaining token lifetime. Reuses the existing api Redis instance.
- **Per-project Postgres / Logflare / Storage**: existing infra — we just add 3 new `/v1/*` reverse-proxy endpoints that authenticate against them on the operator's behalf.

**Testing**:
- Vitest unit + contract tests for: OAuth authorize/token/register handlers (route-level via `app.inject`), JWT signing helper, PKCE verification helper, Redis revocation helper, MCP service Bearer-token validation, the three new `/v1/*` reverse-proxy endpoints (mocked Logflare/storage clients).
- Live-VM shell scripts in `tests/cli-e2e/`: full OAuth-dance → MCP `list_projects` → MCP `execute_sql` round-trip; revocation propagation timing; MCP-client smoke against the deployed `mcp.supaviser.dev`.

**Target Platform**: Single Linux VM Docker compose stack (same as everything else). VM `ubuntu@148.113.1.164`, apex `supaviser.dev`.

**Project Type**: Web application monorepo — extends `apps/api`, adds new `apps/mcp` compose service. Dashboard adds `/settings/mcp-clients` page.

**Performance Goals**:
- OAuth token endpoint p95 < 200ms (DB write + JWT sign + Redis write)
- MCP request p95 < 100ms overhead on top of the underlying `/v1/*` call (Bearer validation + Redis revocation check + platform construct)
- Revocation propagation < 100ms (Redis-backed, per Clarifications Q3)
- MCP service memory: < 150 MiB p95 at 20 concurrent sessions (SC-009)

**Constraints**:
- Wire-shape lock: every OAuth endpoint MUST conform to RFC 6749 / RFC 7591 / RFC 8414 / RFC 9728 byte-for-byte so any MCP client auto-discovers and uses them without per-client configuration
- The existing PAT auth path MUST keep working without any regression — every `/v1/*` endpoint accepts both `sbp_…` PATs AND OAuth-issued JWTs as Bearer credentials
- Single-replica MCP service (Clarifications Q5); sessions in process memory
- HKDF signing key derivation labeled `selfbase-oauth-jwt-v1` (Clarifications Q2); no separate operator-managed secret
- The deferred MCP tool groups (`get_advisors`, `get_storage_config`/`update_storage_config`, `create_project`/`get_cost`/`confirm_cost`, all branching) MUST be omitted at platform-construction time so the LLM never sees them in `tools/list`

**Scale/Scope**:
- ~10s of operators per VM, ~10s of MCP sessions/day at peak
- ~10 MCP tools in v1 (mix of read-only account, full database, development, functions, docs, plus the three new in-scope ones)
- Single-VM session store + audit log; no horizontal scale work

## Constitution Check

*GATE: N/A — project constitution at `.specify/memory/constitution.md` is the unfilled template (no ratified principles, consistent with prior features 010/011/012/013).*

No constraints to gate against. Proceeding to Phase 0.

## Project Structure

### Documentation (this feature)

```text
specs/014-mcp-http-oauth/
├── plan.md              # This file
├── spec.md              # Feature spec (with Clarifications session 2026-05-26)
├── research.md          # Phase 0 output
├── data-model.md        # Phase 1 output
├── quickstart.md        # Phase 1 output
├── contracts/           # Phase 1 output
│   ├── oauth-authorize-endpoint.md
│   ├── oauth-token-endpoint.md
│   ├── oauth-register-endpoint.md
│   ├── oauth-discovery-endpoints.md
│   ├── mcp-http-endpoint.md
│   ├── logs-endpoint.md
│   ├── storage-buckets-endpoint.md
│   └── pause-restore-endpoints.md
├── checklists/
│   └── requirements.md  # From /speckit-specify (all items pass)
└── tasks.md             # (Phase 2 — /speckit-tasks)
```

### Source Code (repository root)

```text
apps/
  api/                                          # EXISTING — extended
    src/
      routes/
        oauth/                                  # NEW directory
          authorize.ts                          # NEW — GET /v1/oauth/authorize (browser-facing consent UI)
          token.ts                              # NEW — POST /v1/oauth/token (code + refresh exchange)
          register.ts                           # NEW — POST /v1/oauth/register (RFC 7591 DCR)
          discovery.ts                          # NEW — GET /.well-known/oauth-authorization-server
        management/
          logs.ts                               # NEW — GET /v1/projects/:ref/analytics/endpoints/logs.all (US4)
          storage-buckets.ts                    # NEW — GET /v1/projects/:ref/storage/buckets (US5)
          pause-restore.ts                      # NEW — POST /v1/projects/:ref/{pause,restore} (US6)
      services/
        oauth-pkce.ts                           # NEW — code_challenge / code_verifier helpers (pure functions)
        oauth-clients-store.ts                  # NEW — Drizzle accessors for oauth_clients
        oauth-codes-store.ts                    # NEW — Drizzle accessors for oauth_codes (single-use w/ TTL)
        oauth-refresh-store.ts                  # NEW — Drizzle accessors for oauth_refresh_tokens (rotating)
        logflare-client.ts                      # NEW — per-project analytics container forwarder (US4)
        storage-buckets-proxy.ts                # NEW — per-project storage container reverse-proxy (US5)
        service-role-jwt.ts                     # NEW — mint per-project service-role JWT (or reuse from credentials-reveal)
      plugins/
        auth.ts                                 # MODIFIED — accept both `sbp_…` PATs and OAuth JWT bearer (FR-010)
      server.ts                                 # MODIFIED — register OAuth routes + new mgmt routes
  mcp/                                          # NEW compose service
    Dockerfile                                  # NEW
    package.json                                # NEW — depends on @supabase/mcp-server-supabase + @modelcontextprotocol/sdk + fastify
    src/
      server.ts                                 # NEW — Fastify wrapper, mounts POST /mcp
      bearer-auth.ts                            # NEW — validate OAuth JWT + Redis revocation check
      platform-build.ts                         # NEW — build createSupabaseApiPlatform per-request, strip deferred groups
  web/                                          # EXISTING — extended
    src/pages/
      SettingsMcpClients.tsx                    # NEW — list authorized clients + revoke action (US3, FR-020)
      OAuthAuthorize.tsx                        # NEW — consent UI rendered by the authorize endpoint (FR-003)
infra/
  docker-compose.yml                            # MODIFIED — add selfbase-mcp service
  caddy/
    Caddyfile                                   # MODIFIED — add mcp.<apex> reverse proxy to selfbase-mcp:3002
packages/
  db/
    src/schema/oauth.ts                         # NEW — Drizzle schemas for the 4 OAuth tables
    migrations/0NNN-oauth-tables.sql            # NEW — idempotent CREATE TABLE IF NOT EXISTS + indices (NNN resolved at impl time by scanning existing migrations)
  shared/
    src/oauth-schemas.ts                        # NEW — Zod schemas for OAuth wire shapes (authorize/token/register requests + responses)
    src/rbac.ts                                 # (potentially MODIFIED if we add an `oauth.client.revoke` action — TBD in tasks)
  oauth/                                        # NEW workspace package — @selfbase/oauth
    package.json
    src/
      jwt.ts                                    # NEW — HKDF signing key derive + JWT sign/verify (consumed by api auth plugin + mcp bearer-auth)
      revocation.ts                             # NEW — Redis revocation set add/check by jti
      index.ts                                  # barrel re-exports
apps/worker/                                    # EXISTING — extended
  src/jobs/
    cleanup-oauth-codes.ts                      # NEW — 1-min interval DELETE expired oauth_codes (FR-024a)
    cleanup-oauth-refresh.ts                    # NEW — 1-hour interval DELETE 30-day-idle oauth_refresh_tokens (FR-024a)
  src/main.ts                                   # MODIFIED — register both repeatable jobs at boot
apps/api/tests/
  unit/
    oauth-jwt.test.ts                           # NEW — HKDF derivation determinism, sign/verify roundtrip, expired-token rejection
    oauth-pkce.test.ts                          # NEW — code_challenge S256 verification cases
    oauth-authorize.test.ts                    # NEW — route-level via app.inject
    oauth-token.test.ts                        # NEW
    oauth-register.test.ts                     # NEW
    oauth-revocation.test.ts                   # NEW — Redis fake
    logs.test.ts                               # NEW — logflare forwarder mocked
    storage-buckets.test.ts                    # NEW — storage proxy mocked
    pause-restore.test.ts                      # NEW — lifecycle worker enqueue mocked
    auth-plugin-dual.test.ts                   # NEW — PAT and OAuth JWT both accepted
  contract/
    oauth-discovery.contract.test.ts           # NEW — /.well-known/* shapes vs RFC 8414/9728
    oauth-pkce.contract.test.ts                # NEW — pinned against RFC 7636 test vectors
    rbac.test.ts                               # MODIFIED — snapshot may need a new action if we add oauth-related ones
apps/mcp/tests/
  unit/
    bearer-auth.test.ts                        # NEW
    platform-build.test.ts                     # NEW — verifies deferred-group stripping
    mcp-server.integration.test.ts             # NEW — in-process upstream MCP server roundtrip with a stub platform
tests/
  cli-e2e/
    oauth-dance.sh                             # NEW — headless-browser-driven OAuth flow against deployed VM
    mcp-roundtrip.sh                           # NEW — extends /tmp/mcp-smoke.mjs to use OAuth bearer instead of PAT
```

**Structure Decision**: Extends the selfbase monorepo with two main pieces: (1) a substantial set of new files under `apps/api/src/routes/oauth/` + `apps/api/src/services/oauth-*` for the OAuth 2.1 server (lives in the existing api process; reuses existing auth plugin, error envelope, audit logging), and (2) an entirely new `apps/mcp/` compose service that runs the upstream MCP library as an HTTP server. The new mgmt-API endpoints (`/v1/.../analytics/...`, `/v1/.../storage/buckets`, `/v1/.../pause`, `/v1/.../restore`) live under the existing `apps/api/src/routes/management/` to match the convention from features 003/006/013.

The MCP service is kept as a SEPARATE compose service (not embedded in api) for three reasons:
1. **Memory isolation** — upstream `@supabase/mcp-server-supabase` instantiates a per-session MCP server; 20 concurrent sessions could spike memory. Isolating from api prevents OOM cascade.
2. **Dependency isolation** — `@modelcontextprotocol/sdk` is a heavy peer dep; keeping it out of the api bundle reduces api startup time + image size.
3. **Independent deploy cadence** — upstream MCP server bumps frequently (new tool groups); separating lets us bump the MCP service without redeploying api.

## Complexity Tracking

*No constitution gates to violate. No exceptions to justify.*
