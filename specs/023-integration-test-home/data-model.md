# Phase 1 Data Model: Integration-Test Home

No runtime data store. The "entities" are the test-organization model the convention + guard enforce.

## Test category → home → execution

| Category | Definition | Home | Collected by | CI execution |
|---|---|---|---|---|
| **unit** | tests of one package's internals | that package's own test dir / co-located | `apps/*` & `packages/*` vitest projects | `unit tests` job (`pnpm test`) |
| **integration** | spans packages or needs a live stack | `tests/integration/` | new `tests/` vitest project | runs; **skipped** if live-stack env absent |
| **infra-contract** | asserts a property of a built artifact/config | root `tests/` (or owning package if web-adjacent) | `tests/` project (or owning package) | `unit tests` job |
| **behavioral-e2e (container)** | drives real containers via shell | `tests/cli-e2e/*.sh` | not collected by vitest | **manual-only** (documented); CI net = a contract test |
| **browser-e2e** | Playwright dashboard tests | `apps/web/tests/e2e/` | Playwright | separate `e2e` job |

## Guard model (`scripts/check-test-collection.mjs`)

- **Input set**: `**/*.{test,spec}.{ts,tsx}` minus `node_modules`, `dist`, `**/tests/e2e/**` (Playwright — run by the `e2e` job, not vitest).
- **Collected roots**: `packages/*/`, `apps/*/`, root `tests/`.
- **Rule**: every input file MUST be under a collected root; otherwise it is a violation.
- **Output contract**: see [contracts/test-collection-guard.md](contracts/test-collection-guard.md).

## States

- A test file is **collected** (under a collected root) or **dormant** (not). The guard makes `dormant` impossible to commit (FR-006).
- A collected test is **executed** or **skipped** (env-gated). Both appear in the run summary; **dormant** is invisible — the failure mode this feature eliminates (FR-005, SC-001).

## Invariants

- INV-1: ∀ test file → collected (enforced by the guard).
- INV-2: the `tests/` project runs in `node` env, so no collected file there needs a `// @vitest-environment` override (FR-003).
- INV-3: no test category requires a Docker-backed CI job (FR-008; behavioral checks are manual-only).
