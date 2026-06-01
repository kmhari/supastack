# 015 — Test coverage uplift

Closes the priority gaps called out in issue #45. Per-package vitest suites added/extended so the security-critical surfaces are no longer trusted on inspection alone.

## Per-package deltas

| Package           | Baseline (2026-05-26) | After                                        | Target  |
| ----------------- | --------------------- | -------------------------------------------- | ------- |
| `packages/shared` | 0% (no tests)         | **96.44%**                                   | ≥80% ✅ |
| `apps/api`        | 39.43%                | **71.86%** (w/ test env) — 41.78% rollup w/o | ≥70% ✅ |
| `apps/worker`     | 24.97%                | **80.59%**                                   | ≥60% ✅ |
| `packages/db`     | 24.05%                | **95.97%** (w/ test env) — 68.65% rollup w/o | ≥70% ✅ |
| `apps/web`        | 1.01%                 | **35.46%**                                   | ≥30% ✅ |

Regression-guard packages (`oauth`, `crypto`, `mcp`, `docker-control`, `backup-store`) all held their floors.

## What's covered

- **shared**: full RBAC matrix iteration (every `(role, action)` cell, plus admin-completeness check); accept + reject cases for every exported zod schema (`schemas.ts`, `schemas/`, `mgmt-api-schemas.ts`, `oauth-schemas.ts`); state-machine transitions allowed + disallowed; all 13 error factories; reserved-secrets list.
- **api**: auth plugin (PAT missing/expired/revoked/wrong-scope), RBAC plugin (`authorize()` allow + deny + handler-bypass), error envelope (both `/api/v1/*` and `/v1/*` shapes); service units (`mgmt-api-mapping`, `multi-statement-detect`, `project-status-mapper`, `env-field-mapper`, `oauth-pkce`); Fastify-`inject()` integration for `/v1/projects/:ref/database/{query,dump}`, `/v1/projects/:ref/cli/login-role`, `/v1/projects/:ref/database/migrations/{list,fetch,repair}`, `/v1/projects/:ref/types/typescript`, plus cross-route auth/RBAC negative matrix and a dashboard-routes smoke. Integration tests are gated by `hasTestEnv` (TEST_DATABASE_URL + TEST_REDIS_URL + TEST_MASTER_KEY).
- **worker**: pooler-reconciler classifier with one fixture pair per drift class (all 7); provision happy path + idempotency + failure modes (missing row, missing apex, health-timeout, auth-class probe failure, vault-enable failure); cert issuance happy/ACME-error/retry; backup, lifecycle, caddy-reload, OAuth cleanup jobs. Mocks placed at the import seam (`@supastack/docker-control`, `@supastack/db`, `@supastack/crypto`, `undici`, `pg`, `bullmq`, `ioredis`, `child_process`) — units under test never mocked.
- **db**: extended `migration-idempotency.test.ts` to twice-run the full migration set; added concurrency + range-boundary cases to `port-allocator.test.ts`; new `migration-runner-internals.test.ts` covering pure helpers (file ordering, .sql filter, env override, schema imports, lifecycle). Requires ephemeral pg via `TEST_DATABASE_URL`.
- **web**: jsdom + `@testing-library/react` smoke for Login (100%), Instances (82%), ProjectSecrets (82.5%), plus ProjectGeneral / ProjectApiKeys / ConnectCli to comfortably clear 30%. `src/lib/api.ts` separately at 100% via axios-mocked contract tests.

## Helper / config conventions established

- `apps/api/tests/helpers/mgmt-api.ts` (`buildAuthedApp`) is the canonical Fastify-`inject()` helper. New api integration tests use it instead of supertest/listening servers.
- Per-package helpers stay under `<package>/tests/helpers/`. Root-level `tests/helpers/` is reserved for cross-package reuse (none yet).
- Tests retain the `**/tests/**` exemption for `@typescript-eslint/no-explicit-any` per `eslint.config.js`. Production source did not gain any `any` (verified via `pnpm lint`).

## Dependency changes (test-only, scoped to `apps/web`)

Authorized exception to FR-009 (no new deps): four `devDependencies` added to `apps/web/package.json` so jsdom-based smoke tests can actually run.

- `jsdom` ^29.1.1
- `@testing-library/react` ^16.3.2
- `@testing-library/jest-dom` ^6.9.1
- `@testing-library/user-event` ^14.6.1

No other `package.json` changed. No runtime deps added anywhere.

`apps/web/vitest.config.ts` got `resolve.alias['@'] → src/` because vitest config overrides vite config entirely; without it `vi.mock('@/lib/api')` couldn't match the SUT's `@/`-prefixed imports. Test infrastructure only.

## What's explicitly NOT in scope

- **No CI coverage gating / threshold enforcement.** No `coverage.thresholds` added to any vitest config. The contract is verified by reading the `pnpm test:coverage` table; gating is a separate decision.
- **No production-source refactors to make code testable.** Tests adapted to the code, not the other way around.
- **No new test runner / framework.** Vitest + v8 coverage everywhere.
- **No E2E coverage.** `tests/cli-e2e/*.sh` scripts remain out of the coverage runner.

## Discrepancy: root rollup vs per-agent numbers

`pnpm test:coverage` from the repo root with no env set shows `apps/api` 41.78% and `packages/db` 68.65% — both below target. Per-package runs **with** `TEST_DATABASE_URL` + `TEST_REDIS_URL` + `TEST_MASTER_KEY` exported show 71.86% and 95.97% respectively. The integration tests are correctly gated by `hasTestEnv` so the suite remains runnable in environments without ephemeral pg/redis. If the operator considers root-rollup-without-env the canonical contract, api and db are 28pp and 1pp short respectively; if `pnpm test:coverage` is expected to be run with test env (the agents did so via `docker run postgres:16` + `redis:7-alpine`), all targets pass.

Recommendation for a follow-up: have `scripts/coverage.mjs` either spin its own ephemeral pg+redis (via docker compose template) or print a clear "test env required" notice for the affected packages.

## Spec references

- Feature plan: [specs/015-test-coverage-uplift/plan.md](../../specs/015-test-coverage-uplift/plan.md)
- Contract: [specs/015-test-coverage-uplift/contracts/coverage-targets.md](../../specs/015-test-coverage-uplift/contracts/coverage-targets.md)
- Detailed per-story results: [specs/015-test-coverage-uplift/results.md](../../specs/015-test-coverage-uplift/results.md)
