# Configuration

All control-plane configuration lives in **`/opt/supastack/.env`** (referenced
by `infra/docker-compose.yml`). Keep it `chmod 600` and **never commit it**.

## Required secrets

The compose file refuses to start unless these are set.

| Variable | How to generate |
|---|---|
| `MASTER_KEY` | `openssl rand -hex 32` — envelope-encrypts every per-project secret. **Back this up; losing it is unrecoverable.** |
| `SESSION_SECRET` | `openssl rand -hex 32` |
| `CONTROL_DB_PASSWORD` | `openssl rand -base64 32 \| tr -d '/+=$\\\`' \| cut -c1-32` (avoid `$` — Compose mangles it) |
| `SUPASTACK_APEX` | your domain, e.g. `supastack.example.com` |
| `GOTRUE_JWT_SECRET` | **derived** from the master key: `MASTER_KEY=<key> node scripts/derive-gotrue-secret.mjs >> .env` |
| `SUPAVISOR_API_JWT_SECRET` | `openssl rand -hex 32` |
| `SUPAVISOR_SECRET_KEY_BASE` | `openssl rand -hex 32` |
| `SUPAVISOR_VAULT_ENC_KEY` | `openssl rand -hex 32` |

> `GOTRUE_JWT_SECRET` is **not** an independent secret — it is HKDF-derived from
> `MASTER_KEY`. Re-running the derive script always reproduces the same value, so
> set `MASTER_KEY` first.

### Minimal generator

```sh
cd /opt/supastack
{
  echo "MASTER_KEY=$(openssl rand -hex 32)"
  echo "SESSION_SECRET=$(openssl rand -hex 32)"
  echo "CONTROL_DB_PASSWORD=$(openssl rand -base64 32 | tr -d '/+=$\\`' | cut -c1-32)"
  echo "SUPASTACK_APEX=supastack.example.com"
  echo "SUPAVISOR_API_JWT_SECRET=$(openssl rand -hex 32)"
  echo "SUPAVISOR_SECRET_KEY_BASE=$(openssl rand -hex 32)"
  echo "SUPAVISOR_VAULT_ENC_KEY=$(openssl rand -hex 32)"
} > .env
# derive GoTrue secret from the MASTER_KEY just written
MASTER_KEY="$(grep '^MASTER_KEY=' .env | cut -d= -f2)" node scripts/derive-gotrue-secret.mjs >> .env
chmod 600 .env
```

## Optional settings (sane defaults)

| Variable | Default | Meaning |
|---|---|---|
| `LOG_LEVEL` | `info` | pino level for `api` + `worker` |
| `SUPASTACK_VERSION` | `dev` | image tag suffix for built images |
| `SUPASTACK_PUBLIC_IP` | _(empty)_ | host public IP (auto-detected at setup if unset) |
| `STUDIO_IMAGE` | `supastack/studio:latest` | per-project Studio image tag |
| `COOKIE_SECURE` | `0` | set `1` once you're on HTTPS |
| `ACME_DIRECTORY_URL` | _(empty → LE prod)_ | set to the LE **staging** URL while testing to avoid rate limits |

## Email (SMTP) — optional

Without SMTP, signups auto-confirm (`GOTRUE_MAILER_AUTOCONFIRM=true`). For real
invite/confirmation emails set:

| Variable | Default |
|---|---|
| `GOTRUE_SMTP_HOST` | _(empty)_ |
| `GOTRUE_SMTP_PORT` | `587` |
| `GOTRUE_SMTP_USER` | _(empty)_ |
| `GOTRUE_SMTP_PASS` | _(empty)_ |
| `GOTRUE_SMTP_ADMIN_EMAIL` | _(empty)_ |
| `GOTRUE_SMTP_SENDER_NAME` | `supastack` |
| `GOTRUE_MAILER_AUTOCONFIRM` | `true` (set `false` to require email confirmation) |

## Backups store — optional (S3)

Backups default to local disk under `DATA_DIR/backups`. To use an
S3-compatible store (AWS S3 / MinIO / Cloudflare R2 / Backblaze B2), configure
it from the dashboard backup settings per project.

## After editing `.env`

```sh
docker compose -f infra/docker-compose.yml up -d
```

Compose only re-reads `.env` on `up` (not `restart`), so always use `up -d`.

## Rotating the master key

Use `scripts/rekey-master.mjs` (see the migration runbook in `docs/changes/018-master-key-rotation.md`). Rotating re-encrypts all per-project secrets; do it deliberately and keep both keys until the migration completes.

## Next

- [DNS & TLS](DNS-and-TLS)
- [First-Time Setup](First-Time-Setup)
