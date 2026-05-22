# Selfbase

A self-hosted Supabase Cloud — provision and manage multiple full-stack
Supabase instances on your own Linux host through a web dashboard, with
per-instance HTTPS, backups, and a unified org / admin / member model.

Built because every existing OSS option was broken in production:
SupaConsole ships a fake JWT signer (instances produced with it have
non-functional API keys), and Multibase's dashboard provisioner emits
`.env` files with missing variables and `$`-shaped passwords that Docker
Compose silently mangles. Selfbase ships the regression tests for both.

## What you get

- **One-line install** (`install.sh`) on a fresh Ubuntu host.
- **First-time setup** — create the super-admin and register your apex
  domain through the dashboard.
- **Create instances from the UI** — name + optional SMTP, ~60–90 s to
  `running`, real `anon_key` / `service_role_key` that authenticate against
  the running services on the first try.
- **HTTPS per instance** — `https://<ref>.<apex>` issued via Caddy
  on-demand TLS (HTTP-01). No DNS provider integration required beyond an
  apex A/CNAME.
- **Per-instance Studio** at `https://<ref>.<apex>/studio`.
- **Lifecycle**: pause / resume / restart / upgrade / delete from the
  dashboard.
- **Backups**: on-demand + daily auto with per-instance retention. Local
  disk or S3-compatible store (MinIO / R2 / B2).
- **Multi-user**: admins invite members by email; member-removal cascades
  to tokens + sessions.
- **Audit log** of destructive actions (delete, member-remove, secret
  reveal).
- **Supabase CLI compatibility** — the unmodified upstream `supabase` CLI
  (≥ 2.72.7) drives selfbase end-to-end: login with a personal access
  token, link a local project, `supabase functions deploy`, `supabase
  secrets set`, etc. No fork, no patch, no shim. See
  [`docs/supabase-cli.md`](docs/supabase-cli.md) for the connect-and-go
  guide.

See [`specs/001-selfbase-supabase-platform/spec.md`](specs/001-selfbase-supabase-platform/spec.md)
for the full functional requirements and success criteria.

## Quickstart

On a fresh Ubuntu 22.04+ VM with a public IP:

```sh
curl -fsSL https://raw.githubusercontent.com/<you>/selfbase/main/install.sh | bash
```

Or clone first and run locally:

```sh
git clone https://github.com/<you>/selfbase /opt/selfbase
cd /opt/selfbase
./install.sh
```

The installer:

1. Installs Docker if missing.
2. Generates `MASTER_KEY` + `SESSION_SECRET` + DB password into `/opt/selfbase/.env`.
3. Builds the per-instance Studio image once (~3–5 min).
4. Starts the control-plane stack (`docker compose up -d`).
5. Prints the dashboard URL.

Then point your apex DNS at the host, open the URL, and follow `/setup`.

The full step-by-step walkthrough lives in
[`specs/001-selfbase-supabase-platform/quickstart.md`](specs/001-selfbase-supabase-platform/quickstart.md).

## Architecture

```
            ┌─────────────┐
            │   Caddy     │  :80 / :443
            │ (on-demand  │  (HTTP-01 per <ref>.<apex>)
            │    TLS)     │
            └──┬────┬─────┘
               │    │
               │    └──→ <ref>.<apex>/studio  →  per-instance Studio
               ↓        <ref>.<apex>          →  per-instance Kong
       ┌──────────────┐
       │ Selfbase Web │   React + Vite dashboard
       └──────┬───────┘
              │
              ↓                       ┌─────────────────────────────────┐
       ┌──────────────┐        ┌─────→│ selfbase-<ref> compose project  │
       │ Selfbase API │←──┐    │      │ db + auth + rest + realtime +  │
       │ (Fastify)    │   │    │      │ storage + studio + kong + ...  │
       └──────┬───────┘   │    │      └─────────────────────────────────┘
              │           │    │                  (one per managed instance)
              ↓           │    │
       ┌──────────────┐   │    │
       │   Postgres   │   │    │
       │  (control)   │   │    │
       └──────────────┘   │    │
                          │    │
       ┌──────────────┐   │    │
       │    Redis     │←──┘    │
       │ (sessions +  │        │
       │   BullMQ)    │        │
       └──────┬───────┘        │
              │                │
              ↓                │
       ┌──────────────────────┴───────┐
       │ Selfbase Worker (BullMQ)     │
       │  provision  lifecycle        │
       │  backup     backup-scheduler │
       │  caddy-reload  health-recon  │
       └──────────────────────────────┘
```

