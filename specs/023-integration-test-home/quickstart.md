# Quickstart: Integration-Test Home

## Where does my test go?

- **Unit test** for one package → that package's own test dir (`apps/<x>/tests/`, `packages/<x>/...`). Runs in `pnpm test`.
- **Integration test** (spans packages / needs a live stack) → `tests/integration/`. Runs in `pnpm test`; **skips** if live-stack env (`TEST_API_URL` / `TEST_TOKEN_ADMIN` / `TEST_INSTANCE_REF`) is absent.
- **Infra-contract test** (asserts a built artifact/config) → root `tests/` (node env — no `// @vitest-environment` needed). Runs in `pnpm test`.
- **Behavioral container check** (docker + curl) → `tests/cli-e2e/*.sh`. **Manual-only**; pair it with a vitest contract test for the CI guard.
- **Dashboard browser test** → `apps/web/tests/e2e/` (Playwright; the `e2e` job).

## Add an integration / contract test

1. Create `tests/integration/my-thing.test.ts` (or `tests/my-contract.test.ts`).
2. `import { describe, expect, test } from 'vitest'` — node env, so `fs` / `import.meta.url` work directly (no env-override comment).
3. `pnpm test` → it runs. No `pnpm --filter` needed.

## Verify the feature

- `pnpm test` shows a `tests/` project; `tests/integration/*` report as **skipped** (not absent) when live-stack env is unset. → SC-001, FR-005.
- Drop a `bogus.test.ts` at the repo root → `pnpm lint` **fails** naming it. Remove it → `pnpm lint` passes. → SC-004, FR-006.
- `cat tests/README.md` → the "which test goes where" convention is documented. → FR-009, SC-005.

## Out of scope (tracked elsewhere)

- Actually executing the env-gated `tests/integration/*` in CI → **#91** (blocked on the env solution **#75**).
- A Docker-backed CI job for the `.sh` behavioral checks → not planned (manual-only by decision, clarify Q3).
- Relocating the cache-header contract test → not done (stays in `apps/web/tests/unit`, clarify Q4).
