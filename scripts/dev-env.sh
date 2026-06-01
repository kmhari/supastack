#!/usr/bin/env bash
# dev-env.sh — recover supastack control-plane secrets from running containers.
#
# Usage:
#   bash scripts/dev-env.sh               # print to stdout
#   source <(bash scripts/dev-env.sh)     # export directly into current shell
#   bash scripts/dev-env.sh > recovered.env && chmod 600 recovered.env
#
# Requires: docker CLI, running supastack containers.
set -Eeuo pipefail

if ! command -v docker >/dev/null 2>&1; then
  echo "ERROR: docker CLI not found. Install Docker and retry." >&2
  exit 1
fi

_extract() {
  local container="$1" var="$2"
  docker inspect "$container" --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep "^${var}=" | head -1 | cut -d= -f2-
}

# Verify at least one supastack container is running
if ! docker inspect supastack-api-1 >/dev/null 2>&1 && ! docker inspect supastack-supavisor-1 >/dev/null 2>&1; then
  echo "ERROR: No supastack containers found (supastack-api-1, supastack-supavisor-1). Start the stack first." >&2
  exit 1
fi

echo "# Supastack control-plane secrets — recovered $(date -u +%FT%TZ)" >&2
echo "# Source: docker inspect from running containers" >&2
echo "" >&2

_emit() {
  local var="$1" value="$2"
  if [[ -n "$value" ]]; then
    printf 'export %s=%s\n' "$var" "$value"
  else
    printf '# WARNING: %s not found in containers\n' "$var" >&2
  fi
}

# Secrets from the API container
MASTER_KEY=$(_extract supastack-api-1 MASTER_KEY)
SESSION_SECRET=$(_extract supastack-api-1 SESSION_SECRET)
CONTROL_DB_PASSWORD=$(_extract supastack-api-1 CONTROL_DB_PASSWORD 2>/dev/null || \
  # DATABASE_URL fallback: postgres://supastack:<password>@db:5432/supastack
  docker inspect supastack-api-1 --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null \
    | grep "^DATABASE_URL=" | head -1 | sed 's|.*://[^:]*:\([^@]*\)@.*|\1|')
SUPAVISOR_API_JWT_SECRET=$(_extract supastack-api-1 SUPAVISOR_API_JWT_SECRET)

# Secrets from the Supavisor container (different env var names inside the container)
SUPAVISOR_SECRET_KEY_BASE=$(_extract supastack-supavisor-1 SECRET_KEY_BASE)
SUPAVISOR_VAULT_ENC_KEY=$(_extract supastack-supavisor-1 VAULT_ENC_KEY)

_emit MASTER_KEY             "$MASTER_KEY"
_emit SESSION_SECRET         "$SESSION_SECRET"
_emit CONTROL_DB_PASSWORD    "$CONTROL_DB_PASSWORD"
_emit SUPAVISOR_SECRET_KEY_BASE "$SUPAVISOR_SECRET_KEY_BASE"
_emit SUPAVISOR_VAULT_ENC_KEY   "$SUPAVISOR_VAULT_ENC_KEY"
_emit SUPAVISOR_API_JWT_SECRET  "$SUPAVISOR_API_JWT_SECRET"

# Also print SUPASTACK_APEX if set in the API container
SUPASTACK_APEX=$(_extract supastack-api-1 SUPASTACK_APEX)
if [[ -n "$SUPASTACK_APEX" ]]; then
  _emit SUPASTACK_APEX "$SUPASTACK_APEX"
fi
