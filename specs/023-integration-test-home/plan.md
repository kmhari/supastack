# Implementation Plan: A CI-Enforced Home for Integration & Infra-Contract Tests

**Branch**: `023-integration-test-home` | **Date**: 2026-05-29 | **Spec**: [spec.md](spec.md)

**Input**: Feature specification from `/specs/023-integration-test-home/spec.md`

## Summary

Give integration and infra-contract tests a single CI-collected home so they stop being dormant or shoehorned. Concretely: add a **node-environment vitest project rooted at the repo-level `tests/` directory** to `vitest.workspace.ts` (so the existing `tests/integration/*` and future cross-cutting tests are collected by `pnpm test`); add a **dormancy guard** (`scripts/check-test-collection.mjs`) wired into `pnpm lint` that fails when any `*.test.ts` sits in a location no project collects; and **document the test-location convention** in `tests/README.md`. No test framework, dependency, or CI job is added. The 3 env-gated orphan tests become collected-but-skipped (execution tracked in #91, blocked on #75); the cache-header contract test stays in `apps/web/tests/unit`; behavioral `.sh` checks stay manual-only.

## Technical Context

**Language/Version**: TypeScript 5.9 (ESM), Node 20

**Primary Dependencies**: vitest 2.1.x (existing workspace), pnpm workspaces — **no new dependencies**

**Storage**: N/A (test infrastructure; reads repository files)

**Testing**: vitest (workspace projects); behavioral shell scripts under `tests/cli-e2e/` (manual-only)

**Target Platform**: CI (GitHub Actions — existing `guardrails` + `unit tests` jobs) and local dev (macOS/Linux)

**Project Type**: pnpm monorepo (`apps/*` + `packages/*`, plus a new root `tests/` project)

**Performance Goals**: added collection runs inside the existing fast test job (pure / file-reading tests, sub-second); guard adds <1s to `pnpm lint`

**Constraints**: reuse the vitest workspace + existing CI jobs; node env for the root project (no per-file `// @vitest-environment` overrides); no Docker added to the fast test job

**Scale/Scope**: 1 new vitest project config, 1 new guard script, 1 new doc, 1 workspace edit, 1 `lint` script edit; 3 orphan tests become collected; 0 tests relocated

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

The project constitution (`.specify/memory/constitution.md`) is the unpopulated template — no ratified principles. Gates are evaluated against the documented conventions in `CLAUDE.md`:

- **Tests prefer pure functions where possible** → PASS (guard + contract logic is pure: globs/reads files, no side effects).
- **`any` allowed only in tests** → N/A (no production `any` introduced).
- **Simplicity / reuse over new infra** → PASS (reuses vitest workspace + existing CI jobs; no new framework, CI job, or dependency).
- **Migrations / RBAC / secrets conventions** → N/A (no DB, API, or secrets touched).
- **Self-maintaining coverage precedent** (feature 021's `apps/web/scripts/check-page-coverage.mjs` in `pnpm lint`) → FOLLOWED (the dormancy guard mirrors it).

No violations. **Complexity Tracking: empty.**

## Project Structure

### Documentation (this feature)

```text
specs/023-integration-test-home/
├── plan.md              # this file
├── research.md          # Phase 0
├── data-model.md        # Phase 1
├── quickstart.md        # Phase 1
├── contracts/
│   └── test-collection-guard.md   # Phase 1
└── checklists/requirements.md
```

### Source Code (repository root)

```text
tests/
├── vitest.config.ts          # NEW — node-env project; include tests/**/*.{test,spec}.ts
├── README.md                 # NEW — "which test goes where" convention
├── integration/              # EXISTING — now collected (skipped when live-stack env absent)
│   ├── backup.test.ts
│   ├── backup-retention.test.ts
│   └── provision-instance.test.ts
└── cli-e2e/                  # EXISTING — behavioral .sh, manual-only (documented in README)
    └── *.sh

vitest.workspace.ts            # MODIFIED — add the tests/ project to the workspace
package.json                   # MODIFIED — `lint` also runs the dormancy guard
scripts/
└── check-test-collection.mjs  # NEW — dormancy guard (mirrors scripts/coverage.mjs + apps/web check-page-coverage.mjs)

# UNCHANGED
apps/web/tests/unit/web-cache-headers.test.ts   # cache-header contract test stays here (clarify Q4)
.github/workflows/ci.yml                         # no edit — `unit tests` runs pnpm test; `guardrails` runs pnpm lint
```

**Structure Decision**: monorepo with a new root `tests/` vitest project added to the existing `vitest.workspace.ts`. Lowest-churn way to collect the dormant root tests and give cross-cutting tests a node-env home; the dormancy guard (a root `scripts/*.mjs` wired into `pnpm lint`, mirroring `apps/web/scripts/check-page-coverage.mjs`) prevents regression. No CI workflow edit is needed because `unit tests` already runs `pnpm test` and `guardrails` already runs `pnpm lint`.

## Complexity Tracking

No constitution violations — section intentionally empty.
