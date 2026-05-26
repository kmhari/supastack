# Feature 012 — CLI login-role (passwordless `supabase db push`)

**Spec**: [specs/012-cli-login-role/spec.md](../../specs/012-cli-login-role/spec.md)
**Closes**: [issue #31](https://github.com/kmhari/selfbase/issues/31) — every `supabase` CLI command that touches per-project Postgres directly needed `--password` against selfbase, but ran password-less against Cloud.

## What changed

`supabase db push` (and `db pull`, `db diff`, `migration list`, `migration fetch`, `migration repair`, `inspect db`, `db dump`) now work against selfbase with **only** a PAT — no `--password` flag, no `SUPABASE_DB_PASSWORD` env var, no interactive prompt — exactly like they work against Supabase Cloud.

Operators who have always passed `--password "$PW"` lose nothing — the legacy path continues to work byte-identically (US2 regression guard, `tests/cli-e2e/db-push.sh` Pass A).

## How it works (the new automatic flow as the default)

When the upstream CLI's password-resolution path (`apps/cli-go/internal/utils/flags/db_url.go:123-180`) sees no `--password` flag and no `SUPABASE_DB_PASSWORD` env var, it calls:

```
POST /v1/projects/<ref>/cli/login-role
Authorization: Bearer <PAT>
Content-Type: application/json

{ "read_only": false }
```

Selfbase responds with:

```json
{
  "role": "cli_login_postgres",
  "password": "<64-char hex>",
  "ttl_seconds": 300
}
```

The CLI then opens a Postgres connection as `cli_login_postgres` with that password. Because the connecting username starts with `cli_login_`, the CLI's `AfterConnect` callback (`apps/cli-go/internal/utils/connect.go:215-220`) automatically runs `SET SESSION ROLE postgres` post-connect — privilege escalation happens at runtime, not at role-creation time.

Server-side, every call runs (idempotently) the SQL pattern matching upstream's [`role.sql`](https://github.com/supabase/cli/pull/3885/files) byte-for-byte:

```sql
DO $func$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_login_postgres') THEN
    CREATE ROLE "cli_login_postgres" NOINHERIT LOGIN NOREPLICATION IN ROLE postgres;
  END IF;
  EXECUTE format(
    'ALTER ROLE %I WITH PASSWORD %L VALID UNTIL %L',
    'cli_login_postgres',
    '<new random password>',
    (now() + interval '5 minutes')::text
  );
END
$func$ LANGUAGE plpgsql;
```

The **role is persistent** — created once, reused forever. Only the **password rotates**. Postgres itself refuses authentication after `VALID UNTIL` elapses (no background reaper needed; the `pg_authid` row carries the security boundary).

### Per-role `search_path` parity with `postgres`

Each rotation also emits, inside the same transaction:

```sql
ALTER ROLE "cli_login_postgres" SET search_path TO "$user", public, extensions;
```

This mirrors upstream `supabase/postgres` exactly — see [`migrations/db/init-scripts/00000000000003-post-setup.sql`](https://github.com/supabase/postgres/blob/develop/migrations/db/init-scripts/00000000000003-post-setup.sql), which pins the same per-role `search_path` GUC on the `postgres` role at image build time.

Why it's required: per-role `search_path` is stored in `pg_db_role_setting` and is applied **at login time only** — the CLI's `SET SESSION ROLE postgres` (run in `AfterConnect`) swaps privileges but does **not** re-apply login-role GUCs. Since the session connects as `cli_login_postgres`, that role's own `pg_db_role_setting` governs `search_path`. Without this `ALTER ROLE`, the very first migration that calls unqualified `uuid_generate_v4()` (the `uuid-ossp` extension lives in the `extensions` schema in every Supabase project) fails with `function uuid_generate_v4() does not exist` even though the extension is installed.

Statement is unconditional and idempotent — runs on every rotation so roles provisioned before this fix get patched on next `db push`.

### Read-only path — currently deferred

POST with `{ "read_only": true }` returns **501 `not_implemented`** in this release. Two structural blockers prevent a clean implementation right now:

1. **`supautils` reserves membership in `supabase_read_only_user`.** Verified at deploy-time: `SHOW supautils.reserved_memberships` includes `supabase_read_only_user`. Only the true superuser (`supabase_admin`) can grant it, but the api container connects as the `postgres` role (which is itself subject to supautils). So `CREATE ROLE … IN ROLE supabase_read_only_user` fails with SQLSTATE 42501.

2. **The upstream CLI's `AfterConnect` callback hardcodes `SET SESSION ROLE postgres`** whenever the username starts with `cli_login_` (constant `SET_SESSION_ROLE` in `apps/cli-go/internal/utils/connect.go:202`). So even if we minted an RO-named login role and bypassed the supautils block, the CLI would immediately escalate to `postgres` at session start — defeating the read-only intent.

The upstream `supabase` CLI hardcodes `ReadOnly: false` in its own `initLoginRole` call (verified at `apps/cli-go/internal/utils/flags/db_url.go:170`); no normal CLI invocation hits the RO path, so this deferral has zero impact on the primary `db push` / `db pull` / `db diff` / `migration list` UX.

A future implementation will need either (a) the api container to connect as `supabase_admin` for this specific operation (requires a second per-instance secret + a per-call connection swap), or (b) a CLI fork that respects the response scope. Not in scope for this PR.

## Precedence rules

The CLI's password resolution (unchanged by selfbase) is:

```
explicit --password  →  $SUPABASE_DB_PASSWORD  →  POST /cli/login-role  →  interactive prompt
```

- **Operator passes `--password "$PW"`** → uses the long-lived per-project superuser password; the new endpoint is **not** called; no `cli_login_*` role is provisioned as a side effect.
- **`SUPABASE_DB_PASSWORD` is set** → same as above, the env var feeds the same code path.
- **Neither flag nor env** → CLI calls the new endpoint; gets a 5-minute password; uses it.

The legacy path is therefore fully back-compatible: every existing CI pipeline keeps working without modification.

## Operator levers

### Lock out CLI access mid-window

```bash
curl -X DELETE \
  "https://api.${APEX}/v1/projects/${REF}/cli/login-role" \
  -H "Authorization: Bearer ${SELFBASE_PAT}"
# → 200 {"message":"ok"}
```

Invalidates the active password on both CLI roles immediately (sets `rolvaliduntil` to `1970-01-01`). New SCRAM exchanges are refused with SQLSTATE 28P01. Already-authenticated connections survive until they close naturally — Postgres does not retroactively terminate sessions on `VALID UNTIL` change.

The lockdown is **single-shot**: the next POST from any PAT re-rotates the password to a fresh valid value. For a permanent lockdown, revoke the operator's PAT at `/dashboard/settings/tokens` (no PAT → no successful POST → no usable password).

### Emergency: manually drop the role

If the CLI role itself becomes problematic, connect as the per-project superuser:

```bash
PGPASSWORD="${SELFBASE_DB_SUPERUSER_PASSWORD}" psql \
  "postgresql://postgres@db.${REF}.${APEX}:5432/postgres" <<'SQL'
DROP ROLE IF EXISTS cli_login_postgres;
DROP ROLE IF EXISTS cli_login_supabase_read_only_user;
SQL
```

The next CLI call recreates the dropped role(s) idempotently — no operator-side state needs clearing.

### Audit query: who rotated CLI access recently

Every successful rotation emits a structured pino log line:

```json
{
  "event": "cli_login_role_rotated",
  "pat_id": "<uuid>",
  "project_ref": "<20-char ref>",
  "scope": "read_write",
  "requester_ip": "203.0.113.42",
  "role": "cli_login_postgres"
}
```

DELETE emits `event: cli_login_role_invalidated` with the same fields minus `scope`. Operators query this through whatever log pipeline they already use; no new dashboard surface, no new control-plane table.

## Security posture trade-off

| Aspect                            | Legacy `--password` flow                                                                                     | New endpoint flow                                                                                   |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------- |
| Credential lifetime               | Long-lived per-project superuser password (rotated only on operator demand via `instance.pg-password.reset`) | 5 minutes per call; new password every call                                                         |
| Stored on operator machine        | Yes — in shell history, `~/.bashrc`, CI secrets, etc.                                                        | No — CLI never persists the rotated password                                                        |
| Privilege envelope                | Full superuser (`postgres` role, all DDL + all data)                                                         | Postgres-owner level (via `SET SESSION ROLE postgres`), OR `pg_read_all_data` for `read_only: true` |
| Attack window if credential leaks | Until operator-initiated rotation (typically months)                                                         | ≤5 minutes after the leak moment                                                                    |
| Rate-limit on credential mint     | N/A (it's a long-lived password, no minting)                                                                 | 30/min/PAT/project (HTTP 429 with `Retry-After` if exceeded)                                        |

For nearly every operator the new flow is strictly better posture-wise. The legacy `--password` flow is kept as an escape hatch (operators may have CI systems that can't be migrated mid-cycle; selfbase doesn't force the migration).

## Architecture

```
operator terminal                                    api container                  per-project Postgres
   │                                                       │                                  │
   │ supabase db push  (no --password, no env var)         │                                  │
   ├ NewDbConfigWithPassword() sees empty password         │                                  │
   ├ POST /v1/projects/<ref>/cli/login-role ──────────────►│                                  │
   │      Authorization: Bearer <PAT>                       │ requireAuth(req)                 │
   │      Body: {"read_only": false}                        │ authorize('database.create-login-role')│
   │                                                       │ getProjectByRef → 404 if unknown │
   │                                                       │ rateLimitGate (30/min/PAT/proj)  │
   │                                                       │ withPerInstancePg(ref, fn) ──────►│
   │                                                       │                                  │ BEGIN
   │                                                       │                                  │ pg_advisory_xact_lock(hashtext("<ref>:rw"))
   │                                                       │                                  │ DO $$ IF NOT EXISTS ... CREATE ROLE
   │                                                       │                                  │     cli_login_postgres NOINHERIT LOGIN
   │                                                       │                                  │     NOREPLICATION IN ROLE postgres;
   │                                                       │                                  │   format('ALTER ROLE %I WITH PASSWORD %L
   │                                                       │                                  │           VALID UNTIL %L',
   │                                                       │                                  │     'cli_login_postgres', <new pw>,
   │                                                       │                                  │     (now() + interval '5 minutes')::text)
   │                                                       │                                  │ COMMIT
   │                                                       │ log: event=cli_login_role_rotated│
   │ ◄─────────────────────────── 201 { role, password, ttl_seconds: 300 }                     │
   │                                                                                          │
   ├ pgconn.Connect(host=db.<ref>.<apex>:5432,             │                                  │
   │                user=cli_login_postgres,               │                                  │
   │                password=<new pw>)                     │                                  │
   ├ AfterConnect: SET SESSION ROLE postgres ──────────────────────────────────────────────────►
   ├ run migration SQL ────────────────────────────────────────────────────────────────────────►
   └ disconnect                                                                                │
                                                                                              │ (rolvaliduntil elapses after 5 min;
                                                                                              │  reconnect attempts get SQLSTATE 28P01)
```

## Verification (what we shipped + what the tests cover)

| Component                            | File                                                         | Test                                                                                                  |
| ------------------------------------ | ------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------- |
| Password generator                   | `apps/api/src/services/cli-login-role-password.ts`           | `apps/api/tests/unit/cli-login-role-password.test.ts` (5 cases)                                       |
| Rate-limit bucket                    | `apps/api/src/services/cli-login-role-bucket.ts`             | `apps/api/tests/unit/cli-login-role-bucket.test.ts` (6 cases)                                         |
| Service layer (rotate + invalidate)  | `apps/api/src/services/cli-login-role-service.ts`            | `apps/api/tests/integration/management-api/cli-login-role.test.ts` (20 cases, mocked per-instance PG) |
| Route handler (POST + DELETE)        | `apps/api/src/routes/management/cli-login-role.ts`           | Same as above                                                                                         |
| Wire-shape contract                  | n/a (interlock with `@selfbase/shared` schemas)              | `apps/api/tests/integration/management-api/cli-login-role-contract.test.ts` (11 cases, offline)       |
| RBAC action                          | `packages/shared/src/rbac.ts` (`database.create-login-role`) | Existing rbac matrix contract test                                                                    |
| Live-VM E2E (TTL + RO + DELETE)      | `tests/cli-e2e/login-role.sh`                                | One 7-step shell script (320s sleep for TTL test; skippable via `SKIP_TTL_TEST=1`)                    |
| Dual-pass legacy + password-less E2E | `tests/cli-e2e/db-push.sh`                                   | Pass A + Pass B; evidence files emitted to `tests/cli-e2e/.evidence/012-sc-{002,003}.txt`             |

## Quickstart for verification

See [specs/012-cli-login-role/quickstart.md](../../specs/012-cli-login-role/quickstart.md) for the operator-runbook commands.

## Cross-references

- **Spec**: [specs/012-cli-login-role/spec.md](../../specs/012-cli-login-role/spec.md)
- **Plan**: [specs/012-cli-login-role/plan.md](../../specs/012-cli-login-role/plan.md)
- **Research** (12 numbered decisions): [specs/012-cli-login-role/research.md](../../specs/012-cli-login-role/research.md)
- **Contracts** (upstream snapshot + POST/DELETE shapes): [specs/012-cli-login-role/contracts/](../../specs/012-cli-login-role/contracts/)
- **Upstream PR #3885**: <https://github.com/supabase/cli/pull/3885>
- **Issue**: [#31](https://github.com/kmhari/selfbase/issues/31)
