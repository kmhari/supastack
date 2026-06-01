# Implementation Plan: CLI login-role — passwordless `supabase db push`

**Branch**: `012-cli-login-role` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)

## Summary

Add two endpoints on supastack's Management API surface that the upstream `supabase` CLI already speaks against Cloud:

- `POST /v1/projects/:ref/cli/login-role` — body `{ read_only: boolean }`, response `{ role, password, ttl_seconds: 300 }`. Idempotently provisions a deterministic-name Postgres role on the per-project DB (`cli_login_postgres` for write, `cli_login_supabase_read_only_user` for read), rotates its password to a fresh 256-bit random value with `VALID UNTIL now() + 5 minutes`, and returns role + password to the caller. The CLI's existing `SET SESSION ROLE` post-connect handler (auto-triggered when username matches the `cli_login_` prefix) then escalates the connection to the appropriate target role (`postgres` for write, `supabase_read_only_user` for read). Result: `supabase db push`, `db pull`, `db diff`, `migration list/fetch/repair`, `inspect db` all work against supastack with only a PAT — no `--password` flag, no `SUPABASE_DB_PASSWORD` env var, no interactive prompt.

- `DELETE /v1/projects/:ref/cli/login-role` — body none, response `{ message: "ok" }`. Same path as POST, distinguished by HTTP method (verified against `api.supabase.com/api/v1-json`). Sets `VALID UNTIL '1970-01-01'` on both CLI roles so any active password becomes immediately unusable. Used by well-behaved CLI exit paths and by operators who want to lock out CLI access mid-window.

Auxiliary work: new RBAC action `database.create-login-role` (admins only, matches who can reset the per-project PG password today); in-memory rate-limit (30 calls/min/PAT/project) on the create endpoint returning HTTP 429 with the same envelope CLI already understands; structured audit log event (`cli_login_role_rotated`) on every successful rotation; restructure `tests/cli-e2e/db-push.sh` into a dual-pass harness (Pass A keeps `--password` on every command for regression guard, Pass B drops all DB-password input to exercise the new path).

## Technical Context

**Language/Version**: TypeScript on Node 20 (api), pure SQL emitted to per-project Postgres 16 (unaffected — using existing `pg` client via `per-instance-pg.ts`)

