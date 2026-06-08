# Quickstart: Running the Test Suites

## Suite 1 — Unit + Fake-Upstream (no infrastructure needed)

```bash
# Run all api unit tests including fake-upstream and new management route tests
pnpm --filter @supastack/api test

# Run only the new test files
pnpm --filter @supastack/api test -- --reporter=verbose \
  platform-proxy-fake-upstream gen-types migrations postgrest-config \
  platform-projects platform-access-tokens platform-misc-routes
```

These tests complete in under 30 seconds with zero network calls.

## Suite 2 — Migration Idempotency (local Postgres container)

```bash
# Spins up postgres:16 automatically, tears down after
pnpm test:integration
```

Or bring your own DB:
```bash
TEST_DATABASE_URL=postgres://postgres:test@localhost:5433/test_migrations pnpm test:integration
```

## Suite 3 — VM Proxy Smoke Tests (live VM required)

Set the following env vars before running:

```bash
export TEST_API_URL=https://api.supaviser.dev
export TEST_TOKEN_ADMIN=<admin-pat>
export TEST_INSTANCE_REF=<healthy-project-ref>
export TEST_FAILED_INSTANCE_REF=<failed-project-ref>   # optional

pnpm test:integration
```

Without these env vars, the smoke tests skip automatically — safe for CI.

## Environment Variables Reference

| Var | Required for | Description |
|-----|-------------|-------------|
| `TEST_DATABASE_URL` | Migration idempotency | Postgres connection string |
| `TEST_API_URL` | VM smoke | Base URL, e.g. `https://api.supaviser.dev` |
| `TEST_TOKEN_ADMIN` | VM smoke | Admin PAT (`sbp_…`) |
| `TEST_INSTANCE_REF` | VM smoke | Healthy project ref (6-char alphanum) |
| `TEST_FAILED_INSTANCE_REF` | VM smoke (optional) | Failed/crashed project ref |
| `TEST_KONG_BASE_URL` | Fake-upstream (set by tests) | Overrides Kong base URL; not set by humans |
