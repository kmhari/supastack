#!/usr/bin/env bash
#
# Supastack installer — bootstraps the control plane on a Linux host.
#
# Usage:  ./install.sh [apex-domain]      e.g.  ./install.sh supastack.example.com
#
# The apex domain is established HERE, at install (feature 117). After this
# finishes, the operator opens /setup to create the super-admin and follow the
# DNS steps for the domain — /setup does NOT ask for the domain again.
#
# Idempotent. Safe to re-run; existing data is preserved.
#
# Environment overrides:
#   INSTALL_DIR      where the repo lives (default: /opt/supastack)
#   DATA_DIR         host bind-mount root (default: /var/supastack)
#   SUPASTACK_APEX   apex domain, e.g. supastack.example.com. Resolution order:
#                    positional arg > this env > existing .env > prompt (/dev/tty,
#                    so curl|bash still prompts) > localhost (warned).
#   REPO_URL         git source (default: this repo's origin)
#   REPO_REF         git branch/tag/commit (default: main)
#   SUPASTACK_VERSION docker tag suffix for built images (default: dev)
#   STUDIO_IMAGE     prebuilt Studio image tag (default: supastack/studio:<commit>)
#   LOG_LEVEL        pino log level for api+worker (default: info)
#   SKIP_BUILD       set to 1 to skip image builds (useful if pre-pulled)
set -Eeuo pipefail

# ─── colours ────────────────────────────────────────────────────────────────
if [[ -t 1 ]]; then
  R='\033[0;31m'; G='\033[0;32m'; Y='\033[1;33m'; C='\033[0;36m'; B='\033[1m'; X='\033[0m'
else
  R=''; G=''; Y=''; C=''; B=''; X=''
fi
info()    { echo -e "${C}[info]${X} $*"; }
ok()      { echo -e "${G}[ok]${X}   $*"; }
warn()    { echo -e "${Y}[warn]${X} $*"; }
die()     { echo -e "${R}[err]${X}  $*" >&2; exit 1; }

