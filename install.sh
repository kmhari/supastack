#!/usr/bin/env bash
set -euo pipefail

# ─── Config ───────────────────────────────────────────────────────────────────
INSTALL_DIR="${INSTALL_DIR:-$HOME/supabase}"
PUBLIC_URL="${PUBLIC_URL:-}"          # auto-detected if empty
STUDIO_PORT="${STUDIO_PORT:-8000}"
SITE_PORT="${SITE_PORT:-3000}"

# ─── Colours ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
CYAN='\033[0;36m'; BOLD='\033[1m'; RESET='\033[0m'
info()    { echo -e "${CYAN}[info]${RESET} $*"; }
success() { echo -e "${GREEN}[ok]${RESET}   $*"; }
warn()    { echo -e "${YELLOW}[warn]${RESET} $*"; }
die()     { echo -e "${RED}[err]${RESET}  $*" >&2; exit 1; }

# ─── Root check ───────────────────────────────────────────────────────────────
if [[ $EUID -eq 0 ]]; then
  die "Do not run as root. Run as a regular user with sudo access."
fi

# ─── OS detection ─────────────────────────────────────────────────────────────
detect_os() {
  if [[ -f /etc/os-release ]]; then
    # shellcheck source=/dev/null
    source /etc/os-release
    echo "${ID:-linux}"
  else
    echo "linux"
  fi
}

OS=$(detect_os)

# ─── Dependency installers ────────────────────────────────────────────────────
install_docker() {
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  sudo usermod -aG docker "$USER"
  warn "Added $USER to docker group. You may need to log out and back in for group changes to take effect."
  warn "Re-run this script after logging back in if docker commands fail."
  # Activate group in current shell without logout
  exec sg docker "$0 $*" || true
}

install_package() {
  local pkg="$1"
  case "$OS" in
    ubuntu|debian) sudo apt-get install -y -qq "$pkg" ;;
    fedora|rhel|centos|rocky|almalinux) sudo dnf install -y "$pkg" ;;
    arch) sudo pacman -S --noconfirm "$pkg" ;;
    *) die "Cannot auto-install '$pkg' on '$OS'. Please install it manually." ;;
  esac
}

# ─── Prerequisite checks ──────────────────────────────────────────────────────
check_prerequisites() {
  info "Checking prerequisites..."

  # git
  if ! command -v git &>/dev/null; then
    info "Installing git..."
    install_package git
  fi
  success "git $(git --version | awk '{print $3}')"

  # openssl
  if ! command -v openssl &>/dev/null; then
    info "Installing openssl..."
    install_package openssl
  fi
  success "openssl $(openssl version | awk '{print $2}')"

  # docker
  if ! command -v docker &>/dev/null; then
    install_docker
  fi
  if ! docker info &>/dev/null; then
    die "Docker daemon not running or current user lacks access. Try: sudo systemctl start docker"
  fi
  success "docker $(docker --version | awk '{print $3}' | tr -d ',')"

  # docker compose (plugin v2)
  if ! docker compose version &>/dev/null; then
    info "Installing docker compose plugin..."
    case "$OS" in
      ubuntu|debian)
        sudo apt-get install -y -qq docker-compose-plugin ;;
      *)
        die "Docker Compose plugin not found. Install it manually: https://docs.docker.com/compose/install/"
        ;;
    esac
  fi
  success "docker compose $(docker compose version --short)"
}

# ─── IP detection ─────────────────────────────────────────────────────────────
detect_public_ip() {
  local ip
  ip=$(curl -sf --max-time 5 https://api.ipify.org 2>/dev/null \
    || curl -sf --max-time 5 https://ifconfig.me 2>/dev/null \
    || hostname -I | awk '{print $1}')
  echo "$ip"
}

# ─── Setup ────────────────────────────────────────────────────────────────────
setup_project() {
  info "Setting up project in ${INSTALL_DIR}..."

  if [[ -d "$INSTALL_DIR" && -f "$INSTALL_DIR/docker-compose.yml" ]]; then
    warn "Existing install found at ${INSTALL_DIR}. Skipping clone."
  else
    local tmp_clone
    tmp_clone=$(mktemp -d)
    info "Cloning Supabase repository..."
    git clone --depth 1 https://github.com/supabase/supabase "$tmp_clone/supabase" \
      --quiet 2>&1

    mkdir -p "$INSTALL_DIR"
    cp -rf "$tmp_clone/supabase/docker/." "$INSTALL_DIR/"
    cp "$tmp_clone/supabase/docker/.env.example" "$INSTALL_DIR/.env"
    rm -rf "$tmp_clone"
    success "Project cloned to ${INSTALL_DIR}"
  fi
}

