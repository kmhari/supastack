# Phase 0 Research: Integration-Test Home

All open product questions were resolved in the `/speckit-clarify` session (see spec → Clarifications). No `NEEDS CLARIFICATION` remain. This records the technical decisions and rationale.

## D1 — How to add the root `tests/` project to the vitest workspace

**Decision**: Add a project rooted at `tests/` via a new `tests/vitest.config.ts` referenced from `vitest.workspace.ts`, with `environment: 'node'` and `include: ['**/*.{test,spec}.ts']`.

**Rationale**: The workspace `defineWorkspace(['packages/*', 'apps/*'])` never scans root `tests/` — the direct cause of the dormancy. A dedicated config file keeps the node-env setting explicit and matches how `apps/web` carries `apps/web/vitest.config.ts`. Node env removes the `// @vitest-environment node` workaround that the cache-header test needed under jsdom.

**Alternatives**: (a) inline project object in `vitest.workspace.ts` — works, but a config file is more discoverable and consistent with per-package configs; (b) widen the glob to include `'tests'` — only takes effect if `tests/` has a config anyway; (c) dedicated `packages/integration-tests` package — rejected in clarify Q1 (extra scaffolding, ships no code).

## D2 — Relationship to the existing root `vitest.config.ts`

**Decision**: Leave the root `vitest.config.ts` in place; treat `vitest.workspace.ts` as authoritative and document that a workspace file supersedes the root config for `vitest run`.

**Rationale**: When both exist, vitest uses the workspace and ignores the root config's `include` — exactly why `tests/integration/*` was dormant. Removing the root config risks breaking a `--config`-based invocation; once the workspace collects `tests/`, the root config is harmless.

**Alternatives**: delete the root `vitest.config.ts` (conceptually cleaner, but unnecessary churn + possible escape-hatch regression).

## D3 — Dormancy guard mechanism

**Decision**: `scripts/check-test-collection.mjs` globs all `*.{test,spec}.{ts,tsx}` (excluding `node_modules`, `dist`, and `**/tests/e2e/**`) and fails if any file is outside the collected roots (`packages/*`, `apps/*`, `tests/`), printing each offending path + the expected home. Wire into `pnpm lint`.

**Rationale**: Mirrors the established `apps/web/scripts/check-page-coverage.mjs` precedent wired into `pnpm lint` (feature 021). Encoding the workspace roots is simple, deterministic, fast, and needs no test execution.

**Alternatives**: parse `vitest.workspace.ts` (brittle); run `vitest list --json` and diff (heavier, slower, flake risk).

## D4 — Disposition of existing tests (from clarify)

- Orphaned `tests/integration/*` → collected by D1; report **skipped** when live-stack env is absent (their existing `describe.skipIf`). Executing them in CI is tracked in **#91** (blocked on **#75**).
- Cache-header contract test → **stays** in `apps/web/tests/unit` (already collected; web-adjacent; shipped in PR #90).
- Behavioral `.sh` → **manual-only**, documented in `tests/README.md`; CI safety net is the collected vitest contract test.

## D5 — CI wiring

**Decision**: No `.github/workflows/ci.yml` change. `unit tests` already runs `pnpm test` (now includes the `tests/` project); `guardrails` already runs `pnpm lint` (now includes the guard).

**Rationale**: FR-002 / FR-006 satisfied by existing jobs; FR-008 satisfied (no Docker job added).
