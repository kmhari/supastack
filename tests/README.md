# Tests

Per-package tests live under each package's own `tests/` directory. This top-level dir holds **only** cross-package E2E shell scripts (`cli-e2e/`) and shared helpers that genuinely span ≥2 packages.

## Conventions

- **Helper location**: package-local helpers go under `<package>/tests/helpers/`. Promote to `tests/helpers/` here only when ≥2 packages reuse the helper as-is.
- **No new `any` in production code**: `eslint.config.js` exempts `**/tests/**` from `@typescript-eslint/no-explicit-any`. The rule still applies to production source. If a test needs `as any` to satisfy a typed callback shape, that's fine; do **not** weaken types in production code to make a test simpler.
- **Unit > integration > E2E**: prefer unit tests where practical (see `specs/015-test-coverage-uplift/spec.md` FR-007). Use integration tests only when a unit test would be a tautology or when behavior crosses a real boundary (DB, filesystem, container runtime).
- **Coverage runner**: the canonical command is `pnpm test:coverage` (see `scripts/coverage.mjs`). Per-package iteration: `pnpm --filter <pkg> exec vitest run --coverage`.
- **No new test runners or coverage providers**: vitest + v8 across the monorepo. Adding Jest, Playwright, testcontainers, c8, nyc, etc. requires a separate spec.

## Layout cheat-sheet

```
apps/api/tests/{unit,integration,helpers}/    # Fastify inject() helpers in helpers/mgmt-api.ts
apps/worker/tests/unit/                       # mocks at the import seam
apps/web/tests/unit/                          # jsdom + @testing-library/react
packages/shared/tests/                        # pure unit tests
packages/db/tests/                            # real Postgres via DATABASE_URL
tests/cli-e2e/                                # shell scripts against live VM (out of coverage scope)
```

## Active feature

See [specs/015-test-coverage-uplift/](../specs/015-test-coverage-uplift/) for the current per-package coverage targets and contract.
