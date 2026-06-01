# Quickstart: Running the Pooler-Reconciler Tests

## Prerequisites

- Node.js ≥ 18 (the repo standard)
- `pnpm` installed (`npm i -g pnpm`)
- No live database, Docker, or VM required — all dependencies are mocked

## Run the tests

```sh
# From repo root
pnpm -C apps/worker test

# Or with watch mode during development
pnpm -C apps/worker test -- --watch

# Run only the reconciler test file
pnpm -C apps/worker test pooler-reconciler
```

## Expected output

```
✓ apps/worker/tests/unit/pooler-reconciler.test.ts (N tests) Xms
```

All tests should pass with zero external calls (no network, no DB connections).

## Verifying mock isolation

If any test makes a real network call or real DB connection, it will time out or throw a connection error. This is intentional — it catches mock gaps. If you see `ECONNREFUSED` or similar, check that `vi.mock('undici', ...)` and `vi.mock('@supastack/db', ...)` are wired before the SUT import.

## Test file location

```
apps/worker/tests/unit/pooler-reconciler.test.ts
```

## Pattern reference

See sibling test `apps/worker/tests/unit/pg-password-probe.test.ts` for the established `vi.mock` + dynamic import (`await import(...)`) pattern used in this worker test suite.