**Primary Dependencies**: Fastify (existing), `pg` (existing — accessed via `@supastack/db`'s symlinked node_modules), Drizzle ORM (control-plane DB schema — but **no new tables** added by this feature), `@supastack/crypto` (existing — for `loadMasterKey`/`decryptJson` to access per-instance superuser password through `withPerInstancePg`), `@supastack/shared` rbac matrix (adding one new action), Vitest (tests). No new npm dependencies required — Node 20 `node:crypto.randomBytes` provides password entropy, in-memory `Map<string, {count, windowStart}>` provides the rate-limit bucket.

**Storage**:
- **Per-project Postgres** — two new persistent roles per project (`cli_login_postgres` and `cli_login_supabase_read_only_user`), created on first endpoint call, never dropped during normal operation. The roles' password column (`rolpassword` in `pg_authid`) and `rolvaliduntil` are rewritten on each successful endpoint call.
- **Control-plane Postgres** — **no schema change**. Per spec FR-008 the source of truth for the CLI role state lives in `pg_authid` on the per-project DB, not in the control plane. RBAC additions are runtime matrix edits in `packages/shared/src/rbac.ts`, no migration.
- **In-process memory** (the api container's heap) — rate-limit token bucket keyed by `${patId}:${projectRef}`, sliding 60-second window. Single-VM deployment model means this is sufficient; if/when supastack ever runs multiple api replicas the bucket migrates to Redis (out of scope for this feature).

**Testing**: Vitest unit tests for the password-generator + the rate-limit bucket (both pure functions, easy to test in isolation). Vitest integration tests for the route handlers under `apps/api/tests/integration/management-api/` (matches the convention used by all 16 existing mgmt-api integration tests — see `secrets-list.test.ts`, `runtime-config-not-501.test.ts`, `openapi-conformance.test.ts` for the established pattern). New `tests/cli-e2e/login-role.sh` shell script driving a live VM: validates create/delete endpoints + TTL expiry (sleep + reconnect with stale password to confirm 28P01) + read-only enforcement (CREATE TABLE rejected with 42501). The existing `tests/cli-e2e/db-push.sh` is restructured into the dual-pass harness called out in spec FR-011 — Pass A `WITH_PASSWORD=1`, Pass B `WITH_PASSWORD=0`. Both passes run sequentially in CI; either failing fails the job.

**Target Platform**: Same as the rest of supastack — single VM Docker compose. VM: `ubuntu@148.113.1.164`, apex `supaviser.dev`. The api container runs on the control-plane network and reaches each per-project Postgres via `host.docker.internal:<port_db_direct>` (existing `withPerInstancePg` connection path).

**Project Type**: Web application monorepo — extends existing `apps/api`, `packages/shared`. No `apps/web` work (per SC-006 no new dashboard UI). No `apps/worker` work (per spec FR-008 no scheduled reaper needed).

**Performance Goals**:
- Endpoint latency: ≤200ms p95 for `POST .../cli/login-role` end-to-end (PAT auth + RBAC check + ephemeral `pg.Client` open + idempotent role-ensure + ALTER ROLE + log emit + close). Budget: PAT lookup ≤5ms (already cached), RBAC ≤1ms (in-memory matrix), `pg.Client` connect ≤80ms (TCP + SCRAM handshake on local docker bridge), two SQL statements ≤30ms each, total ≤200ms. Will instrument with the existing pino request log to confirm in canary.
- Per-project Postgres impact: each call rewrites two rows of `pg_authid`. Negligible vs the existing query traffic the DB handles.

**Constraints**:
- Wire contract is **upstream-CLI dictated** — request body `{ read_only: boolean }`, response body `{ role, password, ttl_seconds: 300 }`, OAuth scope `database:write`, error shape `{ message, code?, details? }` (supastack's existing mgmt-api envelope). Reject any deviation.
- The 5-minute TTL is **hardcoded** in this feature (matches upstream `interval '5 minutes'`); not operator-configurable. Future tunability is out of scope; if Cloud ever exposes it as a setting we'll mirror.
- Role-name pair is **hardcoded** in this feature (`cli_login_postgres` / `cli_login_supabase_read_only_user`); not operator-configurable. Upstream's prefix constant `CLI_LOGIN_PREFIX = "cli_login_"` is the contract.
- The new endpoints are mounted inside the existing `/v1/*` Fastify scope so they get the `mgmt-api-errors` envelope automatically — must NOT be mounted at the dashboard `/api/v1/*` scope.
- Idempotency: two concurrent calls for the same (PAT, project, scope) MUST both succeed without deadlocking the per-project Postgres. Use `pg_advisory_xact_lock` keyed by hash of `(project_ref, scope)` to serialise the role-ensure + ALTER ROLE transaction; both calls return successfully, second-written password wins (matches the documented edge case from the spec).
- Audit log line format: structured pino at info level, `event: "cli_login_role_rotated"` field is the discriminator operators grep on; other fields per spec FR-013.

**Scale/Scope**:
- Endpoint volume: bounded by the spec'd rate limit (30/min/PAT/project) × small operator counts (≤10/org typical) × small project counts (≤20/org typical for a self-hosted deploy). Expected steady-state: <100 calls/hour on a busy deployment.
- Source files touched: 1 new route file, 1 new service file, 1 modified shared rbac.ts (one new action), 1 modified e2e shell script, 1 modified docs file, 1 modified server.ts (route registration). Net ~600 lines added.

## Constitution Check

*GATE: N/A — project constitution at `.specify/memory/constitution.md` is the unfilled template (no ratified principles, same as features 003–011). Vacuous pass.*

## Project Structure

### Documentation (this feature)

```text
specs/012-cli-login-role/
├── plan.md              # This file
├── research.md          # Phase 0 — design decisions resolved before contracts
├── data-model.md        # Phase 1 — entities (per-project PG roles, in-memory rate-limit bucket)
├── quickstart.md        # Phase 1 — operator runbook + verification commands
├── contracts/
│   ├── cli-login-role-create.md        # POST endpoint shape + acceptance
│   ├── cli-login-role-delete.md        # DELETE endpoint shape + acceptance
│   └── upstream-openapi-snapshot.json  # Pinned subset of api.supabase.com/api/v1-json
├── checklists/
│   └── requirements.md  # From /speckit-specify, validated post-clarify
└── tasks.md             # Phase 2 — generated by /speckit-tasks (NOT created here)
```

### Source Code (repository root)

```text
apps/api/src/
├── routes/management/
│   └── cli-login-role.ts          # NEW — POST + DELETE handlers; mounted inside /v1/* scope
├── services/
│   └── cli-login-role-service.ts  # NEW — password-rotation logic; calls withPerInstancePg; emits audit log
└── server.ts                      # MODIFIED — register cliLoginRoleRoutes in /v1 scope (alongside migrationsRoutes etc.)

packages/shared/src/
└── rbac.ts                        # MODIFIED — add 'database.create-login-role' action; permit admin only

apps/api/tests/
├── integration/management-api/
│   ├── cli-login-role.test.ts          # NEW — vitest, mocked withPerInstancePg, covers create + delete + rate-limit
│   └── cli-login-role-contract.test.ts # NEW — vitest, asserts handler matches contracts/upstream-openapi-snapshot.json
└── unit/
    ├── cli-login-role-password.test.ts # NEW — vitest, password entropy + format
    └── cli-login-role-bucket.test.ts   # NEW — vitest, token-bucket window semantics

tests/cli-e2e/
├── db-push.sh                      # MODIFIED — dual-pass harness (Pass A with --password, Pass B without)
└── login-role.sh                   # NEW — TTL expiry + read-only enforcement against live VM

docs/changes/
└── 012-cli-login-role.md          # NEW — operator-facing change doc per spec FR-012

CLAUDE.md                          # MODIFIED — bump active feature pointer + shipped table (after merge)
```

**Structure Decision**: Lightweight extension of the existing `/v1/*` Management API surface, mirroring the shape feature 006 (gen types + migrations) already established. No new packages, no dashboard work, no worker work. The service layer (`cli-login-role-service.ts`) consumes the existing `withPerInstancePg` helper — same pattern as `migrations-service.ts` — so the connection lifecycle and error mapping (`InstanceNotFoundError` → 404, `InstanceNotRunningError` → 409, `PerInstancePgConnectError` → 502) are inherited unchanged.

## Complexity Tracking

> Constitution Check passed vacuously; no violations to justify.

| Violation | Why Needed | Simpler Alternative Rejected Because |
|-----------|------------|-------------------------------------|
| (none) | | |
