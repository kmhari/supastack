#!/usr/bin/env bash
# dump-routes.sh — write an exact manifest of every route the api registers.
#
# Boots the real `buildApp()` with SUPASTACK_DUMP_ROUTES set, so the manifest
# comes from Fastify's own `onRoute` hook at registration time. That is the only
# accurate source: `printRoutes()` silently omits wildcard routes (the four
# proxies in platform-proxy.ts answer requests but never appear in its tree), and
# grepping for path literals misses anything built from a template or mounted
# under a prefix.
#
# buildApp() runs migrations, so it needs a real Postgres + Redis. With no
# DUMP_DATABASE_URL this spins up disposable containers and removes them after,
# same shape as scripts/test-integration.sh.
#
# Usage:
#   scripts/studio-sync/dump-routes.sh [out.json]        # default: route-manifest.json
#   DUMP_DATABASE_URL=postgres://… DUMP_REDIS_URL=redis://… scripts/studio-sync/dump-routes.sh
#
# Exit: 0 manifest written | non-zero on boot failure

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUT="${1:-$REPO_ROOT/route-manifest.json}"
PG_CONTAINER="supastack-dump-routes-pg"
REDIS_CONTAINER="supastack-dump-routes-redis"
PG_PORT="${DUMP_PG_PORT:-55433}"
REDIS_PORT="${DUMP_REDIS_PORT:-56380}"
started_containers=0

cleanup() {
  if [ "$started_containers" -eq 1 ]; then
    echo "[dump-routes] removing disposable containers"
    docker rm -f "$PG_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

if [ -z "${DUMP_DATABASE_URL:-}" ]; then
  command -v docker >/dev/null || {
    echo "FATAL: docker not found and DUMP_DATABASE_URL not set" >&2
    exit 2
  }
  echo "[dump-routes] spinning up postgres:16 on $PG_PORT and redis:7 on $REDIS_PORT..."
  docker rm -f "$PG_CONTAINER" "$REDIS_CONTAINER" >/dev/null 2>&1 || true
  docker run -d --name "$PG_CONTAINER" \
    -e POSTGRES_PASSWORD=pg -e POSTGRES_DB=supastack \
    -p "$PG_PORT:5432" postgres:16 >/dev/null
  docker run -d --name "$REDIS_CONTAINER" -p "$REDIS_PORT:6379" redis:7 >/dev/null
  started_containers=1

  export DUMP_DATABASE_URL="postgres://postgres:pg@127.0.0.1:$PG_PORT/supastack"
  export DUMP_REDIS_URL="redis://127.0.0.1:$REDIS_PORT"

  echo -n "[dump-routes] waiting for postgres"
  for _ in $(seq 1 30); do
    if docker exec "$PG_CONTAINER" pg_isready -U postgres >/dev/null 2>&1; then break; fi
    echo -n "."
    sleep 1
  done
  echo
fi

export SUPASTACK_DUMP_ROUTES="$OUT"
cd "$REPO_ROOT/apps/api"
npx tsx "$REPO_ROOT/scripts/studio-sync/boot-for-dump.mts"

echo "[dump-routes] wrote $OUT ($(node -e "console.log(require('$OUT').length)") route+method entries)"
