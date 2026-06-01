#!/usr/bin/env bash
# deploy.sh — deploy mock API + rebuild Studio with IS_PLATFORM=true on the VM
# Usage: ./deploy.sh [VM_HOST]
# Requires: ssh access to VM, /opt/supabase-vanilla already cloned

set -euo pipefail

VM=${1:-ubuntu@148.113.1.164}
VANILLA=/opt/supabase-vanilla
MOCK_DIR=/opt/studio-mock-api

echo "=== 1. Rsync mock server to VM ==="
rsync -az --delete \
  "$(dirname "$0")/" \
  "$VM:$MOCK_DIR/"

echo "=== 2. Install mock server deps ==="
ssh "$VM" "cd $MOCK_DIR && npm install --omit=dev 2>&1 | tail -3"

echo "=== 3. Expose pg-meta on host port 8081 (if not already) ==="
ssh "$VM" "
  if ! grep -q '8081:8080' $VANILLA/docker/docker-compose.yml; then
    sudo sed -i '/container_name: supabase-meta/{n;/ports:/!{i\    ports:\n      - \"8081:8080\"
}}' $VANILLA/docker/docker-compose.yml
    # simpler approach: use python to add ports to meta service
    sudo python3 -c \"
import re, sys
txt = open('$VANILLA/docker/docker-compose.yml').read()
# Add port to supabase-meta container
txt = re.sub(
    r'(container_name: supabase-meta\n)',
    r'\1    ports:\n      - \"8081:8080\"\n',
    txt
)
open('$VANILLA/docker/docker-compose.yml', 'w').write(txt)
print('patched docker-compose.yml for pg-meta port')
\"
    cd $VANILLA/docker && sudo docker compose up -d meta
    sleep 3
  else
    echo 'pg-meta port already exposed'
  fi
"

echo "=== 4. Read keys from vanilla .env ==="
ENV_VALS=$(ssh "$VM" "grep -E '^(SERVICE_ROLE_KEY|ANON_KEY)=' $VANILLA/docker/.env | head -2")
SERVICE_KEY=$(echo "$ENV_VALS" | grep SERVICE_ROLE_KEY | cut -d= -f2-)
ANON_KEY=$(echo "$ENV_VALS" | grep '^ANON_KEY=' | cut -d= -f2-)
echo "SERVICE_KEY length: ${#SERVICE_KEY}"

echo "=== 5. Patch Studio source: alwaysLoggedIn=true + remove isPlatform email gate ==="
ssh "$VM" "
  # auth.tsx: bypass cloud login
  sudo sed -i 's/alwaysLoggedIn={!IS_PLATFORM}/alwaysLoggedIn={true}/' $VANILLA/apps/studio/lib/auth.tsx
  grep -n 'alwaysLoggedIn' $VANILLA/apps/studio/lib/auth.tsx

  # AuthLayout.utils.ts: remove isPlatform gate on emails nav
  sudo sed -i 's/features\\.emails && isPlatform/features.emails/' $VANILLA/apps/studio/components/layouts/AuthLayout/AuthLayout.utils.ts
  grep -n 'features.emails' $VANILLA/apps/studio/components/layouts/AuthLayout/AuthLayout.utils.ts
"

echo "=== 6. Add NEXT_PUBLIC_API_URL build arg to Studio Dockerfile ==="
ssh "$VM" "
  if ! grep -q 'NEXT_PUBLIC_API_URL' $VANILLA/apps/studio/Dockerfile; then
    sudo sed -i '/^ARG NEXT_PUBLIC_IS_PLATFORM/a ARG NEXT_PUBLIC_API_URL=http://localhost:4000\nENV NEXT_PUBLIC_API_URL=\$NEXT_PUBLIC_API_URL' $VANILLA/apps/studio/Dockerfile
  fi
  grep -n 'NEXT_PUBLIC' $VANILLA/apps/studio/Dockerfile | head -8
"

echo "=== 7. Build Studio image with IS_PLATFORM=true ==="
ssh "$VM" "
  cd $VANILLA && sudo docker build . \
    -f apps/studio/Dockerfile \
    --target production \
    -t studio-platform:latest \
    --build-arg NEXT_PUBLIC_IS_PLATFORM=true \
    --build-arg NEXT_PUBLIC_API_URL=http://148.113.1.164:4000 \
    2>&1 | tail -10
"

echo "=== 8. Update docker-compose to use new image ==="
ssh "$VM" "
  sudo sed -i 's|image: supabase/studio:.*|image: studio-platform:latest|' $VANILLA/docker/docker-compose.yml
  grep 'image:' $VANILLA/docker/docker-compose.yml | head -3
"

echo "=== 9. Restart Studio ==="
ssh "$VM" "cd $VANILLA/docker && sudo docker compose up -d studio && sleep 5 && sudo docker ps --filter name=supabase-studio --format '{{.Names}}\t{{.Status}}'"

echo "=== 10. Start mock API (kills existing if running) ==="
ssh "$VM" "
  pkill -f 'node $MOCK_DIR/server.js' 2>/dev/null || true
  SERVICE_KEY='$SERVICE_KEY' ANON_KEY='$ANON_KEY' \
  nohup node $MOCK_DIR/server.js > /tmp/studio-mock-api.log 2>&1 &
  sleep 2
  curl -s http://localhost:4000/platform/profile | python3 -c 'import json,sys; d=json.load(sys.stdin); print(\"mock OK:\", d[\"username\"])'
"

echo ""
echo "=== DONE ==="
echo "Studio:    http://148.113.1.164:3000/project/localproject/auth/templates"
echo "Mock API:  http://148.113.1.164:4000/platform/profile"
echo "Mock logs: ssh $VM 'tail -f /tmp/studio-mock-api.log'"
