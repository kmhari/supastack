# Implementation Plan: Test Coverage Uplift

**Branch**: `015-test-coverage-uplift` | **Date**: 2026-05-26 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/015-test-coverage-uplift/spec.md`

## Summary

Raise per-package coverage to risk-weighted targets defined in issue #45: `packages/shared` 0→80%, `apps/api` 41→70%, `apps/worker` 25→60%, `packages/db` 24→70%, `apps/web` 0→30% (statements). Approach: existing vitest infrastructure in every package, no new dependencies. Tests added as units against pure logic (RBAC matrix, zod schemas, classifier, port allocator, mappers) and as integration tests against real boundaries that already have harnesses (pg via testcontainers/ephemeral schema for db package; Fastify `inject()` for api routes; jsdom + Testing Library for web smoke). Coverage measured by the existing `scripts/coverage.mjs` runner. No CI gating, no source refactors purely for testability, no new `any` in production code.

## Technical Context

**Language/Version**: TypeScript 5.x on Node ≥20 (per repo `engines`)

**Primary Dependencies**: vitest (already present in all 10 packages); Fastify `inject()` for api route tests; `@testing-library/react` + jsdom for web smoke (apps/web already has `vitest.config.ts`); existing `tests/helpers/` patterns in `apps/api/tests/helpers/`.

**Storage**: Postgres 16 — db-package integration tests use the existing migration-runner harness (pattern already in `packages/db/tests/migration-idempotency.test.ts`); api integration tests reuse the existing per-instance pg helper pattern with mocked containers where realistic.

**Testing**: vitest unit + integration; coverage via v8 provider through `pnpm test:coverage` (`scripts/coverage.mjs`).

**Target Platform**: Local dev + maintainer machines; CI runs via existing `pnpm test`. No live VM dependency in any new test.

**Project Type**: Monorepo (pnpm workspaces). Five target packages this feature touches; three packages explicitly off-limits except for regression-guard.

**Performance Goals**: Each affected package's `vitest run` completes in under 2 minutes locally (SC-007).

**Constraints**:
- Zero new `any` in production source (FR-006, SC-006).
- No new tooling dependencies beyond what each package already declares (FR-009).
- Tests do not depend on live external services (Docker daemon, real network).
- Existing `tests/cli-e2e/*.sh` unchanged (Out of Scope).

**Scale/Scope**: ~5 packages, ~30–60 new test files estimated; covers RBAC matrix (~30+ actions), zod schema set (~20+ schemas), `/v1/*` handlers (~15+ routes), 4 worker jobs + classifier, 2 db modules, 3 web pages.

## Constitution Check

*Constitution file (`.specify/memory/constitution.md`) is the unfilled template — no ratified principles to evaluate.* No gates to check; no violations to justify. Complexity Tracking table omitted.

## Project Structure

### Documentation (this feature)

```text
specs/015-test-coverage-uplift/
├── plan.md              # This file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── coverage-targets.md   # Phase 1 — measurable per-package targets
└── tasks.md             # /speckit-tasks output (not yet created)
```

### Source Code (test files added under existing packages)

```text
packages/shared/
└── tests/
    ├── rbac.test.ts                  # truth-table assertions for every (role, action)
    ├── schemas.test.ts               # zod schemas: accept + reject cases
    ├── mgmt-api-schemas.test.ts      # /v1/* request/response shapes
    ├── oauth-schemas.test.ts         # oauth payload validation
    ├── state-machine.test.ts         # transition table assertions
    ├── errors.test.ts                # error class shape
    └── reserved-secrets.test.ts      # reserved-keys lookup

apps/api/
└── tests/
    ├── unit/
    │   ├── services/
    │   │   ├── mgmt-api-mapping.test.ts
    │   │   ├── multi-statement-detect.test.ts          # expand existing coverage
    │   │   ├── project-status-mapper.test.ts
    │   │   ├── env-field-mapper.test.ts
    │   │   └── oauth-pkce.test.ts
    │   └── plugins/
    │       ├── auth.test.ts                            # PAT validation paths
    │       ├── rbac.test.ts                            # authorize() decisions
    │       └── error-envelope.test.ts                  # /api/v1 + /v1 shapes
    └── integration/
        ├── v1-database-query.test.ts                   # /v1/.../database/query
        ├── v1-database-dump.test.ts
        ├── v1-cli-login-role.test.ts
        ├── v1-migrations.test.ts                       # list/repair/fetch
        ├── v1-gen-types.test.ts
        └── auth-rbac-matrix.test.ts                    # cross-route negative cases

apps/worker/
└── tests/
    └── unit/
        ├── jobs/
        │   ├── provision.test.ts                       # state-transition fixtures
        │   ├── pooler-reconciler.test.ts               # 7 drift classes
        │   ├── pg-edge-cert-issue.test.ts
        │   └── backup.test.ts
        └── classifier/
            └── pooler-drift.test.ts                    # pure classifier (extracted only if already pure)

packages/db/
└── tests/
    ├── migration-idempotency.test.ts                   # already exists — extend coverage of runner
    ├── port-allocator.test.ts                          # already exists — add concurrency cases
    └── migration-runner-internals.test.ts              # pure helpers in runner

apps/web/
└── tests/
    └── unit/
        ├── Login.test.tsx                              # render + submit smoke
        ├── Instances.test.tsx                          # list render + nav
        └── ProjectSecrets.test.tsx                     # render + add/edit smoke
```

**Structure Decision**: Each target package already has a `tests/` directory and a vitest config (web has `vitest.config.ts`; others inherit root vitest). New tests are colocated by package, mirroring the existing `unit/` and `integration/` conventions in `apps/api`. No new top-level directories. Shared helpers added under each package's `tests/helpers/` only when reused locally; cross-package helpers added under root `tests/helpers/` only if reused by ≥2 packages.

## Complexity Tracking

> No constitution violations — section intentionally empty.
