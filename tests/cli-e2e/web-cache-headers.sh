#!/usr/bin/env bash
#
# web-cache-headers.sh — behavioral guard for issue #80 (stale dashboard
# bundle after a deploy). Boots the dashboard's PRODUCTION static server
# (apps/web/Caddyfile.runtime on the real caddy:2.8-alpine image) over a
# throwaway webroot and asserts the cache policy on the wire:
#
#   - index.html + SPA routes -> Cache-Control: no-cache  (revalidate every
#     load, so a new deploy is picked up on a NORMAL refresh)
#   - /assets/<hash>.*        -> immutable, ~1y max-age    (never stale: the
#     filename changes on every build)
#   - conditional GET on /    -> 304                       (revalidation cheap)
#
# Self-contained: needs only Docker + curl (no live VM, no full stack).
# The CI `unit tests` job covers the same contract statically via
# tests/integration/web-cache-headers.test.ts; this is the faithful
# on-the-wire check, runnable locally or on the VM.
#
#   bash tests/cli-e2e/web-cache-headers.sh
#   DOCKER="sudo docker" bash tests/cli-e2e/web-cache-headers.sh   # on the VM
#
# Requirements: Docker daemon running; curl.

set -euo pipefail

DOCKER="${DOCKER:-docker}"
PORT="${PORT:-8099}"
IMAGE="${CADDY_IMAGE:-caddy:2.8-alpine}"
NAME="supastack-web-cache-test-$$"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CADDYFILE="$ROOT/apps/web/Caddyfile.runtime"

[ -f "$CADDYFILE" ] || { echo "[FAIL] missing $CADDYFILE"; exit 1; }

SRV="$(mktemp -d)"
mkdir -p "$SRV/assets"
printf '<!doctype html><script type="module" src="/assets/index-TEST.js"></script>' > "$SRV/index.html"
echo 'console.log(1)' > "$SRV/assets/index-TEST.js"

cleanup() { $DOCKER rm -f "$NAME" >/dev/null 2>&1 || true; rm -rf "$SRV"; }
trap cleanup EXIT

$DOCKER run --rm -d --name "$NAME" -p "127.0.0.1:$PORT:80" \
  -v "$SRV:/srv:ro" \
  -v "$CADDYFILE:/etc/caddy/Caddyfile:ro" \
  "$IMAGE" >/dev/null

for _ in $(seq 1 20); do
  curl -fsS -o /dev/null "http://127.0.0.1:$PORT/" 2>/dev/null && break
  sleep 0.25
done

fail=0
check() { # <label> <path> <expected-substring-in-Cache-Control>
  local label="$1" path="$2" want="$3" got
  got="$(curl -sI "http://127.0.0.1:$PORT$path" | awk 'tolower($1)=="cache-control:"{sub(/^[^:]*: */,""); print; exit}' | tr -d '\r')"
  if [[ "$got" == *"$want"* ]]; then
    echo "[PASS] $label -> Cache-Control: $got"
  else
    echo "[FAIL] $label -> expected to contain '$want', got '${got:-<none>}'"
    fail=1
  fi
}

check "index.html (/)"           "/"                     "no-cache"
check "SPA route (/dashboard/x)" "/dashboard/x"          "no-cache"
check "hashed asset"             "/assets/index-TEST.js" "immutable"

etag="$(curl -sI "http://127.0.0.1:$PORT/" | awk 'tolower($1)=="etag:"{print $2}' | tr -d '\r')"
code="$(curl -s -o /dev/null -w '%{http_code}' -H "If-None-Match: $etag" "http://127.0.0.1:$PORT/")"
if [[ "$code" == "304" ]]; then
  echo "[PASS] conditional GET on / -> 304"
else
  echo "[FAIL] conditional GET on / -> $code (want 304)"; fail=1
fi

if [[ "$fail" -eq 0 ]]; then echo "ALL PASS"; else echo "FAILURES PRESENT"; fi
exit "$fail"
