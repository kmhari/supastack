# Coverage Targets Contract

The contract for this feature is the per-package coverage report produced by `pnpm test:coverage`. Targets are stated as **minimum statement coverage**. Other metrics (branch / funcs / lines) are tracked but not gated by this feature.

## Targets (must hit on `pnpm test:coverage`)

| Package | Baseline 2026-05-26 | Target | Direction |
|---|---|---|---|
| `packages/shared` | — (no tests) | ≥ 80% | new |
| `apps/api` | 40.98% | ≥ 70% | raise |
| `apps/worker` | 24.97% | ≥ 60% | raise |
| `packages/db` | 24.05% | ≥ 70% | raise |
| `apps/web` | 0.23% | ≥ 30% | raise |

## Regression guards (must NOT drop)

| Package | Baseline 2026-05-26 | Floor |
|---|---|---|
| `packages/oauth` | 98.25% | ≥ 95% |
| `packages/crypto` | 98.78% | ≥ 95% |
| `apps/mcp` | 65.42% | ≥ 65% |
| `packages/docker-control` | 62.52% | ≥ 60% |
| `packages/backup-store` | 56.49% | ≥ 55% |

## Verification

1. Run `pnpm test:coverage` from repo root.
2. Read the printed per-package table.
3. Confirm every Target row meets or exceeds its threshold.
4. Confirm every Regression-guard row meets or exceeds its floor.

## Out-of-contract

- No CI threshold enforcement is added (per spec Out of Scope).
- No `coverage.thresholds` config is added to vitest configs (per research.md decision).
- E2E shell scripts under `tests/cli-e2e/` are not part of this contract.