configure_env() {
  local env_file="${INSTALL_DIR}/.env"
  info "Generating secrets..."
  (cd "$INSTALL_DIR" && sh utils/generate-keys.sh --update-env)
  success "Secrets written to .env"

  # Detect public URL
  if [[ -z "$PUBLIC_URL" ]]; then
    local ip
    ip=$(detect_public_ip)
    PUBLIC_URL="http://${ip}:${STUDIO_PORT}"
    info "Auto-detected public IP: $ip"
  fi

  info "Configuring URLs..."
  sed -i "s|SUPABASE_PUBLIC_URL=.*|SUPABASE_PUBLIC_URL=${PUBLIC_URL}|" "$env_file"
  sed -i "s|API_EXTERNAL_URL=.*|API_EXTERNAL_URL=${PUBLIC_URL}|" "$env_file"

  # Set SITE_URL — extract host from PUBLIC_URL, replace port with SITE_PORT
  local host
  host=$(echo "$PUBLIC_URL" | sed -E 's|https?://([^:/]+).*|\1|')
  local scheme
  scheme=$(echo "$PUBLIC_URL" | sed -E 's|(https?)://.*|\1|')
  sed -i "s|SITE_URL=.*|SITE_URL=${scheme}://${host}:${SITE_PORT}|" "$env_file"

  success "URLs configured → ${PUBLIC_URL}"
}

pull_and_start() {
  info "Pulling Docker images (this may take a few minutes)..."
  (cd "$INSTALL_DIR" && docker compose pull --quiet)
  success "Images pulled"

  info "Starting services..."
  (cd "$INSTALL_DIR" && docker compose up -d)
}

# ─── Health wait ──────────────────────────────────────────────────────────────
wait_healthy() {
  info "Waiting for services to become healthy..."
  local timeout=120
  local elapsed=0
  while (( elapsed < timeout )); do
    local unhealthy
    unhealthy=$(cd "$INSTALL_DIR" && docker compose ps --format json \
      | grep -c '"Health":"starting"' 2>/dev/null || true)
    [[ "$unhealthy" -eq 0 ]] && break
    sleep 3
    (( elapsed += 3 ))
  done
  success "Services ready (${elapsed}s)"
}

# ─── Summary ──────────────────────────────────────────────────────────────────
print_summary() {
  local env_file="${INSTALL_DIR}/.env"
  local db_pass dashboard_pass anon_key service_key
  db_pass=$(grep '^POSTGRES_PASSWORD=' "$env_file" | cut -d= -f2-)
  dashboard_pass=$(grep '^DASHBOARD_PASSWORD=' "$env_file" | cut -d= -f2-)
  anon_key=$(grep '^ANON_KEY=' "$env_file" | cut -d= -f2-)
  service_key=$(grep '^SERVICE_ROLE_KEY=' "$env_file" | cut -d= -f2-)

  echo
  echo -e "${BOLD}═══════════════════════════════════════════════════${RESET}"
  echo -e "${GREEN}${BOLD}  Supabase is running!${RESET}"
  echo -e "${BOLD}═══════════════════════════════════════════════════${RESET}"
  echo
  echo -e "  ${BOLD}Studio Dashboard${RESET}  ${PUBLIC_URL}"
  echo -e "  ${BOLD}REST API${RESET}          ${PUBLIC_URL}/rest/v1/"
  echo -e "  ${BOLD}Auth API${RESET}          ${PUBLIC_URL}/auth/v1/"
  echo -e "  ${BOLD}Storage API${RESET}       ${PUBLIC_URL}/storage/v1/"
  echo
  echo -e "  ${BOLD}Dashboard login${RESET}   supabase / ${dashboard_pass}"
  echo -e "  ${BOLD}DB password${RESET}       ${db_pass}"
  echo
  echo -e "  ${BOLD}Anon key${RESET}"
  echo    "  ${anon_key}"
  echo
  echo -e "  ${BOLD}Service role key${RESET}"
  echo    "  ${service_key}"
  echo
  echo -e "  ${BOLD}Config${RESET}            ${INSTALL_DIR}/.env"
  echo
  echo -e "${YELLOW}  Next steps:${RESET}"
  echo    "  • Ensure port ${STUDIO_PORT} is open in your firewall"
  echo    "  • Add a reverse proxy (Caddy/Nginx) with TLS for production"
  echo    "  • Configure SMTP in .env for email auth"
  echo    "  • Store secrets in a secrets manager (Doppler, Infisical, etc.)"
  echo
  echo -e "  ${BOLD}Manage:${RESET}"
  echo    "  cd ${INSTALL_DIR}"
  echo    "  docker compose ps          # status"
  echo    "  docker compose logs -f     # logs"
  echo    "  docker compose down        # stop"
  echo    "  docker compose pull && docker compose up -d  # update"
  echo -e "${BOLD}═══════════════════════════════════════════════════${RESET}"
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo -e "${BOLD}Supabase Self-Host Installer${RESET}"
  echo "────────────────────────────────"
  echo "  Install dir : ${INSTALL_DIR}"
  echo "  Public URL  : ${PUBLIC_URL:-auto-detect}"
  echo "  Studio port : ${STUDIO_PORT}"
  echo "────────────────────────────────"
  echo

  check_prerequisites
  setup_project
  configure_env
  pull_and_start
  wait_healthy
  print_summary
}

main "$@"
