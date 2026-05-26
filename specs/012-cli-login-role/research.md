# Research — CLI login-role

**Feature**: 012-cli-login-role
**Date**: 2026-05-25

This document resolves the open architecture/implementation questions before contracts are written. Each decision is the result of either an upstream source-code reading, a Postgres-behaviour check, or a deliberate selfbase posture pick documented in the spec's Clarifications section.

---

## Decision 1 — Endpoint URL prefix: under `/v1/*`, not `/api/v1/*`

**Decision**: Mount the new routes inside the existing `/v1/*` Fastify scope at `apps/api/src/server.ts:191-217`.

**Rationale**: The upstream CLI's generated client hardcodes the path `/v1/projects/{ref}/cli/login-role` (verified at `/tmp/supabase-cli/packages/api/src/generated/contracts.ts:5873`). Any other prefix means the existing CLI binary cannot reach the endpoint without a forked release. The `/v1/*` Fastify scope already wraps responses in the cloud-compatible `{ message, code?, details? }` envelope via `mgmt-api-errors` — exactly what the CLI's error handler expects. The dashboard scope `/api/v1/*` uses a different envelope and would break the CLI even if the URL matched.

**Alternatives considered**:
- *Mount at `/api/v1/*` next to dashboard routes* — rejected, breaks upstream CLI binary.
- *New top-level scope `/cli/*`* — rejected, diverges from upstream URL contract.

---

## Decision 2 — Persistent role + password-rotation (NOT per-call ephemeral role)

**Decision**: Idempotently `CREATE ROLE` if absent on first call, then `ALTER ROLE … WITH PASSWORD … VALID UNTIL now() + 5 min` on every call. Two roles per project (write + read).

**Rationale**: This is the upstream implementation. Verified against PR #3885 (`feat: password-less database login`, merged 2025-07-21) and the current SQL template at `apps/cli-go/internal/utils/flags/queries/role.sql`:

```sql
do $func$
begin
  if not exists (select 1 from pg_roles where rolname = '{{ .User }}')
  then
    create role "{{ .User }}" noinherit login noreplication in role postgres;
  end if;
  execute format(
    $$alter role "{{ .User }}" with password '{{ .Password }}' valid until %L$$,
    now() + interval '5 minutes'
  );
end
$func$ language plpgsql;
```

Recorded in spec Clarifications Q2. This pattern obviates the reaper job, the role-name-entropy concern, and the per-call role accumulation that the original spec assumed.

**Alternatives considered**:
- *Ephemeral `cli_<random>` role per call + BullMQ reaper* — rejected as over-engineered; doesn't match Cloud; creates db log noise.
- *Grant `dashboard_user` directly to ephemeral role* — rejected; while `dashboard_user` exists on every per-instance Postgres, the upstream pattern uses `IN ROLE postgres` because that role already has the day-to-day owner privileges every CLI operation needs.

---

## Decision 3 — Privilege escalation via `IN ROLE postgres` + runtime `SET SESSION ROLE`

**Decision**:
- `cli_login_postgres` is created with `NOINHERIT LOGIN NOREPLICATION IN ROLE postgres`.
- `cli_login_supabase_read_only_user` is created with `NOINHERIT LOGIN NOREPLICATION IN ROLE supabase_read_only_user`.
- No explicit `GRANT`s on either role at the time of creation.
- Privilege escalation happens at runtime when the CLI connects: the upstream `internal/utils/connect.go:215-220` `AfterConnect` callback runs `SET SESSION ROLE postgres` (or `SET SESSION ROLE supabase_read_only_user`) automatically when the connecting username matches the `cli_login_` prefix.

**Rationale**: `NOINHERIT` means the role has zero privileges of its own and is only useful as an authentication shim. Without an explicit `SET ROLE`, the connection cannot do anything — defense in depth: if the CLI client forgot to set the session role, the connection would refuse every SQL command, which fails fast rather than escalating to a less-privileged operation by accident.

The `IN ROLE postgres` membership is what allows `SET ROLE postgres` to succeed; without it the SET would fail with `permission denied to set role "postgres"`.

**Postgres mechanics check**: The api container runs `withPerInstancePg` as the `postgres` superuser (decrypted from `secrets.postgresPassword`). The postgres role itself is a superuser and can `GRANT postgres TO <any_role>` freely (admin option implicit for superusers). Verified by reading `withPerInstancePg` at `apps/api/src/services/per-instance-pg.ts:71-78` — it explicitly connects as `user: 'postgres'` with the superuser password.

**Alternatives considered**:
- *Explicit `GRANT pg_read_all_data` on the read role + `GRANT ALL ... ` on the write role* — rejected; brittle (every new schema/table needs an update), diverges from upstream.
- *Make the CLI role itself superuser* — rejected; gives the runtime credential too much power and breaks read-only semantics.

