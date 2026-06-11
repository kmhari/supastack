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
#   INSTALL_MODE     pull (default) — pull prebuilt platform images from Docker
#                    Hub, no source builds; build — build images from this
#                    checkout (development / hacking on supastack itself).
#   SUPASTACK_VERSION image tag: pull mode defaults to 'latest' (pin a git sha
#                    for production); build mode defaults to 'dev'.
#   LOG_LEVEL        pino log level for api+worker (default: info)
#   SUPASTACK_SKIP_UP set to 1 to stop after config generation (CI / testing).
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
REPO_URL="${REPO_URL:-${REPO_URL_DEFAULT:-https://github.com/kmhari/selfbase.git}}"
REPO_REF="${REPO_REF:-main}"
# pull = prebuilt images from Docker Hub (default); build = compile from source.
INSTALL_MODE="${INSTALL_MODE:-pull}"
case "$INSTALL_MODE" in pull|build) ;; *) die "INSTALL_MODE must be 'pull' or 'build' (got '$INSTALL_MODE')" ;; esac
if [[ "$INSTALL_MODE" == "pull" ]]; then
  SUPASTACK_VERSION="${SUPASTACK_VERSION:-latest}"
else
  SUPASTACK_VERSION="${SUPASTACK_VERSION:-dev}"
fi
LOG_LEVEL="${LOG_LEVEL:-info}"
SUPASTACK_SKIP_UP="${SUPASTACK_SKIP_UP:-0}"

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

# ─── 2. source files — git checkout, pre-staged files, or clone ─────────────
# Pull mode needs exactly THREE repo files; everything else is pulled images.
# Pre-stage them (e.g. scp) into $INSTALL_DIR and no git/repo access is needed:
#   infra/docker-compose.yml   infra/Caddyfile   scripts/derive-gotrue-secret.mjs
NEEDED_FILES=(infra/docker-compose.yml infra/Caddyfile scripts/derive-gotrue-secret.mjs)
have_needed_files() {
  local f
  for f in "${NEEDED_FILES[@]}"; do [[ -f "$INSTALL_DIR/$f" ]] || return 1; done
}

if [[ -d "$INSTALL_DIR/.git" ]]; then
  info "Updating existing checkout in $INSTALL_DIR"
  git -C "$INSTALL_DIR" fetch --depth=1 origin "$REPO_REF"
  git -C "$INSTALL_DIR" checkout "$REPO_REF"
  git -C "$INSTALL_DIR" reset --hard "origin/$REPO_REF" || true
elif have_needed_files; then
  ok "Pre-staged install files found in $INSTALL_DIR — skipping git entirely"
  [[ "$INSTALL_MODE" == "build" ]] && die "INSTALL_MODE=build needs a full source checkout, not pre-staged files. Clone the repo or use pull mode."
else
  command -v git >/dev/null 2>&1 || die "git not found. Install it (sudo apt install -y git) — or pre-stage ${NEEDED_FILES[*]} into $INSTALL_DIR and re-run (no git needed)."
  info "Cloning $REPO_URL@$REPO_REF → $INSTALL_DIR"
  sudo mkdir -p "$INSTALL_DIR"
  sudo chown -R "$USER:$USER" "$INSTALL_DIR"
  git clone --depth=1 --branch "$REPO_REF" "$REPO_URL" "$INSTALL_DIR" \
    || die "Clone failed (private repo / no auth?). Alternative: scp ${NEEDED_FILES[*]} into $INSTALL_DIR and re-run."
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
#
# Lives NEXT TO the compose file (infra/.env) — that's the directory docker
# compose resolves .env from when invoked with -f, so manual compose commands
# work after install without exporting anything. Older installers wrote
# $INSTALL_DIR/.env; migrate it once.
ENV_FILE="$INSTALL_DIR/infra/.env"
if [[ -f "$INSTALL_DIR/.env" && ! -f "$ENV_FILE" ]]; then
  info "Migrating legacy $INSTALL_DIR/.env → $ENV_FILE"
  mv "$INSTALL_DIR/.env" "$ENV_FILE"
fi

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

# Non-secret settings. SUPASTACK_VERSION / STUDIO_PLATFORM_VERSION select the
# Docker Hub tags for the platform images — pin git shas for production
# (see docs/containers-and-updates.md). Per-instance Studio uses the stock
# upstream image (compose default); no STUDIO_IMAGE entry needed.
ensure_env LOG_LEVEL               "$LOG_LEVEL"
ensure_env SUPASTACK_VERSION       "$SUPASTACK_VERSION"
ensure_env STUDIO_PLATFORM_VERSION "${STUDIO_PLATFORM_VERSION:-latest}"

chmod 600 "$ENV_FILE"
ok "Config ready at $ENV_FILE (600)"
[[ "$SUPASTACK_APEX" == "localhost" ]] && \
  warn "SUPASTACK_APEX=localhost — fine for local testing. For a public deploy, set a real apex (edit .env or re-run with SUPASTACK_APEX=…) before /setup."

# Export so docker compose picks up secrets
set -a
# shellcheck disable=SC1090
source "$ENV_FILE"
set +a

if [[ "$SUPASTACK_SKIP_UP" == "1" ]]; then
  ok "SUPASTACK_SKIP_UP=1 — config generated, stopping before image pull/start."
  exit 0
fi

# ─── 5. control-plane stack up ──────────────────────────────────────────────
COMPOSE=(docker compose -f "$INSTALL_DIR/infra/docker-compose.yml")
if [[ "$INSTALL_MODE" == "pull" ]]; then
  info "Pulling platform images from Docker Hub (tag: $SUPASTACK_VERSION)…"
  "${COMPOSE[@]}" pull
  info "Starting control plane…"
  "${COMPOSE[@]}" up -d --no-build
else
  info "Pulling vendor images…"
  "${COMPOSE[@]}" pull --ignore-pull-failures || true
  info "Building platform images from source (api, worker, mcp, web)…"
  "${COMPOSE[@]}" build
  info "Starting control plane…"
  "${COMPOSE[@]}" up -d
fi

# ─── 7. wait for health ─────────────────────────────────────────────────────
info "Waiting for control plane to become healthy…"
TIMEOUT=180
elapsed=0
until docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" ps --format json \
        | grep -q '"Health":"healthy"' && \
      docker compose -f "$INSTALL_DIR/infra/docker-compose.yml" exec -T api node -e "fetch('http://localhost:3001/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))" >/dev/null 2>&1; do
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
echo "    the wizard shows the DNS records for $SUPASTACK_APEX, verifies them,"
echo "    issues the wildcard certificate, then creates the super-admin."
echo
echo "  Config:   $ENV_FILE  (secrets — keep safe)"
echo "  Data:     $DATA_DIR/instances  +  $DATA_DIR/backups"
echo "  Manage:   docker compose -f $INSTALL_DIR/infra/docker-compose.yml ps"
echo "            docker compose -f $INSTALL_DIR/infra/docker-compose.yml logs -f"
echo "            docker compose -f $INSTALL_DIR/infra/docker-compose.yml down"
echo
echo -e "${Y}  Next step:${X} point DNS for your apex (and per-instance subdomains)"
echo "             at this host's IP, then visit /setup."
echo
