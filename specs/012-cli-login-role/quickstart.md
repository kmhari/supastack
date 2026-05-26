# Quickstart — CLI login-role

**Feature**: 012-cli-login-role
**Audience**: Operator of a selfbase deployment who has just merged this feature and wants to verify it works end-to-end.

## TL;DR

You do nothing extra. `supabase db push` (and `db pull`, `db diff`, `migration list/fetch/repair`, `inspect db`) now work against selfbase without supplying a database password. Your existing `--password "$PW"` scripts still work; nothing breaks.

## Prerequisite check

After deploying the feature to the VM:

```bash
# 1. Confirm the new endpoint is registered (should return 401 with the mgmt-api envelope,
#    not 404 — because the endpoint exists but you didn't auth).
curl -s -o /dev/null -w '%{http_code}\n' \
  -X POST "https://api.${APEX}/v1/projects/${REF}/cli/login-role" \
  -H 'Content-Type: application/json' \
  -d '{"read_only": false}'
# Expected: 401

# 2. With a valid PAT, expect 201 + JSON body.
curl -s -X POST "https://api.${APEX}/v1/projects/${REF}/cli/login-role" \
  -H "Authorization: Bearer ${SELFBASE_PAT}" \
  -H 'Content-Type: application/json' \
  -d '{"read_only": false}' | jq .
# Expected: { "role": "cli_login_postgres", "password": "<64-char-hex>", "ttl_seconds": 300 }
```

If both checks pass, the endpoint is live.

## End-to-end test (the actual operator workflow)

```bash
# 0. Unset any existing DB-password env vars to make sure the new path is exercised.
unset SUPABASE_DB_PASSWORD SELFBASE_DB_PASSWORD

# 1. Configure the selfbase profile (one-time, per machine).
cat > ~/selfbase.toml <<EOF
name          = "selfbase-prod"
api_url       = "https://api.${APEX}"
dashboard_url = "https://${APEX}/dashboard"
project_host  = "${APEX}"
EOF

# 2. Authenticate the CLI once. (Either flow works; both end with a PAT in ~/.supabase/access-token.)
#    Option A — paste a PAT created in /dashboard/settings/tokens:
supabase login --profile ~/selfbase.toml --token "${SELFBASE_PAT}"
#    Option B — device-code flow (feature 011):
supabase login --profile ~/selfbase.toml

# 3. Link a project — note: NO --password flag.
mkdir -p /tmp/qs && cd /tmp/qs && supabase init -y
echo "project_id = \"${REF}\"" > supabase/config.toml
supabase --profile ~/selfbase.toml link --project-ref "${REF}"

# 4. Push a throwaway migration — NO --password flag.
cat > supabase/migrations/99999999999999_qs.sql <<'EOF'
CREATE TABLE IF NOT EXISTS _qs_login_role_smoke (
  id serial PRIMARY KEY,
  at timestamptz NOT NULL DEFAULT now()
);
EOF
supabase --profile ~/selfbase.toml db push --include-all

# 5. Verify the migration list — NO --password flag.
supabase --profile ~/selfbase.toml migration list

# 6. Verify the per-project Postgres ended up with exactly one cli_login_postgres role
#    whose validity is in the recent past (the 5-min window has not been refreshed since step 4).
PGPASSWORD="${SELFBASE_DB_SUPERUSER_PASSWORD}" psql \
  "postgresql://postgres@db.${REF}.${APEX}:5432/postgres" \
  -c "SELECT rolname, rolvaliduntil FROM pg_roles WHERE rolname LIKE 'cli_login_%' ORDER BY rolname;"
# Expected: exactly one row 'cli_login_postgres' with rolvaliduntil ≈ now() - <a few minutes>.
# (Read-only role not created since step 4 didn't request read_only: true.)

# 7. Cleanup.
PGPASSWORD="${SELFBASE_DB_SUPERUSER_PASSWORD}" psql \
  "postgresql://postgres@db.${REF}.${APEX}:5432/postgres" \
  -c "DROP TABLE _qs_login_role_smoke;"
```

If every step succeeds without prompting for or accepting a database password, the feature works.

## Verifying the legacy `--password` flow still works (US2 regression guard)

```bash
unset SUPABASE_DB_PASSWORD SELFBASE_DB_PASSWORD
cd /tmp/qs

# Same workflow, but explicitly passing --password to every command.
supabase --profile ~/selfbase.toml link --project-ref "${REF}" \
  --password "${SELFBASE_DB_SUPERUSER_PASSWORD}"

supabase --profile ~/selfbase.toml db push --include-all \
  --password "${SELFBASE_DB_SUPERUSER_PASSWORD}"

supabase --profile ~/selfbase.toml migration list \
  --password "${SELFBASE_DB_SUPERUSER_PASSWORD}"
```

