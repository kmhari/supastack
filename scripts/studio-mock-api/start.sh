#!/usr/bin/env bash
# Start the studio-mock-api server pointing at the vanilla Supabase stack.
# Run this on the VM before opening Studio in IS_PLATFORM=true mode.
#
# Usage: bash start.sh [/path/to/.env]
#   Listens on port 4000. Studio dev server must be running on port 3000.
#
# After starting, inject a session in the browser console:
#   (paste contents of inject-session.js)
# Then navigate to http://148.113.1.164:3000/project/localproject

set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${1:-/opt/supabase-vanilla/docker/.env}"

SVCKEY=$(sudo grep SERVICE_ROLE_KEY "$ENV_FILE" | cut -d= -f2)
ANON_KEY=$(sudo grep "^ANON_KEY" "$ENV_FILE" | cut -d= -f2)

# Docker bridge IPs for the vanilla Supabase stack
# Find dynamically if possible, else use known values
GOTRUE_IP=$(sudo docker inspect supabase-auth --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "192.168.80.7")
PG_META_IP=$(sudo docker inspect supabase-meta --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "192.168.80.8")
KONG_IP=$(sudo docker inspect kong-new --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}' 2>/dev/null || echo "192.168.80.13")

echo "GoTrue : http://$GOTRUE_IP:9999"
echo "pg-meta: http://$PG_META_IP:8080"
echo "Kong   : http://$KONG_IP:8000"

# Kill any existing instance
kill $(ss -tlnp 2>/dev/null | grep :4000 | grep -oP "pid=\K[0-9]+") 2>/dev/null || true
sleep 1

GOTRUE_DIRECT_URL="http://$GOTRUE_IP:9999" \
SERVICE_KEY="$SVCKEY" \
ANON_KEY="$ANON_KEY" \
PG_META_URL="http://$PG_META_IP:8080" \
KONG_URL="http://$KONG_IP:8000" \
PORT=4000 \
nohup node "$SCRIPT_DIR/server.js" > /tmp/mock-server.log 2>&1 &

echo "Mock API started on :4000 (pid=$!)"
echo "Logs: tail -f /tmp/mock-server.log"
echo ""
echo "Debug endpoints:"
echo "  http://148.113.1.164:4000/debug/summary   — all routes hit"
echo "  http://148.113.1.164:4000/debug/unhandled  — routes missing mocks"
