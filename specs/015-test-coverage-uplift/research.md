# Research: Test Coverage Uplift

## Decision: vitest + v8 coverage provider (status quo)

**Rationale**: All 10 packages already declare vitest; `scripts/coverage.mjs` is the canonical runner (b54deec); issue #45 evaluates against its output. Introducing Jest/c8/nyc would violate FR-009 (no new tooling) and split the measurement surface.

**Alternatives considered**: Jest (rejected — duplicates runner, slower start, would require ts-jest config); istanbul provider (rejected — slower than v8 and not currently configured).

## Decision: Fastify `inject()` for api integration tests, not a live HTTP server

**Rationale**: Fastify supports in-process request injection with full plugin and middleware execution, including the auth and RBAC plugins. Avoids port binding, real DB containers, and parallel-test flakiness. Existing `apps/api/tests/integration/` already uses this pattern in places.

**Alternatives considered**: supertest against a real listening server (rejected — extra dep, port conflicts in parallel); testcontainers-spawned api (rejected — too slow, requires Docker daemon, conflicts with FR-009).

## Decision: Truth-table generator for RBAC matrix

**Rationale**: `packages/shared/src/rbac.ts` enumerates roles × actions. A single test file iterates the matrix and asserts each cell. Adding a new action automatically grows test coverage without per-action boilerplate. Satisfies SC-003 by construction.

**Alternatives considered**: One test per action (rejected — boilerplate, easy to forget when adding actions); snapshot of the matrix (rejected — snapshots hide intent and rubber-stamp regressions).

## Decision: Per-package pg via ephemeral schemas, not testcontainers

**Rationale**: `packages/db/tests/migration-idempotency.test.ts` already runs against a real pg (DATABASE_URL from env, schema reset per test). This pattern works in local + CI without Docker. Extending it to cover the runner's pure helpers and the port allocator under concurrency is incremental.

**Alternatives considered**: testcontainers (rejected — adds runtime dep + Docker-daemon requirement, conflicts with FR-009); pg-mem (rejected — diverges from real pg semantics for advisory locks used by port allocator and migration runner).

## Decision: jsdom + @testing-library/react for web smoke

**Rationale**: `apps/web/vitest.config.ts` already sets `environment: 'jsdom'`. Smoke tests render a page, assert key elements, and fire an event — no router/server boot, no real fetch. Sufficient for the ≥30% target on three pages.

**Alternatives considered**: Playwright component tests (rejected — adds heavy dep, slower runs); full e2e via existing `apps/web/tests/e2e` (rejected — out of scope per issue #45 and not measured by vitest coverage).

## Decision: Test the pooler-reconciler classifier via fixtures, not by spinning a real Supavisor

**Rationale**: The 7 drift classes are deterministic functions of (declared state, observed state). Capture each as a fixture pair → call classifier → assert remediation. SC-004 satisfied without runtime dependency.

**Alternatives considered**: Live Supavisor in tests (rejected — operational + speed cost); snapshot tests (rejected — hides intent).

## Decision: Mock Docker / network at the seam, not at the unit

**Rationale**: Worker provision pipeline calls `docker-control` and external HTTP. Tests mock those modules at the import boundary (vitest `vi.mock`) and assert state transitions in the provision state machine. FR-010 preserved: the unit under test (transition logic) is not itself mocked.

**Alternatives considered**: testcontainers + real Docker (rejected — slow, flaky, FR-009 violation); end-to-end provision against the live VM (rejected — already covered by `tests/cli-e2e/*.sh`, out of scope here).

## Decision: Management API contract assertions reference the pinned upstream OpenAPI snapshot

**Rationale**: The repo convention (CLAUDE.md) pins `upstream-openapi-snapshot.json` per feature. For `/v1/*` route tests, load the snapshot and assert request/response shapes against it where the snapshot is already pinned (013 db-query-dump, 006 mgmt-gen-types, 012 cli-login-role). For routes without a pinned snapshot, assert against the local zod schema and document the gap rather than block the feature.

**Alternatives considered**: Force-pin a snapshot for every route (rejected — scope creep; that's a separate concern from coverage); skip contract assertions (rejected — would let shape regressions through).

## Decision: No coverage thresholds in vitest configs

**Rationale**: Spec explicitly puts CI gating out of scope. Adding `coverage.thresholds` in vitest configs would create a soft gate that fails local runs and pre-empts a separate decision. Targets are tracked in the contracts file and verified by reading the `scripts/coverage.mjs` table.

**Alternatives considered**: Add thresholds now (rejected — out of scope, premature).

## Decision: Allow `as any` only in tests, never new `any` in production source

**Rationale**: `eslint.config.js` already scopes off `@typescript-eslint/no-explicit-any` for `**/tests/**`. FR-006 preserves this asymmetry. SC-006 verified by lint diff during review.

**Alternatives considered**: Drop the test exemption (rejected — would balloon test maintenance per CLAUDE.md guidance).