All three should succeed identically to pre-feature behaviour. Confirm via `pg_roles` that no `cli_login_*` role was created as a side effect (the CLI's resolution logic short-circuits the endpoint call when `--password` is supplied):

```bash
PGPASSWORD="${SELFBASE_DB_SUPERUSER_PASSWORD}" psql \
  "postgresql://postgres@db.${REF}.${APEX}:5432/postgres" \
  -c "SELECT COUNT(*) FROM pg_roles WHERE rolname LIKE 'cli_login_%';"
# Expected on a freshly-provisioned project: 0
# (If 0 here AND ≥1 after step 4 of the password-less section: feature works as specified.)
```

## Manual operator levers

### Lock out CLI access on a specific project

```bash
# Invalidate active passwords on both CLI roles immediately. New CLI calls
# from the operator will succeed (they re-rotate); calls in flight with stale
# passwords will fail with 28P01.
curl -X DELETE "https://api.${APEX}/v1/projects/${REF}/cli/login-role" \
  -H "Authorization: Bearer ${SELFBASE_PAT}"
# Expected: 200 { "message": "ok" }
```

Note: this is single-shot. The very next POST from any CLI re-rotates the password to a fresh valid value. For a permanent lockdown, revoke the operator's PAT at `/dashboard/settings/tokens` (no PAT = no successful POST = no usable password).

### Emergency: manually drop the role

If the CLI role itself has somehow become problematic (corrupted entry, third-party tool fiddling, etc.), connect as the per-project superuser and drop it. The next CLI call recreates it idempotently — no operator-side state needs to be cleared first.

```bash
PGPASSWORD="${SELFBASE_DB_SUPERUSER_PASSWORD}" psql \
  "postgresql://postgres@db.${REF}.${APEX}:5432/postgres" <<'SQL'
DROP ROLE IF EXISTS cli_login_postgres;
DROP ROLE IF EXISTS cli_login_supabase_read_only_user;
SQL
```

If `DROP ROLE` fails with `role "cli_login_postgres" cannot be dropped because some objects depend on it`, run `REASSIGN OWNED BY cli_login_postgres TO postgres; DROP OWNED BY cli_login_postgres;` first. In practice this shouldn't happen because the CLI never owns objects directly (it `SET SESSION ROLE postgres` before doing any DDL).

### Audit query: who rotated CLI access recently?

```bash
# Stream the api container's log and filter for the structured event.
# Path/transport depends on the operator's existing log pipeline.
docker logs selfbase-api 2>&1 | \
  grep -F '"event":"cli_login_role_rotated"' | \
  jq -r '. | "\(.time) \(.project_ref) \(.scope) by PAT \(.pat_id) from \(.requester_ip)"'
```

## What to do if something breaks

| Symptom | Likely cause | Fix |
|---|---|---|
| `supabase db push` exits with `Initialising cli_login_postgres role...` then hangs | Per-project Postgres is unreachable | Check `docker compose ps` for the per-instance containers; restart if any are unhealthy |
| `supabase db push` exits with `Failed to authenticate as cli_login_postgres` after ≥2 retries | Password rotation succeeded but the per-instance Postgres SCRAM cache is stale | Restart the per-instance Postgres container (it re-reads `pg_authid`); rare in practice |
| Exit with `429 rate limit exceeded` mid-CI | A parallel-migration job exceeded 30 calls/min/PAT/project | Reduce concurrency, or split work across multiple PATs |
| Exit with `403 permission denied: database.create-login-role` | PAT belongs to a member-tier user, not admin | Either elevate the user to admin or have an admin run the push |
| `supabase db push --password "$PW"` no longer works (regression) | This is a bug — file an issue immediately | The `--password` path is a P1 contract per spec US2 |

## Reference: how this works under the hood

When the CLI realises no `SUPABASE_DB_PASSWORD` and no `--password` was provided, its `NewDbConfigWithPassword` (`apps/cli-go/internal/utils/flags/db_url.go:123`) calls `POST /v1/projects/{ref}/cli/login-role`. Selfbase:

1. Validates the bearer PAT (existing auth plugin).
2. Checks RBAC for `database.create-login-role` (admin only).
3. Runs the rate-limit bucket check (30/min/PAT/project, in-memory).
4. Opens an ephemeral `pg.Client` to the per-project Postgres as `postgres` superuser (via `withPerInstancePg`).
5. In a single transaction, takes a per-(project, scope) advisory lock, ensures the `cli_login_*` role exists (`CREATE ROLE … NOINHERIT LOGIN NOREPLICATION IN ROLE <target>`), and runs `ALTER ROLE … WITH PASSWORD '<256-bit-hex>' VALID UNTIL now() + interval '5 minutes'`.
6. Emits one structured pino log line: `{event: 'cli_login_role_rotated', pat_id, project_ref, scope, requester_ip, role}`.
7. Returns `201 { role, password, ttl_seconds: 300 }`.

The CLI then opens a Postgres connection using `(role, password)`. Because the role's username starts with `cli_login_`, the upstream CLI's `AfterConnect` callback (`apps/cli-go/internal/utils/connect.go:215-220`) automatically runs `SET SESSION ROLE postgres` (or `SET SESSION ROLE supabase_read_only_user` for the read path). All subsequent SQL in that session runs with the target role's privileges.

The role lives in `pg_authid` until project deletion. Its password rotates on every endpoint call; its `VALID UNTIL` is 5 minutes in the future every successful POST and 1970 every successful DELETE.

For the full architecture rationale, see [research.md](./research.md) (Decisions 1–12).