---

## Decision 4 — Read-only role name: `cli_login_supabase_read_only_user`

**Decision**: Use the deterministic name `cli_login_supabase_read_only_user` for the read-only login role. The CLI's `SET SESSION ROLE` target then resolves to `supabase_read_only_user`.

**Rationale**: Symmetric with upstream's read-write name pattern (`cli_login_<owner_role>`). Cloud's actual name for the read-only role is not publicly documented, but the CLI's prefix-detection logic (`CLI_LOGIN_PREFIX = "cli_login_"` in `connect.go:201`) doesn't care about the suffix — it strips the prefix to determine the target role. So any name starting with `cli_login_` works.

Length: `cli_login_supabase_read_only_user` is 33 characters, well under Postgres's 63-character `NAMEDATALEN - 1` identifier limit.

**Alternatives considered**:
- *Short name `cli_login_readonly`* — rejected; the CLI's auto-`SET SESSION ROLE` would try to escalate to a role named `readonly` which doesn't exist on a Supabase Postgres.
- *No read-only role at all (only support `read_only: false`)* — rejected; loses the FR-004 defense-in-depth posture, makes the `read_only` request field a no-op which would be surprising for any CLI client that relies on it.

---

## Decision 5 — Password generation: 32 random bytes, hex-encoded (256 bits of entropy)

**Decision**: `crypto.randomBytes(32).toString('hex')` from Node 20 stdlib. 64-character output, 256 bits of entropy.

