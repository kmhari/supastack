# Research — Feature 116 (Admin Ops Console + Docs)

## R1. Admin authentication & "installation-wide admin" role

**Decision**: Reuse the existing GoTrue dashboard session. `/admin` pages render behind an `AdminGuard` that calls the existing `authApi.me` (via `auth-context`); the **server** re-checks on every admin data request via a new RBAC action gated with `app.authorize(req, 'admin.console.read')`. "Installation-level admin" = a user whose resolved **global** role is `owner` or `administrator`.

**Rationale**: `apps/api/src/plugins/auth.ts` already resolves a transitional global role = the highest role the user holds across any organization (`resolveRole`). `rbac.ts` is `role → Action[]` (`GRANTS`), so an `admin.console.read` action granted to `owner`/`administrator` cleanly expresses installation-wide read without org scoping. The web app already has `auth-context.tsx` (`login`/`me`/`role: 'admin'|'member'`) and the session is the GoTrue cookie/bearer — no new login UI.

**Alternatives**: (a) dedicated `/admin` login — rejected, duplicates GoTrue + more surface; (b) org-scoped admin — rejected by clarify (installation-wide chosen).

## R2. Resource collection mechanism

**Decision**: A new repeatable BullMQ job in the **worker** (`observer.ts`), added at boot in `apps/worker/src/main.ts` with `repeat: { every: OBSERVER_INTERVAL_MS }` (default 60s). Each tick: `docker stats --no-stream` (CPU%/mem per container) aggregated per project (`supastack-<ref>-*`) + host totals; `df`/`du` on `/var/supastack/{instances,backups}` for the disk breakdown. Rows written to `resource_samples`. A prune step deletes samples older than `OBSERVER_RETENTION_DAYS` (default 7).

**Rationale**: `infra/docker-compose.yml:233-236` already mounts `/var/run/docker.sock` + `/var/supastack/{instances,backups}` into the worker. Constitution V puts host/docker ops in the worker. Matches the existing `pooler-reconciler`/`backup-scheduler`/`health-reconciler` repeatable-job pattern.

**Alternatives**: (a) on-demand `docker stats` from the api per page load — rejected (heavy per request, no history, requires socket on api); (b) external metrics agent (cAdvisor/Prometheus) — rejected (new dependency + infra for a single-VM console).

## R3. Control-plane health & logs

**Decision**: The same worker observer tick captures, for the control-plane containers (`supastack-{api,worker,redis,db,caddy,supavisor,mcp,web}-1`): `docker inspect` health + image/version, and `docker logs --tail N` (default 200). It **upserts** one `control_plane_snapshots` row per container (latest-only). The api reads these rows; **per-project** service logs continue to use the existing api→Kong→`logs.all` proxy (on-demand, fresh). Secret-bearing patterns in captured api/worker log tails are redacted (shared `job-redactor`) before persistence.

**Rationale**: The api has **no** docker socket (confirmed: no `docker.sock` in its compose service). Per-project vector routes only that project's containers (feature 116 fix earlier) — control-plane containers ship to no Logflare. Reading them requires docker; confining that to the worker avoids granting the api a root-equivalent socket beside the master key (Constitution II spirit).

**Tradeoff**: control-plane health/logs are ~60s stale (tick cadence). Accepted — spec scopes logs to "recent, not live tail." Per-project logs remain fresh.

**Alternatives**: (a) read-only docker socket on the api with a container-name allowlist — rejected (a `:ro` socket mount still exposes the full docker API = privilege expansion); (b) a control-plane vector→Logflare — rejected (new infra for low marginal value).

## R4. Background-job / queue inspection + redaction

**Decision**: A new read endpoint iterates the shared `QUEUES` constant (`packages/shared/src/queues.ts`), constructing a read-only BullMQ `Queue` per name and calling `getJobCounts()` (waiting/active/failed/delayed/completed) + `getFailed(0, N)`. Per failed job: expose `id`, `name`, `failedReason`, `finishedOn`/`timestamp`, `attemptsMade` — **never** `job.data`. A shared `redactJobReason()` masks secret-bearing substrings (e.g. `postgres://…`, `sbp_…`, `Bearer …`, `password=…`) in `failedReason`.

**Rationale**: BullMQ exposes counts + failed jobs natively; the api already constructs `Queue` instances against `QUEUES.*`. Redaction satisfies FR-022 + Constitution II.

**Alternatives**: show `job.data` payloads — rejected (secret exposure). Counts-only — rejected (loses diagnostic value the operator needs for stuck jobs).

## R5. Cert / DNS / backup data sources

**Decision**: Read existing tables/services — `wildcard_certs.not_after` (expiry → days-left; renewal warning within 30d), `pg_edge_certs` (per-project), DNS readiness via the apex/ACME `allDnsReady` signal (feature 087), and the backups store + `du` on `/var/supastack/backups` (from the observer's host disk breakdown) for per-project last-backup + total storage. All read-only.

**Rationale**: This data already exists (`packages/db/src/schema/tls.ts`, `pg-edge-certs.ts`, `apex.ts`, backups endpoints). No new collection except backup disk totals, which the observer already produces.

## R6. Docs personalization & shell

**Decision**: `/docs/*` pages fetch the apex via the existing `apexApi.status()` (public `GET /apex`) and pass it to a pure `buildSnippets(apex)` helper. The CLI guide reuses the existing `getWrapperSnippet(apex)` from `apps/web/src/lib/cli-wrapper.ts`. The MCP guide renders per-editor JSON (Claude Code, Cursor, Windsurf, Claude Desktop) from a static map + the apex. When apex is null, snippets show `<your-apex>` + a finish-setup hint. A shared `AppShell` (header + nav + theme) wraps `/setup`, `/docs`, `/admin`; `/docs` adds a sidebar (`DocsLayout`).

**Rationale**: The wrapper + apex plumbing already exist; the docs are mostly assembly + personalization. The shell is the reusable foundation for the future Actions slice.

## R7. Routing & setup-gate

**Decision**: Add `/docs*` and `/admin*` → `web:80` routes in both `apps/caddy/Caddyfile` (boot) and `apps/api/src/services/caddy-config.ts` `dashboardSubroutes` (runtime VM source of truth), placed **before** the setup-gate catch-all so both are always reachable (like `/setup*`). `/admin` is additionally guarded client-side + server-side; pre-setup it simply shows empty/placeholder data.

**Rationale**: `/docs` and `/admin` are currently unrouted (fall to the studio catch-all). Missing the runtime `caddy-config.ts` is the exact bug class that bit feature 086 — both files must change.