## Repo layout

| Path                                    | What                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------ |
| `apps/api/`                             | Fastify control-plane (REST API)                                               |
| `apps/worker/`                          | BullMQ workers (provision, lifecycle, backup, caddy-reload, health-reconciler) |
| `apps/web/`                             | React + Vite dashboard                                                         |
| `apps/caddy/`                           | Caddyfile (on-demand TLS skeleton; routes added at runtime)                    |
| `infra/docker-compose.yml`              | Control-plane stack                                                            |
| `infra/studio/Dockerfile`               | Builds Supabase Studio with `NEXT_PUBLIC_BASE_PATH=/studio`                    |
| `infra/supabase-template/`              | Vendored upstream `supabase/docker/*` at a pinned commit                       |
| `packages/db/`                          | Drizzle schema + migrations + port-allocator                                   |
| `packages/crypto/`                      | AES-256-GCM + Argon2id + real HS256 JWT signing + safe password gen            |
| `packages/docker-control/`              | Compose templater (anti-Multibase regression tests) + dockerode wrappers       |
| `packages/backup-store/`                | `BackupStore` interface + LocalDiskStore + S3Store                             |
| `packages/shared/`                      | RBAC matrix + zod schemas + error types + pino logger                          |
| `install.sh`                            | One-shot installer                                                             |
| `specs/001-selfbase-supabase-platform/` | Speckit spec + plan + research + contracts + tasks                             |

## Development

Requires Node 20+ and pnpm 9+.

```sh
pnpm install
pnpm test          # vitest unit + contract (45+ tests, most integration tests skip without infra)
pnpm typecheck     # all 8 packages
pnpm lint          # eslint flat config
pnpm format        # prettier
```

Running the stack locally (you'll need Docker):

```sh
docker compose -f infra/docker-compose.yml up -d
```

then visit `http://localhost/setup`.

To re-vendor the upstream Supabase template at a newer commit, see
[`UPGRADING.md`](UPGRADING.md).

## Anti-regression watchlist

We test for the actual bugs we found in shipped competitors:

| Bug                                                                | Detected by                                                                                                                                                          |
| ------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SupaConsole's fake JWT signer                                      | `packages/crypto/tests/crypto.test.ts` — every signed token verifies against its own secret                                                                          |
| Multibase's `$` in `POSTGRES_PASSWORD`                             | `packages/crypto/tests/crypto.test.ts` — 1000 generated passwords contain no `$`; `packages/docker-control/tests/compose-template.test.ts` rejects `$`-shaped values |
| Multibase's missing `.env` variables                               | `packages/docker-control/tests/compose-template.test.ts` — completeness assertion against vendored `.env.example`                                                    |
| Multibase's empty `DOCKER_SOCKET_LOCATION`                         | `packages/docker-control/tests/compose-template.test.ts` — explicit assertion                                                                                        |
| Multibase's `lib/` in `.gitignore`                                 | `.github/workflows/ci.yml` — `git check-ignore` smoke fails if `apps/web/src/lib/api.ts` becomes ignored                                                             |
| Multibase's `VITE_API_URL=http://localhost:3001` baked into bundle | `apps/web/vite.config.ts` defaults `VITE_API_URL=''`; axios uses relative paths                                                                                      |

## Status

v1 — 8 commits, ~110 implementation tasks (T001–T110) complete.
End-to-end demo path is exercised by the integration test in
`tests/integration/provision-instance.test.ts`.

## License

MIT (operator's choice — `package.json` lists `MIT`; replace as needed).
