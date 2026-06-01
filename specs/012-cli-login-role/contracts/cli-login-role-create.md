# Contract — `POST /v1/projects/:ref/cli/login-role`

**Feature**: 012-cli-login-role
**Upstream source of truth**: `api.supabase.com/api/v1-json` (snapshot pinned at [`upstream-openapi-snapshot.json`](./upstream-openapi-snapshot.json) in this directory)
**Supastack handler**: `apps/api/src/routes/management/cli-login-role.ts` (to be created — Phase 2)

## Purpose

Rotate the password of a per-project CLI login role and return fresh credentials to the caller. The caller authenticates with a bearer PAT; the response is a short-lived `(role, password)` tuple the caller uses to open a direct Postgres connection.

## Path

```
POST /v1/projects/{ref}/cli/login-role
```

- `{ref}` — 20-character lowercase-alpha project reference (matches existing `ProjectRef` regex supastack already validates: `^[a-z]{20}$`).
- The endpoint is mounted inside the `/v1/*` Fastify scope at `apps/api/src/server.ts` (alongside `migrationsRoutes`, `genTypesRoutes`, etc.), so it inherits the `mgmt-api-errors` envelope automatically.

## Request

### Headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | yes | `Bearer <PAT>` — supastack-minted PAT (`sbp_<40hex>` per [feature 003](../../003-supabase-cli-compat-p0/)). |
| `Content-Type` | yes | `application/json`. |

### Body

```json
{
  "read_only": false
}
```

| Field | Type | Required | Notes |
|---|---|---|---|
| `read_only` | `boolean` | yes | `false` → rotate the `cli_login_postgres` role (read-write target). `true` → rotate the `cli_login_supabase_read_only_user` role (read-only target). |

Any extra fields are rejected with 400 + `code: "invalid_request"` (Zod `strict()` schema).

## Response — 201 Created (happy path)

```json
{
  "role": "cli_login_postgres",
  "password": "a9f3c2b18e7d4f5a6b1c8e2f3a4d5b6c7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b",
  "ttl_seconds": 300
}
```

| Field | Type | Notes |
|---|---|---|
| `role` | `string` (minLength 1) | Deterministic per request — `cli_login_postgres` for read-write, `cli_login_supabase_read_only_user` for read-only. Constant across all calls for a given (project, scope). |
| `password` | `string` (minLength 1) | 64-character lowercase hex string (32 bytes of entropy, 256 bits). Brand new on every call; the previously-rotated value is permanently lost from `pg_authid`. |
| `ttl_seconds` | `integer` (minimum 1, format int64) | Always **300**. The CLI uses this to decide how long to keep the resulting Postgres connection open before re-rotating. |

The HTTP status code is `201 Created` (matches upstream — verified at `api.supabase.com/api/v1-json` path `/v1/projects/{ref}/cli/login-role`, response `"201"`).

## Response — error cases

### 401 Unauthorized — missing/invalid/revoked PAT

```json
{
  "message": "missing bearer token",
  "code": "unauthorized"
}
```

The error envelope is supastack's existing `mgmt-api-errors` shape, which the CLI's error handler already understands (used by every other `/v1/*` endpoint).

### 403 Forbidden — PAT valid but RBAC denies `database.create-login-role`

```json
{
  "message": "permission denied: database.create-login-role",
  "code": "forbidden",
  "details": { "action": "database.create-login-role", "role": "member" }
}
```

### 404 Not Found — project ref doesn't exist OR the calling PAT can't see this project

```json
{
  "message": "Project not found",
  "code": "not_found",
  "details": { "ref": "aaaabbbbccccddddeeee" }
}
```

Per existing supastack convention (see `apps/api/src/routes/management/migrations.ts:46-48`), the 404 is the same whether the project doesn't exist or whether the PAT-holder lacks visibility — avoids leaking project existence to unauthorised callers.

### 409 Conflict — project is in a non-running state (provisioning, paused, restoring, etc.)

```json
{
  "message": "Project is in state 'provisioning'",
  "code": "project_not_running",
  "details": { "status": "provisioning" }
}
```

Maps to `InstanceNotRunningError` from `per-instance-pg.ts`.

