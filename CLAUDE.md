# Selfbase — CLAUDE project guide

Selfbase is a self-hosted, multi-project Supabase platform. It runs in a single Docker compose stack and lets one operator provision N isolated Supabase projects on a single VM — each with its own Postgres, Auth, Storage, Realtime, Edge Functions, Studio. Dashboard + CLI compatibility mirror Supabase Cloud closely enough that the upstream `supabase` CLI works against it for the workflows it supports.

## High-level architecture

| Layer | Containers | Purpose |
|---|---|---|
| **Control plane** | `db` (Postgres 16), `redis` (BullMQ + sessions), `api` (Fastify), `worker` (BullMQ), `web` (React SPA via Caddy), `caddy` (HTTPS + on-demand TLS + custom L4 build), `supavisor` (top-level multi-tenant Postgres pooler) | The selfbase platform itself |
| **Data plane (per-project)** | `db`, `auth`, `rest`, `storage`, `realtime`, `meta`, `functions`, `analytics`, `vector`, `imgproxy`, `studio`, `kong` — one set per project, namespaced `selfbase-<ref>-*` | Each Supabase project gets a full isolated stack |
| **Edge / TLS** | Wildcard `*.<apex>` cert (DNS-01) + per-project HTTP-01 cert for `db.<ref>.<apex>` | `<ref>.<apex>` for kong, `db.<ref>.<apex>:5432` for direct PG, `pooler.<apex>:6543` for pooled PG |

## Repo layout

```
apps/
  api/          Fastify backend — /api/v1/* (dashboard) + /v1/* (Supabase Management API compat)
  worker/       BullMQ workers — provision, lifecycle, backups, cert renewal, pooler reconciler
  web/          React SPA — dashboard, project pages, settings sidebar
  caddy/        Custom Caddy build (caddy-l4 module included)
infra/
  docker-compose.yml          Control-plane stack
  supabase-template/          Per-instance compose template + kong.yml
packages/
  db/           Drizzle schema + raw .sql migrations
  shared/       Zod schemas, RBAC matrix, logger, mgmt-api schemas
  crypto/       Master-key envelope encryption
  docker-control/  compose-template builder + ps/up/stop helpers
  backup-store/ Local-disk + S3 backup store abstraction
specs/          /speckit-{specify,plan,tasks,implement} feature specs (one per feature)
tests/          Integration + cli-e2e (shell scripts that exercise the live VM)
docs/           Operator runbooks + per-feature change docs
```

## What's shipped (closed issues + merged features)

