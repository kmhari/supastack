# Data Model: Test Coverage Uplift

This feature adds tests, not runtime data. The "entities" are the artifacts the tests reason about — captured here so test design references stable shapes rather than drifting fixtures.

## Coverage Report

Output of `pnpm test:coverage` (i.e. `scripts/coverage.mjs`).

| Field | Type | Notes |
|---|---|---|
| package | string | e.g. `apps/api`, `packages/shared` |
| stmts | number (%) | statements covered / total |
| branch | number (%) | branches covered / total |
| funcs | number (%) | functions covered / total |
| lines | number (%) | lines covered / total |
| status | enum `pass`/`fail`/`missing` | derived from runner |

**Validation**: targets are defined per package in `contracts/coverage-targets.md`; verification is by reading the runner's table.

## RBAC Matrix Cell

Source: `packages/shared/src/rbac.ts` (matrix shape: `role → action → boolean`).

| Field | Type | Notes |
|---|---|---|
| role | string (enum of declared roles) | e.g. `admin` |
| action | string (enum of declared actions) | e.g. `database.write`, `database.create-login-role` |
| allowed | boolean | source of truth in `rbac.ts` |

**Validation**: every (role, action) pair must be asserted exactly once in `packages/shared/tests/rbac.test.ts` via iteration over the matrix.

## Zod Schema Test Case

| Field | Type | Notes |
|---|---|---|
| schema_id | string | exported name from `packages/shared/src/schemas*.ts` |
| case_kind | enum `accept`/`reject` | |
| payload | unknown | input to `.parse()` / `.safeParse()` |
| expected_error_path | string[]? | required for `reject` cases; matches zod issue `path` |

**Validation**: every exported schema must have at least one `accept` and one `reject` case per documented constraint.

## Management API Route

| Field | Type | Notes |
|---|---|---|
| method | string | HTTP verb |
| path | string | e.g. `/v1/projects/:ref/database/query` |
| pinned_snapshot | path? | `specs/<NNN>/upstream-openapi-snapshot.json` if pinned, else null |
| rbac_action | string | required action from RBAC matrix |
| auth_required | boolean | true for all `/v1/*` |

**Validation**: route test must cover (a) auth-absent → 401, (b) auth-present but RBAC-denied → 403, (c) auth+RBAC ok + valid payload → 2xx with documented shape, (d) auth+RBAC ok + invalid payload → 400 with documented error envelope.

## Pooler Drift Class

Source: `apps/worker/src/jobs/pooler-reconciler.ts` (7 documented classes per [docs/pooler-resilience.md](../../docs/pooler-resilience.md)).

| Field | Type | Notes |
|---|---|---|
| class_id | string | one of 7 enum values |
| declared_state_fixture | object | minimum input shape for classifier |
| observed_state_fixture | object | minimum input shape for classifier |
| expected_remediation | enum | `noop`/`recreate`/`update-password`/etc. (exact set TBD by reading source during impl) |

**Validation**: every `class_id` has exactly one fixture pair and one remediation assertion.

## Provision State Transition

Source: `apps/worker/src/jobs/provision.ts` (state machine).

| Field | Type | Notes |
|---|---|---|
| from_state | string | enum from `packages/shared/src/state-machine.ts` |
| to_state | string | |
| trigger | enum | job step name |
| side_effect_mocks | string[] | docker-control / vault / pg calls expected |

**Validation**: every transition reachable from `pending` to `running` has at least one happy-path assertion; idempotency asserted by re-running a completed pipeline and asserting no new side effects.

## Migration Idempotency Case

Source: `packages/db/migrations/*.sql`.

| Field | Type | Notes |
|---|---|---|
| migration_set | string[] | ordered list of SQL files |
| run_count | int (≥2) | 2 = idempotency check |
| expected_diff | empty | second run must produce zero schema diff |

**Validation**: existing `packages/db/tests/migration-idempotency.test.ts` extended to cover the full current migration set.

## Port Allocation Case

Source: `packages/db/src/port-allocator.ts` (or equivalent module).

| Field | Type | Notes |
|---|---|---|
| concurrency | int | N concurrent allocators |
| range | [low, high] | configured port range |
| expected_unique | boolean (true) | |
| expected_in_range | boolean (true) | |

**Validation**: extended `port-allocator.test.ts` exercises N ≥ 16 concurrent allocations and asserts uniqueness + range.

## Web Smoke Case

| Field | Type | Notes |
|---|---|---|
| page | enum `Login`/`Instances`/`ProjectSecrets` | |
| mock_fetch | object | minimal mocked api responses |
| interaction | enum `mount`/`submit`/`click-row` | |
| assertion | string | expected DOM presence or call to mocked fetch |

**Validation**: ≥ 1 mount assertion per page; ≥ 1 interaction assertion for Login (submit) and Instances (click-row) and ProjectSecrets (add/edit).