# ─── config ─────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-/opt/supastack}"
DATA_DIR="${DATA_DIR:-/var/supastack}"
REPO_URL_DEFAULT=""
if [[ -d "${BASH_SOURCE[0]%/*}/.git" ]]; then
  REPO_URL_DEFAULT="$(git -C "${BASH_SOURCE[0]%/*}" remote get-url origin 2>/dev/null || true)"
fi
REPO_URL="${REPO_URL:-${REPO_URL_DEFAULT:-https://github.com/your-org/supastack.git}}"
REPO_REF="${REPO_REF:-main}"
SUPASTACK_VERSION="${SUPASTACK_VERSION:-dev}"
LOG_LEVEL="${LOG_LEVEL:-info}"
SKIP_BUILD="${SKIP_BUILD:-0}"

# ─── root check ─────────────────────────────────────────────────────────────
if [[ $EUID -eq 0 ]]; then
  die "Do not run as root. Run as a sudo-capable regular user."
fi
if ! sudo -n true 2>/dev/null; then
  warn "This script needs sudo for Docker install, /opt and /var paths. You may be prompted."
fi

# ─── OS / arch sanity ───────────────────────────────────────────────────────
case "$(uname -s)" in
  Linux) ;;
  *) die "Linux only (got $(uname -s))." ;;
esac

# ─── 1. install Docker if missing ───────────────────────────────────────────
if ! command -v docker >/dev/null 2>&1; then
  info "Installing Docker via get.docker.com…"
  curl -fsSL https://get.docker.com | sudo sh
  sudo usermod -aG docker "$USER"
  warn "User '$USER' added to the docker group. Log out and back in if subsequent commands fail with permission errors."
else
  ok "docker $(docker --version | awk '{print $3}' | tr -d ',')"
fi
if ! docker info >/dev/null 2>&1; then
  warn "Docker daemon not reachable yet. Re-running via 'sg docker'…"
  exec sg docker "$0 $*"
fi
if ! docker compose version >/dev/null 2>&1; then
  die "docker compose v2 plugin missing. Install: https://docs.docker.com/compose/install/"
fi
ok "docker compose $(docker compose version --short)"

# ─── 2. clone or update the repo ────────────────────────────────────────────
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  info "Cloning $REPO_URL@$REPO_REF → $INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  git clone --depth=1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR"
else
  info "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth=1 origin "$REPO_REF"
  git -C "$INSTALL_DIR" checkout "$REPO_REF"
  git -C "$INSTALL_DIR" reset --hard "origin/$REPO_REF" || true
fi
cd "$INSTALL_DIR"

# ─── 3. data dirs ───────────────────────────────────────────────────────────
info "Creating data dirs under $DATA_DIR"
sudo mkdir -p "$DATA_DIR/instances" "$DATA_DIR/backups" "$DATA_DIR/certs"
sudo chown -R "$USER:$USER" "$DATA_DIR"

# ─── 4. .env (idempotent — generate-if-absent + back-fill missing vars) ─────
# Generates a fresh .env on first run and back-fills any required var missing
# from a pre-existing .env (e.g. one written by an older installer). compose
# refuses to boot unless every required secret is present.
ENV_FILE="$INSTALL_DIR/.env"

# Resolve the apex (feature 117): positional arg → SUPASTACK_APEX env → existing
# .env → interactive prompt → 'localhost'. Pure helper (first non-empty wins) so
# the ordering is unit-testable; the caller supplies the prompt result.
resolve_apex() {
  local arg="$1" env="$2" dotenv="$3" tty_input="$4"
  if [[ -n "$arg" ]]; then echo "$arg"; return; fi
  if [[ -n "$env" ]]; then echo "$env"; return; fi
  if [[ -n "$dotenv" ]]; then echo "$dotenv"; return; fi
  if [[ -n "$tty_input" ]]; then echo "$tty_input"; return; fi
  echo "localhost"
}

ARG_APEX="${1:-}"
ENV_APEX="${SUPASTACK_APEX:-}"
DOTENV_APEX=""
if [[ -f "$ENV_FILE" ]]; then
  DOTENV_APEX="$(grep '^SUPASTACK_APEX=' "$ENV_FILE" 2>/dev/null | cut -d= -f2- || true)"
fi
# Prompt from /dev/tty (NOT stdin) so `curl … | bash` still prompts — its stdin
# is the pipe, so the old `[[ -t 0 ]]` test was false and silently defaulted.
TTY_APEX=""
if [[ -z "$ARG_APEX" && -z "$ENV_APEX" && -z "$DOTENV_APEX" && -r /dev/tty ]]; then
  read -rp "Apex domain (e.g. supastack.example.com) [localhost]: " TTY_APEX < /dev/tty || true
fi
SUPASTACK_APEX="$(resolve_apex "$ARG_APEX" "$ENV_APEX" "$DOTENV_APEX" "$TTY_APEX")"

# derive_gotrue_secret <master-key> → prints the 64-hex secret. NOT independent:
# it is HKDF-derived from MASTER_KEY and must match the api at runtime, so it
# goes through the canonical scripts/derive-gotrue-secret.mjs (node, or docker
# node:20-alpine when node isn't on the host).
derive_gotrue_secret() {
  local mk="$1"
  if command -v node >/dev/null 2>&1; then
    MASTER_KEY="$mk" node "$INSTALL_DIR/scripts/derive-gotrue-secret.mjs" 2>/dev/null | cut -d= -f2-
  else
    MASTER_KEY="$mk" docker run --rm -e MASTER_KEY \
      -v "$INSTALL_DIR/scripts/derive-gotrue-secret.mjs:/derive.mjs:ro" \
      node:20-alpine node /derive.mjs 2>/dev/null | cut -d= -f2-
  fi
}

# ensure_env <KEY> <VALUE> — append KEY=VALUE only if KEY is absent from .env.
ensure_env() {
  local key="$1" val="$2"
  if ! grep -q "^${key}=" "$ENV_FILE" 2>/dev/null; then
    printf '%s=%s\n' "$key" "$val" >> "$ENV_FILE"
    ok "Set $key"
  fi
}

if [[ ! -f "$ENV_FILE" ]]; then
  info "Generating fresh .env (secrets via openssl rand)…"
  {
    echo "# Supastack control-plane secrets — DO NOT COMMIT"
    echo "# Generated $(date -u +%FT%TZ) by install.sh"
  } > "$ENV_FILE"
  chmod 600 "$ENV_FILE"
else
  ok "Existing .env found at $ENV_FILE — back-filling any missing required vars"
fi

STUDIO_COMMIT="$(cat "$INSTALL_DIR/infra/supabase-template/COMMIT" 2>/dev/null || echo 'unknown')"

# Required — compose refuses to boot without these.
ensure_env MASTER_KEY                "$(openssl rand -hex 32)"
ensure_env SESSION_SECRET            "$(openssl rand -hex 32)"
ensure_env CONTROL_DB_PASSWORD       "$(openssl rand -base64 32 | tr -d '/+=$\\`' | cut -c1-32)"
ensure_env SUPASTACK_APEX            "$SUPASTACK_APEX"
ensure_env SUPAVISOR_API_JWT_SECRET  "$(openssl rand -hex 32)"
ensure_env SUPAVISOR_SECRET_KEY_BASE "$(openssl rand -hex 32)"
ensure_env SUPAVISOR_VAULT_ENC_KEY   "$(openssl rand -hex 32)"

# GOTRUE_JWT_SECRET — derived from the MASTER_KEY now in .env.
if ! grep -q '^GOTRUE_JWT_SECRET=' "$ENV_FILE" 2>/dev/null; then
  _mk="$(grep '^MASTER_KEY=' "$ENV_FILE" | cut -d= -f2-)"
  _gotrue="$(derive_gotrue_secret "$_mk")"
  [[ -n "$_gotrue" ]] || die "Failed to derive GOTRUE_JWT_SECRET. Run manually: MASTER_KEY=<key> node scripts/derive-gotrue-secret.mjs >> $ENV_FILE"
  ensure_env GOTRUE_JWT_SECRET "$_gotrue"
fi

# Non-secret settings.
ensure_env LOG_LEVEL         "$LOG_LEVEL"
ensure_env SUPASTACK_VERSION "$SUPASTACK_VERSION"
ensure_env STUDIO_IMAGE      "supastack/studio:$STUDIO_COMMIT"

chmod 600 "$ENV_FILE"
ok "Config ready at $ENV_FILE (600)"
[[ "$SUPASTACK_APEX" == "localhost" ]] && \
  warn "SUPASTACK_APEX=localhost — fine for local testing. For a public deploy, set a real apex (edit .env or re-run with SUPASTACK_APEX=…) before /setup."

# Export so docker compose picks up secrets
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

# ─── 5. build the Studio image once (per pinned commit) ─────────────────────
if [[ "$SKIP_BUILD" != "1" ]]; then
  STUDIO_COMMIT="$(cat "$INSTALL_DIR/infra/supabase-template/COMMIT" 2>/dev/null || echo '')"
  if [[ -z "$STUDIO_COMMIT" ]]; then
    warn "infra/supabase-template/COMMIT not found yet — Studio image will be built later."
  else
    STUDIO_TAG="supastack/studio:$STUDIO_COMMIT"
    if docker image inspect "$STUDIO_TAG" >/dev/null 2>&1; then
      ok "Studio image already built ($STUDIO_TAG)"
    else
      info "Building Studio image $STUDIO_TAG (one-time, ~2–4 min)…"
      docker build \
        --build-arg NEXT_PUBLIC_BASE_PATH=/studio \
        --build-arg SUPABASE_COMMIT="$STUDIO_COMMIT" \
        -t "$STUDIO_TAG" \
        -f "$INSTALL_DIR/infra/studio/Dockerfile" \
        "$INSTALL_DIR/infra/studio"
      ok "Built $STUDIO_TAG"
    fi
  fi
fi

# ─── 6. control-plane stack up ──────────────────────────────────────────────
info "Pulling base images…"
docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" pull --ignore-pull-failures || true

if [[ "$SKIP_BUILD" != "1" ]]; then
  info "Building control-plane images (api, worker, web)…"
  docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" build
fi

info "Starting control plane…"
docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" up -d

# ─── 7. wait for health ─────────────────────────────────────────────────────
info "Waiting for control plane to become healthy…"
TIMEOUT=180
elapsed=0
until docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" ps --format json \
        | grep -q '"Health":"healthy"' && \
      docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" exec -T api wget -qO- http://localhost:3001/api/v1/health >/dev/null 2>&1; do
  if (( elapsed >= TIMEOUT )); then
    die "Control plane did not become healthy in ${TIMEOUT}s. Check: docker compose -f $INSTALL_DIR/infra/docker-compose.yml logs"
  fi
  sleep 5
  elapsed=$((elapsed + 5))
done
ok "Control plane is healthy (${elapsed}s)"

# ─── 8. point operator at /setup ────────────────────────────────────────────
PUBLIC_HOST="${PUBLIC_HOST:-$(curl -fsSL --max-time 5 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')}"
echo
echo -e "${B}═══════════════════════════════════════════════════${X}"
echo -e "${G}${B}  Supastack is running.${X}"
echo -e "${B}═══════════════════════════════════════════════════${X}"
echo
echo -e "  Open: ${B}http://${PUBLIC_HOST}/setup${X}"
echo "    create the super-admin account, then optionally register your apex domain."
echo
echo "  Config:   $INSTALL_DIR/.env  (secrets — keep safe)"
echo "  Data:     $DATA_DIR/instances  +  $DATA_DIR/backups"
echo "  Manage:   docker compose -f $INSTALL_DIR/infra/docker-compose.yml ps"
echo "            docker compose -f $INSTALL_DIR/infra/docker-compose.yml logs -f"
echo "            docker compose -f $INSTALL_DIR/infra/docker-compose.yml down"
echo
echo -e "${Y}  Next step:${X} point DNS for your apex (and per-instance subdomains)"
echo "             at this host's IP, then visit /setup."
echo
