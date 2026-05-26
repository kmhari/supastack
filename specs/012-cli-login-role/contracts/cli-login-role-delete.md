# Contract — `DELETE /v1/projects/:ref/cli/login-roles`

**Feature**: 012-cli-login-role
**Upstream source of truth**: `api.supabase.com/api/v1-json` (snapshot pinned at [`upstream-openapi-snapshot.json`](./upstream-openapi-snapshot.json))
**Selfbase handler**: `apps/api/src/routes/management/cli-login-role.ts` (same file as the create handler — Phase 2)

## Purpose

Invalidate the active password on both per-project CLI login roles (read-write + read-only) immediately, without dropping the roles themselves. Used by:

- Well-behaved CLI exit paths that want to clean up after themselves.
- Operators who want to lock out CLI access mid-window (e.g., after revoking a compromised PAT, or as a tripwire response).

## Path

```
DELETE /v1/projects/{ref}/cli/login-role
```

Note: both POST and DELETE share the **same path** `/v1/projects/{ref}/cli/login-role` (singular). Distinguished by HTTP method only. Verified against `api.supabase.com/api/v1-json` — operationId `v1-delete-login-roles` is mounted on the same path object as `v1-create-login-role`. The plural "roles" only appears in the response schema name (`DeleteRolesResponse`) because a single DELETE call invalidates both per-project CLI roles (read-write + read-only) in one go.

## Request

### Headers

| Header | Required | Value |
|---|---|---|
| `Authorization` | yes | `Bearer <PAT>` |

### Body

None. The endpoint takes no request body.

## Response — 200 OK (happy path)

```json
{
  "message": "ok"
}
```

The response shape is fixed to `{ message: "ok" }` per upstream `V1DeleteLoginRolesOutput = Schema.Struct({ message: Schema.Literal("ok") })` (verified at `/tmp/supabase-cli/packages/api/src/generated/contracts.ts:1086`).

The HTTP status is 200, not 204. (Matches upstream — also matches selfbase's existing convention of always sending JSON envelopes from `/v1/*`.)

## Response — error cases

Same error envelope as the create endpoint. Specific cases:

### 401 / 403 / 404 — same as create

PAT validation, RBAC check, and project visibility checks behave identically to the create endpoint. The same `database.create-login-role` RBAC action gates both (Decision 10 in research.md — no separate action for DELETE, since being able to invalidate a credential is strictly less dangerous than being able to mint one).

### 409 Conflict — project not running

Same as create — if the project's per-instance Postgres is unreachable because the project is in `provisioning`/`paused`/`restoring`, the DELETE returns 409. (Operators may find this counterintuitive — "I just want to lock it down, why do I need the project running?" — but the lockdown happens by mutating `pg_authid`, which requires PG to be up. If PG is down, no one can authenticate to it anyway, so the lockdown is implicitly already in effect.)

### 502 Bad Gateway — per-project PG unreachable mid-request

Same as create.

## Idempotency

Calling DELETE when the CLI roles don't exist yet returns 200 OK (not 404). The endpoint runs the equivalent of:

```sql
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_login_postgres') THEN
    EXECUTE 'ALTER ROLE "cli_login_postgres" VALID UNTIL ''1970-01-01''';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'cli_login_supabase_read_only_user') THEN
    EXECUTE 'ALTER ROLE "cli_login_supabase_read_only_user" VALID UNTIL ''1970-01-01''';
  END IF;
END $$;
```

A second DELETE call immediately after the first is a no-op SQL-wise but still returns 200 OK.

## Side effects

1. On the per-project Postgres:
   - For each of the two CLI roles that exists: `ALTER ROLE … VALID UNTIL '1970-01-01'`.
   - The roles themselves remain; only their passwords' validity is in the past.
   - Existing already-authenticated connections from earlier CLI calls **continue to function** until they close naturally. Postgres does not retroactively terminate sessions when `rolvaliduntil` is changed — the timestamp gates new authentications only. This is documented in the operator runbook as a deliberate UX choice (in-flight work drains; new logins are blocked immediately).

2. On the api container's stdout:
   - One structured pino log line: `{event: "cli_login_role_invalidated", pat_id, project_ref, requester_ip}` — see [data-model.md](../data-model.md) Entity 3.

3. The rate-limit bucket is **not** consumed by DELETE calls — only POST consumes. (DELETE has its own rate limit if we ever need one, but per spec we don't bother for now.)

## Acceptance criteria

| ID | Criterion | How to test |
|---|---|---|
| D1 | DELETE returns 200 + `{message: "ok"}` regardless of whether the CLI roles existed beforehand | vitest integration test, two scenarios: (a) call POST first then DELETE; (b) call DELETE on a project that has never seen a POST |
| D2 | After DELETE, attempting to authenticate with the most-recently-rotated password fails with SQLSTATE 28P01 | live VM E2E: POST → connect (success) → DELETE → reconnect (failure) |
| D3 | After DELETE, an already-open connection from a prior POST keeps working (running queries successfully) until it closes naturally | live VM E2E: POST → open connection → DELETE → run SELECT through the open connection (still works) → close → reconnect (fails) |
| D4 | A subsequent POST after a DELETE rotates the password to a fresh valid value and `rolvaliduntil` is back in the future; the workflow recovers without operator intervention | vitest integration test |
| D5 | DELETE emits one structured log line of the expected shape; no password material is logged | vitest integration test with pino test transport |
| D6 | DELETE with missing/invalid/revoked PAT returns 401 | vitest integration test |
| D7 | DELETE on a project the PAT can't see returns 404 (same shape as create's 404) | vitest integration test |

## Compatibility note

Upstream's OpenAPI defines this endpoint (`v1-delete-login-roles`, path `/v1/projects/{ref}/cli/login-role`, response schema `V1DeleteLoginRolesOutput = { message: "ok" }`). The current upstream `supabase` CLI binary doesn't call DELETE in its primary flow today (PR #3885 only added the POST-driven password rotation; cleanup relies on TTL expiry), but it exists as an operator/automation hook. Selfbase shipping it in the same PR keeps the surface symmetric with Cloud's and gives operators the manual lockdown lever the spec FR-002 calls out.
