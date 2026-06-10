# Installation

Supastack runs as a Docker Compose stack on a single Linux host.

## Prerequisites

- **Host**: Linux, Ubuntu 22.04+ recommended. ≥ 4 GB RAM for a few projects; each project's full stack adds ~1 GB.
- **Public IP** reachable on **ports 80 and 443** (and 5432 / 6543 if you want direct/pooled Postgres from outside).
- **A domain (apex)** you control DNS for — e.g. `supastack.example.com`.
- **Docker Engine + Compose v2**. The installer can install Docker for you.
- **Run as a sudo-capable non-root user** (the installer refuses to run as root).

## Option A — installer script

On a fresh VM:

```sh
git clone https://github.com/kmhari/selfbase.git /opt/supastack
cd /opt/supastack
./install.sh
```

The installer:

1. Installs Docker if missing.
2. Generates secrets into `/opt/supastack/.env`.
3. Builds the per-project Studio image once (~3–5 min) and the control-plane images.
4. Starts the control plane (`docker compose up -d`).
5. Prints the dashboard URL.

> ⚠️ **Heads-up:** the bundled `install.sh` may not generate every secret the
> current compose file requires (`GOTRUE_JWT_SECRET`, `SUPASTACK_APEX`,
> `SUPAVISOR_*`). If `docker compose up` fails with `… required`, finish the
> `.env` by hand using [Configuration](Configuration) — that page lists every
> variable and how to generate it.

Useful env overrides for the installer:

| Var | Default | Meaning |
|---|---|---|
| `INSTALL_DIR` | `/opt/supastack` | where the repo lives |
| `DATA_DIR` | `/var/supastack` | host bind-mount root (instances, backups, certs) |
| `REPO_REF` | `main` | branch/tag to check out |
| `SKIP_BUILD` | `0` | set `1` to skip image builds (pre-pulled) |

## Option B — manual install

```sh
# 1. Clone
git clone https://github.com/kmhari/selfbase.git /opt/supastack
cd /opt/supastack

# 2. Data dirs
sudo mkdir -p /var/supastack/{instances,backups,certs}
sudo chown -R "$USER:$USER" /var/supastack

# 3. Create .env  (see the Configuration page for the full reference)
cp .env.example .env 2>/dev/null || touch .env
# …populate every required secret (Configuration page)…
chmod 600 .env

# 4. Build the Studio image (one-time, per pinned commit)
STUDIO_COMMIT="$(cat infra/supabase-template/COMMIT)"
docker build \
  --build-arg NEXT_PUBLIC_BASE_PATH=/studio \
  --build-arg SUPABASE_COMMIT="$STUDIO_COMMIT" \
  -t "supastack/studio:$STUDIO_COMMIT" \
  -f infra/studio/Dockerfile infra/studio

# 5. Build + start the control plane
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d
```

## Verify the stack is up

```sh
# All services healthy within ~60s
docker compose -f infra/docker-compose.yml ps

# setup must report it's open (no super-admin yet)
curl -s http://localhost/api/v1/setup/status
# → { "open": true }
```

Then open `http://<VM-IP>/setup` and continue with [First-Time Setup](First-Time-Setup).

## Next

- [Configuration](Configuration) — the `.env` reference.
- [DNS & TLS](DNS-and-TLS) — point DNS and issue the wildcard cert.