**Rationale**:
- Postgres SCRAM-SHA-256 client-side iterations make even short passwords expensive to brute-force, but 256 bits removes any debate.
- Hex encoding has no characters that need SQL escaping (no quotes, backslashes, whitespace, etc.), so the password value is inherently safe even under direct string substitution into the `ALTER ROLE … WITH PASSWORD '…'` clause. Implementation should still pass it through `pg.escapeLiteral` (or upstream's server-side `EXECUTE format(%L)` pattern) for defence in depth — see tasks T007 for the two acceptable approaches. Note that **Postgres `ALTER ROLE` is a utility statement and does not accept bind parameters** for the password value, so a `pg.Client.query('ALTER ROLE ... WITH PASSWORD $1', [pw])` would fail at runtime; the choice is between server-side `format()` or client-side escaping, not bind parameters.
- 64 chars × ~5 chars/sec typing speed = 13 seconds for a human to copy-paste — not a UX concern because the CLI never displays the password.
- Within the 5-minute TTL window, an attacker who can sustain 10⁶ login attempts/sec against `db.<ref>.<apex>:5432` (well above any realistic rate) would have explored 3 × 10⁸ passwords ≈ 2²⁸. Distance from 2²⁵⁶ is astronomical; effectively unguessable.

SC-005 acceptance criterion targets ≥128 bits; this provides 256.

**Alternatives considered**:
- *Base64 encoding instead of hex* — rejected; introduces `+`, `/`, `=` characters that need careful SQL escaping; no real entropy benefit.
- *Shorter password (16 bytes / 128 bits)* — meets the spec but no reason to leave bits on the table when the source already returns 32.
- *Use `pg_strong_random()` server-side* — rejected; couples password generation to the per-project Postgres, harder to unit-test, no security improvement (Node's `randomBytes` is the OS CSPRNG).

---

## Decision 6 — DELETE semantics: rotate `VALID UNTIL` to the past, do NOT `DROP ROLE`

**Decision**: `DELETE /v1/projects/:ref/cli/login-role` (singular path — same as POST, distinguished by HTTP method; the OpenAPI operationId is `v1-delete-login-roles` plural but the path itself is singular) runs `ALTER ROLE "cli_login_postgres" VALID UNTIL '1970-01-01'` and the same for `cli_login_supabase_read_only_user`. Response: `{ message: "ok" }` per upstream OpenAPI (schema `DeleteRolesResponse`).

**Rationale**:
- `DROP ROLE` fails if any connections are still authenticated with that role; we'd have to forcibly terminate sessions, which is heavy-handed and could disrupt an in-flight CLI operation that's legitimately still running.
- Setting `VALID UNTIL` to a past date causes Postgres to refuse new authentications immediately while letting already-open connections continue to their natural close. This is exactly the semantic operators expect from a "revoke" action: new logins are blocked, in-flight work is allowed to drain.
- Matches the spec's edge case for "operator wants to lock out CLI access mid-window" — the next CLI call rotates the password (which also re-extends `VALID UNTIL`), so the lockout is single-shot, not permanent. Permanent lockout requires either revoking the PAT or DROPping the role manually via psql.

**Alternatives considered**:
- *`DROP ROLE` with `pg_terminate_backend` first* — rejected; nukes in-flight work, breaks the principle of least disruption.
- *Set the password to a known-bad random value* — rejected; equivalent effect but less observable (operators inspecting `pg_roles` see no signal that the role was deliberately invalidated).
- *Return 404 on DELETE when the role doesn't exist yet* — rejected; idempotent DELETE is friendlier to scripted callers. We return 200 even if neither role exists.

---

## Decision 7 — Concurrency: `pg_advisory_xact_lock` keyed by `(project_ref, scope)` hash

**Decision**: Wrap the `ensure role exists + ALTER ROLE PASSWORD` SQL in a single transaction that begins with `SELECT pg_advisory_xact_lock(hashtext($1))` where `$1` is `${ref}:${scope}` (e.g., `aaaabbbbccccddddee:rw`). Lock auto-releases on COMMIT.

**Rationale**:
- Two concurrent endpoint calls for the same project + scope race on the `ALTER ROLE PASSWORD` — without serialisation, both writes succeed but only the latest one survives, and there's a small window where the role might briefly exist without a fresh `VALID UNTIL` (if call A finishes the CREATE before call B's transaction sees it).
- The advisory lock is held only for the duration of the create+alter transaction (typically <30ms), so callers experience at most a few ms of additional latency in the rare concurrent-call case.
- Per-project + per-scope locking means concurrent calls against different projects (or write vs read on the same project) don't block each other.

**Alternatives considered**:
- *No lock, accept the race* — rejected; while functionally correct (Postgres atomicity guarantees only one final password wins), it surfaces a confusing intermediate state where role existence and password validity could briefly disagree.
- *Application-level mutex in the api container* — rejected; doesn't work across api replicas if/when selfbase scales horizontally; PG advisory locks are correct at any scale.
- *Row-level lock on `pg_authid`* — rejected; not allowed (system catalogs can't be `FOR UPDATE`-locked from user SQL).

---

## Decision 8 — Rate limit: in-memory token bucket, single-VM only

**Decision**: New helper `tryConsume(key: string, limit: number, windowMs: number): boolean` backed by `Map<string, { count: number; windowStart: number }>`. Key is `${patId}:${projectRef}`. On HTTP request, before reaching the service layer, call `tryConsume(key, 30, 60_000)`; if false, respond 429 with `{ message: "rate limit exceeded", code: "rate_limited" }` (matches `packages/shared/src/errors.ts:54`'s existing shape). Bucket TTL keys after 10 minutes of inactivity to prevent unbounded memory growth.

**Rationale**:
- Selfbase's deploy model is single-VM (one api replica) — a process-local bucket is correct.
- The Fastify `@fastify/rate-limit` plugin exists and is well-tested, but its default keying strategy is per-IP, not per-PAT. The plugin can be configured to use a custom key function, but the additional dependency for what amounts to a 40-line helper isn't justified. We keep the dependency footprint small.
- 60-second sliding window with discrete count is simpler than true sliding-window-log and more than adequate at 30/min — the worst-case error vs an exact sliding window is one window's worth of slack (≤30 extra calls just after the window flips), which is harmless at this scale.
- If selfbase later scales to multiple api replicas, this helper is swapped for a Redis token bucket (`INCR + EXPIRE` pattern). The interface stays the same.

**Alternatives considered**:
- *`@fastify/rate-limit` plugin* — works but adds a dependency for marginal value.
- *Postgres-based bucket (UPDATE … WHERE count < 30)* — rejected; adds a control-plane DB write per endpoint call, no benefit.
- *No rate limit, rely on PAT auth alone* — rejected per spec Clarifications Q3.

---

## Decision 9 — Audit logging: pino structured event on `app.log.info`

**Decision**: After a successful rotation:

```ts
req.log.info(
  {
    event: 'cli_login_role_rotated',
    pat_id: req.user.tokenId,
    project_ref: ref,
    scope: readOnly ? 'read_only' : 'read_write',
    requester_ip: req.ip,
    role: roleName,
  },
  'cli login role rotated',
);
```

DELETE emits `event: 'cli_login_role_invalidated'` with the same shape minus `scope` (DELETE invalidates both roles).

**Rationale**:
- The api container already initialises Fastify's request logger with pino — `event` is the discriminator field operators use to filter (same pattern used elsewhere in selfbase, e.g., `event: 'cert_renewal_due'`).
- No new logger configuration; the existing log pipeline carries this to wherever operators already ship their logs (stdout → docker → operator's choice).
- Spec FR-013 ratifies this format.

**Alternatives considered**:
- *Insert into a new `cli_login_rotations` control-plane table* — rejected; growth-management story for what is essentially a transient operational event. Logs are the right home.
- *Skip logging entirely and rely on the request-line log* — rejected; the request-line log records the URL and status but not whether the rotation actually succeeded vs. failed in the service layer.

---

## Decision 10 — RBAC: new action `database.create-login-role`, admin only

**Decision**: Add `'database.create-login-role'` to the `ACTIONS` list in `packages/shared/src/rbac.ts`. Permission matrix: `admin: true, member: false`. Both endpoints (POST + DELETE) check this same action.

**Rationale**:
- The endpoint, by issuing a `cli_login_postgres` password, hands the caller `postgres`-owner privileges on the per-project DB. That is the same level of trust as `instance.pg-password.reset` (admin-only) — consistent posture.
- Members can read project metadata and deploy edge functions today, but cannot reset the PG password or alter the schema directly via Cloud's equivalent endpoint. Mirroring this means a member-tier PAT can't be used to mint write-capable DB creds, which is the right default.
- Spec Assumptions section permits a future follow-up that broadens read-only rotation to members. Out of scope here.

**Alternatives considered**:
- *Split into `database.create-login-role-rw` and `…-ro` from the start* — rejected; YAGNI, both are admin-only today.
- *Reuse `instance.pg-password.reset`* — rejected; that action's name doesn't describe what's happening here.

---

## Decision 11 — Pooler interaction: no selfbase-side change needed

**Decision**: Do nothing special on the selfbase pooler (top-level Supavisor at `pooler.<apex>:6543`) — let the upstream CLI's existing `initPoolerLogin` backoff/retry loop (`apps/cli-go/internal/utils/flags/db_url.go:198-209`) handle any sub-second propagation lag.

**Rationale**:
- Selfbase's top-level Supavisor authenticates against the per-project Postgres on-demand using credentials from its tenant configuration — it doesn't keep a per-role credential cache. When the CLI presents the rotated password, Supavisor forwards the SCRAM exchange to the underlying PG, which reads the freshly-written `pg_authid` row and authenticates successfully.
- Verified against Supavisor's pass-through model in the existing pooler-reconciler code path — there's no role-name allowlist or credential snapshot that would need invalidation.
- The CLI's `initPoolerLogin` does up to ~6 retry attempts with exponential backoff. Even if the SCRAM exchange races the password write by milliseconds, the retry covers it.

**Alternatives considered**:
- *Explicit cache-bust API on the pooler after each rotation* — rejected; the pooler doesn't have such a cache to bust.
- *Disable pooler use for `cli_login_*` roles, force direct PG* — rejected; breaks the CLI's existing fallback path on restrictive networks where direct PG isn't reachable.

---

## Decision 12 — Upstream OpenAPI pin: snapshot only the two paths + the two schemas we depend on

**Decision**: `contracts/upstream-openapi-snapshot.json` contains exactly **one path** (`/v1/projects/{ref}/cli/login-role` — both POST and DELETE methods live on this singular path) and three schemas (`CreateRoleBody`, `CreateRoleResponse`, `DeleteRolesResponse`). A small contract test reads this file at test-time and asserts the live `apps/api` route handler's response shape matches.

**Rationale**:
- Pinning the whole `api.supabase.com/api/v1-json` (≈3 MB) bloats the repo for no reason.
- A snapshot of just the relevant slice gives us a tight diffable target — when Cloud changes the contract, our contract test fails and forces a deliberate decision rather than silent drift.

**Alternatives considered**:
- *No snapshot, rely on the spec text* — rejected; would let upstream changes slip past our test suite.
- *Generate types from the snapshot* — overkill for a two-endpoint surface; the route handler can declare its types inline.

---

## Open items deliberately deferred to implementation

These were considered and intentionally NOT pinned in the spec/plan; the implementer makes the call:

1. **Whether to log the DELETE call's PAT id even when both roles were already invalidated** — implementer's choice; both behaviours are within spec FR-013's intent.
2. **The exact pino log level for failed rotations** (`warn` vs `error`) — implementer's choice based on existing api-container conventions.
3. **Whether the in-memory rate-limit bucket exposes a debug-only HTTP endpoint for operators to inspect** — out of scope; revisit only if operators ask.

---

## Cross-references

- Spec: [spec.md](./spec.md) — Clarifications Q1–Q4 record the upstream-verified TTL, role architecture, rate limit, and audit decisions.
- Issue: [#31](https://github.com/kmhari/selfbase/issues/31)
- Upstream artefacts: `supabase/cli` PR #3885; `apps/cli-go/internal/utils/flags/queries/role.sql`; `apps/cli-go/internal/utils/connect.go:200-220`; `apps/cli-go/internal/utils/flags/db_url.go:123-209`.
