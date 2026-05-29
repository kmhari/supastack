# Contract: Test-Collection Dormancy Guard

`scripts/check-test-collection.mjs` — invoked by `pnpm lint` (and runnable directly: `node scripts/check-test-collection.mjs`).

## Inputs

- The repo working tree. No arguments. No environment required.

## Behavior

1. Enumerate candidate test files: glob `**/*.{test,spec}.{ts,tsx}`, excluding `**/node_modules/**`, `**/dist/**`, and `**/tests/e2e/**` (Playwright; executed by the `e2e` job, not vitest).
2. A file is **collected** iff its path is under one of the collected roots: `packages/<name>/`, `apps/<name>/`, or the root `tests/` directory.
3. Any candidate not under a collected root is a **violation**.

## Output / exit codes

- **Exit 0** — every candidate is collected. Prints: `✓ all <N> test files are collected`.
- **Exit 1** — ≥1 violation. Prints **every** violation (not just the first), each as the file path + a one-line hint naming the expected home, e.g.:

  ```text
  ✗ uncollected test file: src/foo.test.ts
      → move it under a package (apps/<x>/ or packages/<x>/) or the root tests/ dir
  ```

## Guarantees

- Deterministic: no network, no Docker, no test execution.
- Fast: <1s on the current tree.
- Shape mirrors `apps/web/scripts/check-page-coverage.mjs` (feature 021) — the same self-maintaining-floor pattern wired into `pnpm lint`.

## Acceptance (negative test → SC-004)

- Add `bogus.test.ts` at the repo root (outside any collected root) → `pnpm lint` exits 1 naming `bogus.test.ts`.
- Remove/move it under `tests/` → `pnpm lint` exits 0.
