# Tests

Per-package tests live under each package's own `tests/` directory. This top-level `tests/` dir holds **cross-cutting tests that belong to no single package**: the `integration/` vitest project (node env, collected by `pnpm test` — feature 023) and the `cli-e2e/` shell scripts (manual-only), plus shared helpers that genuinely span ≥2 packages.

## Conventions

- **Helper location**: package-local helpers go under `<package>/tests/helpers/`. Promote to `tests/helpers/` here only when ≥2 packages reuse the helper as-is.
- **No new `any` in production code**: `eslint.config.js` exempts `**/tests/**` from `@typescript-eslint/no-explicit-any`. The rule still applies to production source. If a test needs `as any` to satisfy a typed callback shape, that's fine; do **not** weaken types in production code to make a test simpler.
- **Unit > integration > E2E**: prefer unit tests where practical (see `specs/015-test-coverage-uplift/spec.md` FR-007). Use integration tests only when a unit test would be a tautology or when behavior crosses a real boundary (DB, filesystem, container runtime).
- **Coverage runner**: the canonical command is `pnpm test:coverage` (see `scripts/coverage.mjs`). Per-package iteration: `pnpm --filter <pkg> exec vitest run --coverage`.
- **No new test runners or coverage providers**: vitest + v8 across the monorepo. Adding Jest, Playwright, testcontainers, c8, nyc, etc. requires a separate spec.
- **Every test file must be collected** (feature 023): `scripts/check-test-collection.mjs` (wired into `pnpm lint`) fails if a `*.test.ts` lands where no vitest project collects it. Collected roots: `packages/*`, `apps/*`, and root `tests/`.

## Integration & infra-contract tests (`tests/`)

The root `tests/` directory is a vitest project — `tests/vitest.config.ts`, **node** environment — registered in `vitest.workspace.ts`, so it is collected by `pnpm test`. Put a test here when it is **not** a single-package unit test:

| Kind                                              | Home                 | Runs                                                |
| ------------------------------------------------- | -------------------- | --------------------------------------------------- |
| Integration (spans packages / needs a live stack) | `tests/integration/` | `pnpm test`; **skipped** when live-stack env absent |
| Infra-contract (asserts a built artifact/config)  | `tests/` (node env)  | `pnpm test`                                         |
| Behavioral container check (docker + curl)        | `tests/cli-e2e/*.sh` | **manual-only**                                     |

Adding one:

```ts
import { describe, expect, test } from 'vitest';
// node env — fs / import.meta.url work directly, no `// @vitest-environment node` needed.
```

- **Live-stack integration tests** — `tests/integration/{backup,backup-retention,provision-instance}.test.ts` are gated on `TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF` and report **skipped** when unset (visible, not dormant). Executing them in CI is tracked in **#91** (blocked on the env solution **#75**).
- **Behavioral `.sh` checks** — `tests/cli-e2e/*.sh` are manual-only (run locally or on the VM, e.g. `bash tests/cli-e2e/web-cache-headers.sh`); their CI net is an equivalent collected vitest contract test.
- **Dispositions (feature 023)** — the cache-header contract test stays in `apps/web/tests/unit/` (web-adjacent, already collected), not relocated here; no Docker-backed CI job is added.

## Layout cheat-sheet

```
apps/api/tests/{unit,integration,helpers}/    # Fastify inject() helpers in helpers/mgmt-api.ts
apps/worker/tests/unit/                       # mocks at the import seam
apps/web/tests/unit/                          # jsdom + @testing-library/react (cache-header contract test lives here)
packages/shared/tests/                        # pure unit tests
packages/db/tests/                            # real Postgres via DATABASE_URL
tests/integration/                            # node-env vitest project (feature 023); live-stack tests skip when env absent
tests/cli-e2e/                                # shell scripts against live VM (manual-only, out of coverage scope)
```

## Active feature

See [specs/015-test-coverage-uplift/](../specs/015-test-coverage-uplift/) for per-package coverage targets, and [specs/023-integration-test-home/](../specs/023-integration-test-home/) for the integration-test home + dormancy guard.
