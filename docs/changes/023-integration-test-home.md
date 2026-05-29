# 023 — A CI-enforced home for integration & infra-contract tests

**Origin**: spun out of #80 / PR #90 (the dashboard cache-header fix needed a home for its contract test). Spec/plan: `specs/023-integration-test-home/`.

## Problem

`vitest.workspace.ts` collected only `packages/*` and `apps/*`, so root `tests/integration/*.test.ts` (backup, backup-retention, provision-instance) were **never executed by CI** — dormant, and nobody noticed because they're `describe.skipIf`-gated. Infra-contract tests (e.g. asserting the production Caddyfile cache headers) had no proper home and got shoehorned into a package's jsdom unit suite with a `// @vitest-environment node` override.

## What changed

- **`tests/vitest.config.ts`** (new) — a **node**-environment vitest project rooted at the repo-level `tests/` dir.
- **`vitest.workspace.ts`** — adds `./tests/vitest.config.ts` to the workspace, so `pnpm test` now collects `tests/integration/*` and any new cross-cutting / infra-contract test under `tests/`.
- **`scripts/check-test-collection.mjs`** (new) — dormancy guard: fails `pnpm lint` if any `*.test.ts` sits where no vitest project collects it. Collected roots: `packages/*`, `apps/*`, `tests/`. Excludes (mirroring `vitest.config.ts`): `tests/e2e` (Playwright), `theme/`, `infra/supabase-template/`.
- **`package.json`** — `lint` now also runs the guard.
- **`tests/README.md`** — documents which test goes where + the dispositions below.

## Behavior now

- The 3 live-stack integration tests are **collected and reported skipped** (their `skipIf` on missing `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF`) — visible, not dormant.
- `pnpm test` runs the new `integration` project; the guard confirms **140 test files** are all in collected locations.
- A misplaced test file fails `pnpm lint` with the offending path.

## Decisions (clarify session)

- Home = root `tests/` project (not a new package).
- Behavioral `.sh` checks stay **manual-only**; their CI net is a collected vitest contract test. No Docker CI job added.
- The cache-header contract test **stays** in `apps/web/tests/unit/` (not relocated).

## Follow-up

- **#91** — actually execute the env-gated `tests/integration/*` in CI (blocked on the control-plane env solution **#75**).

## Verify

- `pnpm test` → an `integration` project appears; `tests/integration/*` report skipped.
- `node scripts/check-test-collection.mjs` → `✓ all N test files are collected`; add a stray `bogus.test.ts` at the repo root → exits 1 naming it.
- `pnpm lint` → green (the guard runs in the chain).