### 422 Unprocessable Entity — body fails Zod validation (e.g., missing `read_only`)

```json
{
  "message": "read_only is required",
  "code": "invalid_request",
  "details": { "issues": [{ "path": ["read_only"], "message": "Required" }] }
}
```

### 429 Too Many Requests — rate limit (30/min/PAT/project)

```json
{
  "message": "rate limit exceeded",
  "code": "rate_limited",
  "details": { "retry_after_seconds": 17 }
}
```

`Retry-After` header also set to the integer seconds until the current window closes.

### 502 Bad Gateway — per-project Postgres unreachable

```json
{
  "message": "failed to connect to per-instance postgres: connection refused",
  "code": "per_instance_pg_connect_error"
}
```

Maps to `PerInstancePgConnectError`. Indicates infrastructure issue, not a client error.

## Side effects (server-side, observable but not in the HTTP response)

1. On the per-project Postgres:
   - If the target role doesn't exist yet, it is created idempotently with `NOINHERIT LOGIN NOREPLICATION IN ROLE <target>`.
   - The role's password is replaced with a fresh 256-bit value.
   - The role's `rolvaliduntil` is set to `now() + interval '5 minutes'`.
   - All wrapped in a single transaction that begins with `SELECT pg_advisory_xact_lock(hashtext('${ref}:${scope}'))` for concurrency safety.

2. On the api container's stdout:
   - One structured pino log line: `{event: "cli_login_role_rotated", pat_id, project_ref, scope, requester_ip, role}` — see [data-model.md](../data-model.md) Entity 3.

3. In the api container's heap:
   - The rate-limit bucket entry for `(patId, projectRef)` is incremented (or created at count=1 if first call).

## Acceptance criteria

| ID | Criterion | How to test |
|---|---|---|
| A1 | Happy-path POST with `read_only: false` returns 201 + valid 64-char hex password + ttl_seconds=300 + role=cli_login_postgres | vitest integration test with mocked `withPerInstancePg`; assert response shape matches a Zod schema generated from the upstream snapshot |
| A2 | Happy-path POST with `read_only: true` returns 201 + role=cli_login_supabase_read_only_user; everything else identical | same harness as A1, flip the body flag |
| A3 | Connecting to the per-project PG with the returned `(role, password)` succeeds; running `SET SESSION ROLE postgres` works; running `SELECT 1` succeeds | live VM E2E in `tests/cli-e2e/login-role.sh` |
| A4 | Same as A3 but for `read_only: true`; `SET SESSION ROLE supabase_read_only_user` succeeds; `CREATE TABLE _x()` fails with SQLSTATE 42501 | same E2E |
| A5 | Sleeping >300s then attempting to reconnect with the same returned password fails with SQLSTATE 28P01 | same E2E (long sleep step) |
| A6 | Two concurrent POSTs for the same (ref, scope) both return 201; both passwords are valid hex; second-to-write wins on subsequent connect attempts; first password's connect attempt either succeeds (if it raced to connect first) or fails fast with 28P01 | vitest integration test with two parallel calls |
| A7 | 31st POST inside a 60s window for the same (PAT, project) returns 429 with `retry_after_seconds` | vitest unit test on the bucket helper; integration test confirms the route handler honours it |
| A8 | Successful POST emits exactly one structured log line with the spec'd shape, no password leakage | vitest integration test with pino's test transport |
| A9 | POST with malformed/missing/revoked PAT returns 401 with the existing mgmt-api envelope | vitest integration test |
| A10 | POST with a project ref the PAT can't see returns 404; the response is byte-identical to "project genuinely doesn't exist" | vitest integration test |
| A11 | The endpoint's request/response shape MUST match `contracts/upstream-openapi-snapshot.json` for the two pinned paths | contract test (runs at vitest time, reads the JSON and asserts the live handler's Zod schema is structurally equivalent) |

## Compatibility note

The wire contract is dictated by the upstream `supabase` CLI binary. Any deviation (different status code on success, different field names, different password encoding) breaks the existing CLI client. The CLI source we verified against is the merged state of PR #3885 (2025-07-21) and the current `develop` branch as of 2026-05-25 — both expect this exact shape.
