#!/usr/bin/env bash
#
# Selfbase installer — bootstraps the control plane on a Linux host.
#
# After this finishes, a single command (the printed URL) opens the dashboard
# at /setup, where the operator creates the super-admin and optionally
# registers an apex domain.
#
# Idempotent. Safe to re-run; existing data is preserved.
#
# Environment overrides:
#   INSTALL_DIR      where the repo lives (default: /opt/selfbase)
#   DATA_DIR         host bind-mount root (default: /var/selfbase)
#   REPO_URL         git source (default: this repo's origin)
#   REPO_REF         git branch/tag/commit (default: main)
#   SELFBASE_VERSION docker tag suffix for built images (default: dev)
#   STUDIO_IMAGE     prebuilt Studio image tag (default: selfbase/studio:<commit>)
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
INSTALL_DIR="${INSTALL_DIR:-/opt/selfbase}"
DATA_DIR="${DATA_DIR:-/var/selfbase}"
REPO_URL_DEFAULT=""
if [[ -d "${BASH_SOURCE[0]%/*}/.git" ]]; then
  REPO_URL_DEFAULT="$(git -C "${BASH_SOURCE[0]%/*}" remote get-url origin 2>/dev/null || true)"
fi
REPO_URL="${REPO_URL:-${REPO_URL_DEFAULT:-https://github.com/your-org/selfbase.git}}"
REPO_REF="${REPO_REF:-main}"
SELFBASE_VERSION="${SELFBASE_VERSION:-dev}"
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
sudo mkdir -p "$DATA_DIR/instances" "$DATA_DIR/backups"
sudo chown -R "$USER:$USER" "$DATA_DIR"

# ─── 4. .env (idempotent — won't overwrite existing secrets) ────────────────
ENV_FILE="$INSTALL_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  ok "Existing .env preserved at $ENV_FILE"
else
  info "Generating fresh .env (secrets via openssl rand)…"
  MASTER_KEY="$(openssl rand -hex 32)"
  SESSION_SECRET="$(openssl rand -hex 32)"
  CONTROL_DB_PASSWORD="$(openssl rand -base64 32 | tr -d '/+=$\\`' | cut -c1-32)"
  STUDIO_COMMIT="$(cat "$INSTALL_DIR/infra/supabase-template/COMMIT" 2>/dev/null || echo 'unknown')"

  cat > "$ENV_FILE" <<EOF
# Selfbase control-plane secrets — DO NOT COMMIT
# Generated $(date -u +%FT%TZ) by install.sh

MASTER_KEY=$MASTER_KEY
SESSION_SECRET=$SESSION_SECRET
CONTROL_DB_PASSWORD=$CONTROL_DB_PASSWORD

# Logging
LOG_LEVEL=$LOG_LEVEL

# Image tags
SELFBASE_VERSION=$SELFBASE_VERSION
STUDIO_IMAGE=selfbase/studio:$STUDIO_COMMIT
EOF
  chmod 600 "$ENV_FILE"
  ok "Wrote $ENV_FILE (600)"
fi

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
    STUDIO_TAG="selfbase/studio:$STUDIO_COMMIT"
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
echo -e "${G}${B}  Selfbase is running.${X}"
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