| Issue / Feature | Doc | Key endpoints / behavior |
|---|---|---|
| **#2** — Wildcard cert via DNS-01 (feature 004) | [docs/wildcard-tls.md](docs/wildcard-tls.md) | Manual TXT-record DNS-01 in `/setup` wizard → single `*.<apex>` + `<apex>` cert. Renewal: dashboard alert at 30 days. No per-subdomain on-demand TLS anymore. |
| **#3** — Postgres public endpoint (feature 005) | [docs/changes/005-postgres-public-endpoint.md](docs/changes/005-postgres-public-endpoint.md) | `db.<ref>.<apex>:5432` direct (custom STARTTLS+SNI proxy in api container) + `pooler.<apex>:6543` (top-level Supavisor with TLS via wildcard cert). Per-project ACME cert via HTTP-01 for strict-TLS clients (`rustls`/`sqlx`/`supabase db diff`). |
| **#4** — Tier 1 Management API expansion (closed as parent) | [docs/changes/006-cli-mgmt-tier1.md](docs/changes/006-cli-mgmt-tier1.md) | Split into #10/#11/#12/#13/#14. US1 + US2 shipped. |
| **#15 (PR)** — `supabase gen types typescript` + `supabase migration list/repair/fetch` (feature 006 US1+US2) | [docs/changes/006-cli-mgmt-tier1.md](docs/changes/006-cli-mgmt-tier1.md) | `GET /v1/projects/<ref>/types/typescript` (forwards to per-instance pg-meta via kong); 3 migration endpoints with lazy `supabase_migrations` schema bootstrap |
| **#7 + #8 + #9** — Pooler resilience (feature 008) | [docs/pooler-resilience.md](docs/pooler-resilience.md) + [docs/changes/008-pooler-resilience.md](docs/changes/008-pooler-resilience.md) | Daily reconciler cron + 7-class drift classification + dashboard panel + PG password drift prevention/detection/recovery via reset endpoint + active probe |
| **#5** — Secrets management single-track via vault (feature 010) | [docs/changes/010-secrets-management.md](docs/changes/010-secrets-management.md) | All user secrets in per-project `vault.secrets`; dashboard CRUD at `/dashboard/project/<ref>/secrets`; Deno runtime patched to inject vault as `envVars` with 5s TTL cache → no functions-container restart on save; Studio `/functions/secrets` 302 → selfbase; auto-enabled in provision pipeline (dashboard re-enable button for backup-restore recovery). **Breaking change**: pre-existing `project_secrets` rows not migrated — re-enter post-deploy. |
| CLI device-code login (feature 011) | [docs/changes/011-cli-device-login.md](docs/changes/011-cli-device-login.md) | `supabase login` (no `--token`) works against selfbase via Cloud-style PKCE flow: new `/dashboard/cli/login` page auto-mints a PAT + AES-256-GCM-encrypts it with ECDH-P256 against the CLI's client pubkey + shows an 8-hex verification code; new unauthenticated `GET /platform/cli/login/:session_id?device_code=…` serves the encrypted bundle to the CLI for single-use retrieval. CLI-minted tokens tagged `source='cli'` in `api_tokens`; shown with a `cli` badge on `/settings/tokens`. ECDH + AES via Node 20 stdlib (no new deps). |
| **Hosted MCP + OAuth 2.1** (feature 014) | [docs/changes/014-mcp-http-oauth.md](docs/changes/014-mcp-http-oauth.md) | New service `selfbase-mcp` at `mcp.<apex>/mcp` + new OAuth 2.1 server in api at `/v1/oauth/{authorize,token,register}` + dashboard revoke page at `/settings/mcp-clients`. Operators paste one URL into Claude Code / Cursor / Windsurf, browser-authorize via existing dashboard session, get full multi-project MCP surface (execute_sql, list_tables, list_projects, deploy_edge_function, get_logs, list_storage_buckets, pause/restore_project, …). Wraps upstream `@supabase/mcp-server-supabase` (Apache 2.0) AS-IS. JWT signing via HKDF from master key (no new secret). Refresh-token rotation with RFC 6749 §10.4 reuse-detection. Redis-backed revocation list (SC-004 verified live: 189ms propagation). Dual-credential auth plugin accepts both legacy PATs and OAuth JWTs. 3 new mgmt API endpoints: `/analytics/endpoints/logs.all`, `/storage/buckets`, `/{pause,restore}`. |
| **#36** — `db query` + `db dump` Management API endpoints (feature 013) | [docs/changes/013-db-query-dump.md](docs/changes/013-db-query-dump.md) | `POST /v1/projects/<ref>/database/query` runs ad-hoc SQL (admin PAT, wire-compatible with upstream `V1RunQueryBody`); `POST /v1/projects/<ref>/database/dump` streams `pg_dump` output (chunked, bounded api memory). Unblocks `supabase db query --linked` + 3 MCP tools (`execute_sql`, `list_tables`, `apply_migration`) with no MCP-server fork. Multi-statement queries rejected at the api with 400; `read_only:true` enforced via `default_transaction_read_only=on`; full SQL text logged to audit. Statement timeout sourced from per-project PG GUC (no per-request override). New RBAC action `database.write`. |
| **#31** — CLI login-role / passwordless `db push` (feature 012) | [docs/changes/012-cli-login-role.md](docs/changes/012-cli-login-role.md) | `supabase db push` (and `db pull`, `db diff`, `migration list/fetch/repair`, `inspect db`) work against selfbase with only a PAT — no `--password`, no `SUPABASE_DB_PASSWORD`, no prompt. Two new endpoints on the same singular path: `POST /v1/projects/:ref/cli/login-role` idempotently provisions `cli_login_postgres` / `cli_login_supabase_read_only_user` (`NOINHERIT LOGIN IN ROLE <target>`) and rotates the password to 256-bit hex with `VALID UNTIL now() + 5min`; `DELETE` invalidates by setting `rolvaliduntil` to 1970-01-01. Legacy `--password` flow is fully back-compat (US2 regression-guarded via Pass A of `db-push.sh`). RBAC: new `database.create-login-role` action, admin-only. Rate limit: 30/min/PAT/project. Audit: structured `cli_login_role_rotated` log event. |

## What's in flight / spec'd but not yet shipped

| Branch | Status |
|---|---|
| `007-auto-cert-renewal` | Spec'd (issue #6) — Cloudflare DNS API auto-renewal. NOT implemented. |

## Open work (by priority)

| # | Title | Priority |
|---|---|---|
| #6 | Auto wildcard cert renewal via Cloudflare DNS API | normal |
| #5 | Research: Supabase org repos worth integrating | normal |
| #14 | `supabase backups list/restore` — async restore worker | normal (heavy) |
| #16 | Vitest unit tests for pooler-reconciler service | low |
| #10 | `supabase domains` (custom hostnames) | low |
| #11 | `supabase postgres-config` + `auth-config` tunables | low |
| #12 | `supabase ssl-enforcement` toggle | low |
| #13 | `supabase snippets list/download` (needs server-side store first) | low |

## Cross-cutting conventions

