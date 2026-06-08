#!/usr/bin/env bash
# Run migration idempotency and other integration tests against a real Postgres.
#
# Usage:
#   pnpm test:integration
#   TEST_DATABASE_URL=postgres://... pnpm test:integration   # bring your own DB
#
# With no TEST_DATABASE_URL, spins up a disposable postgres:16 container on
# port 5433, runs the tests, then tears it down.

set -euo pipefail

CONTAINER=""
cleanup() {
  if [[ -n "$CONTAINER" ]]; then
    echo "[test-integration] stopping postgres container $CONTAINER"
    docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [[ -z "${TEST_DATABASE_URL:-}" ]]; then
  echo "[test-integration] spinning up postgres:16 on port 5433..."
  CONTAINER=$(docker run --rm -d \
    -e POSTGRES_PASSWORD=test \
    -e POSTGRES_DB=test_migrations \
    -p 5433:5432 \
    postgres:16)
  export TEST_DATABASE_URL="postgres://postgres:test@localhost:5433/test_migrations"

  # wait for PG to be ready (up to 15s)
  for i in $(seq 1 15); do
    if docker exec "$CONTAINER" pg_isready -U postgres -d test_migrations >/dev/null 2>&1; then
      break
    fi
    sleep 1
  done
fi

echo "[test-integration] running integration tests against $TEST_DATABASE_URL"
vitest run tests/integration/ --reporter=verbose
