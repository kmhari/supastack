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
| **#21 + #34** — Auth Providers dashboard + behavioral parity (feature 020) | [docs/changes/020-auth-providers.md](docs/changes/020-auth-providers.md) | New top-level `Authentication → Providers` sidebar group with a page mirroring Cloud's `/auth/providers`: 4 global toggles + Email/Phone toggle rows + 21 OAuth provider drawers (CommonFour / +URL / WorkOS-shape / Google / Apple / OIDC templates) + 3 disabled "Coming soon" placeholders (SAML #61, Web3 #72, Custom Providers #63). Pre-filled read-only Callback URL with Copy button. Non-blocking restart toast polls per-instance health for ~30s, flips to success/Retry. Backend promotes **144 auth-config fields** from `stored_only` to `honored` (24 → **169** of 234): 17 new OAuth providers + Slack OIDC + family extras (81), all 37 mailer subjects/templates/notifications, sessions/password/webauthn-rp/passkey/api/db/smtp-misc (19), rate limits (7). `GET /v1/projects/:ref/config/auth` gains a `_selfbase.fieldStatus` extension classifying every field as `honored` / `stored_only` (with `#NNN` reason) / `unsupported`. Snapshot-drift contract test + behavioral parity bash harness + coverage check guarantee no silent regression. Spawned follow-ups: #61 SAML, #62 captcha, #63 OAuth-server (unsupported), #64 hooks, #65 MFA, #66 SMS, #68 phone-settings page, #70 vault-migration, #71 mailer-templates page, #72 Web3, #73 secret-reveal. Supersedes feature 019. |
| **Dashboard browser-test harness** (feature 021) | [docs/changes/021-dashboard-browser-tests.md](docs/changes/021-dashboard-browser-tests.md) | Real-browser e2e harness for the dashboard. Motivated by feature 020's deploy gap: a sidebar entry shipped in source but failed to surface in the browser; vitest+jsdom + backend tests caught zero of the conditions. Adds Playwright (Chromium) under `apps/web/tests/e2e/`: admin-session + member-session + test-project fixtures, sidebar-nav spec catching the exact regression class, auth-providers spec covering Radix Sheet drawer interactions + RBAC + deep-link querystring (the assertions feature 020 deferred because of jsdom portal flakiness), per-page smokes generated from an `EXPECTED_PAGES` registry. Self-maintaining coverage floor via `apps/web/scripts/check-page-coverage.mjs` wired into `pnpm lint` — new dashboard pages fail CI until added to the registry. New `e2e` job in `.github/workflows/ci.yml` boots the stack with `SELFBASE_TEST_FAKE_DOCKER=1` (an env-gated boot hook in `apps/api/src/server.ts` installs a fake docker control so project creation skips real container provisioning), runs the suite, uploads screenshots + traces + logs as artifacts on failure, posts a PR comment with the run link. Secret redactor scrubs text artifacts (`sbp_*`, `Bearer *`, `sb_sid=*`) before upload — PNG screenshots pass through unchanged for v1. |

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
**Active feature plan**: feature 022 — URL Configuration page. Plan: [specs/022-url-configuration/plan.md](specs/022-url-configuration/plan.md). Spec: [specs/022-url-configuration/spec.md](specs/022-url-configuration/spec.md). Adds `/dashboard/project/:ref/auth/url-configuration` mirroring Cloud's page: Site URL section (single input + Save changes) + Redirect URLs section (allow-list, batch-add modal "Add new redirect URLs", per-entry trash). Dashboard-only — backend already honors both fields (env-field-mapper.ts:66-67 maps `site_url`→`SITE_URL`, `uri_allow_list`→`ADDITIONAL_REDIRECT_URLS`→`GOTRUE_URI_ALLOW_LIST`). Motivated by real bug surfaced 2026-05-28: GitHub OAuth from `localhost:8765` bounced back to project URL because allow-list had no UI entry path. Clarifications: modal dialog with batch-add (matches Cloud verbatim), refuse-empty Site URL but NO seeding (Site URL is operator's frontend app URL, not derivable), case-insensitive scheme+host dedup with byte-exact path, no migration for existing projects. 50-URL cap, admin-only writes, wildcard syntax (`*`, `**`, `?`) tolerated client-side. Reuses feature 020's `use-restart-toast` + feature 021's `EXPECTED_PAGES` registry + Playwright fixtures.

**Previously active**: feature 021 — Dashboard Browser-Level E2E Tests. Plan: [specs/021-dashboard-browser-tests/plan.md](specs/021-dashboard-browser-tests/plan.md). Runbook: [docs/changes/021-dashboard-browser-tests.md](docs/changes/021-dashboard-browser-tests.md). All code-writing tasks complete (24/34); 5 deferred tasks are manual smoke runs (need `pnpm dev` + chromium) + 1 PR-creation verification. Playwright harness, 4 spec files (sidebar-nav, auth-providers, page-smokes, plus existing placeholder rewrites pending), 2 fixtures (admin + member), `EXPECTED_PAGES` registry + coverage lint (21 dashboard pages classified), `e2e` job in `.github/workflows/ci.yml` with stack boot + artifact upload + PR comment. `SELFBASE_TEST_FAKE_DOCKER=1` boot hook in api/server.ts enables CI to provision test projects without real container stacks. Committed on branch `021-dashboard-browser-tests` (commits 0d32a53 + 85566a1); PR not yet opened.

**Most recently completed**: feature 020 — Auth Providers Dashboard + Behavioral Parity (closes #21, #34). Plan: [specs/020-auth-providers-dashboard/plan.md](specs/020-auth-providers-dashboard/plan.md). Runbook: [docs/changes/020-auth-providers.md](docs/changes/020-auth-providers.md). Implementation complete; live-VM verified on supaviser.dev (Smoke 1+2+3 PASS — Discord PATCH → env → container → OAuth 302 redirect). Honored auth-config field count: 24 → **167 of 234** (sessions_timebox + sessions_inactivity_timeout demoted to stored_only pending #77 env_file rework). Two bugs found + fixed during deploy: `docker restart` doesn't reload env_file (added `composeUpService`); 5s healthcheck timeout too short for GoTrue restart (bumped to 60s).

**Spun-out follow-ups (alpha-public-release milestone)**: backend — #61 SAML, #62 captcha, #63 custom OAuth server, #64 hooks, #65 MFA, #66 SMS providers. Dashboard — #68 Phone Settings page, #71 Email Templates page, #72 Web3 Wallet, #70 vault-migrate provider secrets.

**Supersedes**: feature 019 (auth-config behavioral parity standalone) — folded into US3+US4 of this combined spec because #21's OAuth promotions are a hard prerequisite for #34.

**Most recently merged**: feature 018 — T078 master key rotation (issue #54, PR #59); rekey tool + E2E script + runbook; PASS in 50s on supaviser.dev. Prior: feature 016 — MCP post-ship hardening (issues #50–#53).

**Other in-flight work**: feature 009 — runtime config tunables (`postgres-config` + `config --auth-*`) — issue #11. Plan: `specs/009-runtime-config-tunables/plan.md`. Implementation complete; locally tested; not yet deployed.

**Other open spec branches**: `007-auto-cert-renewal` (Cloudflare DNS API auto-renewal — issue #6, not yet implemented).
<!-- SPECKIT END -->

## userEmail
The user's email address is km.hariharasudhan@gmail.com.

## currentDate
Today's date is 2026-05-25.