- **Migrations are idempotent.** Every `packages/db/migrations/*.sql` uses `IF NOT EXISTS` + `ADD CONSTRAINT IF NOT EXISTS` etc. Re-running the whole sequence must be a no-op.
- **Schema changes are additive** unless explicitly destructive. New columns are nullable + backfilled separately. New status enum values are added by dropping + recreating the CHECK constraint with the wider set.
- **Master key envelope encryption.** All per-instance secrets stored as `encryptedSecrets bytea` decrypted at use time via `decryptJson(buf, loadMasterKey())`. Master key never leaves the api container.
- **RBAC**: text matrix in `packages/shared/src/rbac.ts`. Actions enumerated; matrix is `admin × action → boolean`. Every new admin endpoint adds an action there + uses `app.authorize(req, '<action>')`.
- **Spec-driven dev** via `/speckit-{specify,clarify,plan,tasks,implement}` in `specs/<NNN-name>/`. Each feature gets spec.md, plan.md, research.md, data-model.md, contracts/*.md, quickstart.md, tasks.md. Implementation marks tasks `[X]`.
- **One BullMQ job per concern**, in `apps/worker/src/jobs/`. Repeatable jobs are added once at boot in `apps/worker/src/main.ts` with `repeat: { every: <ms> }` or `repeat: { pattern: '<cron>', tz: 'UTC' }`.
- **Per-instance state changes go through the worker**, never directly from the api (except synchronous admin actions like `reset-pg-password` that need immediate operator feedback).
- **Dashboard endpoints** under `/api/v1/*`. **Supabase Management API compatibility** under `/v1/*` (a separate Fastify mount with its own error envelope plugin).
- **Management API source of truth**: the upstream OpenAPI at **<https://api.supabase.com/api/v1-json>** is canonical for `/v1/*` endpoint paths, request/response shapes, and validation bounds. Pin a snapshot under the feature dir (`specs/<NNN>/upstream-openapi-snapshot.json`) so drift is caught by a contract test, not silently. Note also: the upstream `supabase` CLI surface evolves independently of the HTTP API — newer CLI versions (≥ v2.72) moved most config knobs from imperative flags (`config update --auth-jwt-expiry`) to declarative `supabase config push` reading `config.toml`. The HTTP endpoints remain the stable contract; the CLI is one client among several.
- **Tests** prefer pure functions where possible. Live VM E2E (shell scripts in `tests/cli-e2e/`) covers integration paths. Vitest unit tests cover security-sensitive bits (PAT generation, password escape).
- **`any` in tests is allowed by lint** (`@typescript-eslint/no-explicit-any` is scoped off for `**/tests/**` in `eslint.config.js`). The rule still applies to production code. Test mocks routinely need `as any` to satisfy typed callback signatures like `withPerInstancePg`'s; typing them adds maintenance surface without catching real bugs (tests fail loudly on bad mocks; prod `any` fails silently). Don't extend this posture to production code under any circumstance.

## VM deployment

Single production-ish VM at `ubuntu@148.113.1.164`, apex `supaviser.dev`. Compose lives at `/opt/selfbase/infra/docker-compose.yml`. Rsync source → `/opt/selfbase/` then `sudo docker compose build <service> && sudo docker compose up -d <service>`.

`pg-edge-proxy` (custom STARTTLS+SNI proxy in api) owns port 5432 on the host. Supavisor owns 6543. Caddy owns 80 + 443. All other per-instance ports are dynamically allocated from `port_allocations` (kong, studio, postgres, pooler, analytics, dbDirect).

## Active feature pointer

<!-- SPECKIT START -->
**Active feature plan**: feature 018 — T078 master key rotation (issue #54). Plan: [specs/018-t078-master-key-rotation/plan.md](specs/018-t078-master-key-rotation/plan.md). Re-key tool (`scripts/rekey-master.mjs`), E2E validation script, and operator runbook.

**Most recently merged**: feature 014 — hosted multi-project MCP + OAuth 2.1 authorization server (full spec at [specs/014-mcp-http-oauth/plan.md](specs/014-mcp-http-oauth/plan.md); operator runbook at [docs/changes/014-mcp-http-oauth.md](docs/changes/014-mcp-http-oauth.md)). Prior: feature 013 — `db query` + `db dump` Management API endpoints (closes #36, unblocks 3 MCP tools per #37).

**Other in-flight work**: feature 009 — runtime config tunables (`postgres-config` + `config --auth-*`) — issue #11. Plan: `specs/009-runtime-config-tunables/plan.md`. Implementation complete; locally tested; not yet deployed. Shape-vs-behavioral parity gap tracked separately as issue #21.

**Other open spec branches**: `007-auto-cert-renewal` (Cloudflare DNS API auto-renewal — issue #6, not yet implemented).
<!-- SPECKIT END -->

## userEmail
The user's email address is km.hariharasudhan@gmail.com.

## currentDate
Today's date is 2026-05-25.
