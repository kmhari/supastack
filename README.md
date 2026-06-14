# Supastack

**A self-hosted Supabase Cloud.** Run your own multi-project Supabase platform
on a single Linux VM — provision isolated, full-stack Supabase projects from a
web dashboard, each with its own Postgres, Auth, Storage, Realtime, Edge
Functions, and HTTPS. The real Supabase Studio is the dashboard, and the
unmodified upstream `supabase` CLI and MCP server work against it.

## Why

Supabase's hosting story is either their Cloud or a single hand-managed
`docker compose` stack per project. Supastack gives you the missing middle: a
control plane that provisions and operates **N** isolated projects on hardware
you own — with real API keys that work on the first try, Cloud-parity URLs,
and lifecycle management (pause, resume, upgrade, backup, restore) from a UI.
Full comparison against vanilla self-hosting:
[docs/supastack-vs-selfhost.md](docs/supastack-vs-selfhost.md).

## Features

- **One-command install** on a fresh Ubuntu host. The apex domain is set once
  at install and is the single source of truth for everything.
- **Guided first-time setup** at `/setup` — shows the exact DNS records to
  create, verifies them, issues a wildcard `*.<apex>` certificate via
  Let's Encrypt (DNS-01), and creates your admin account.
- **The real Supabase dashboard** — a shared Supabase Studio
  (`IS_PLATFORM=true`) serves all projects at `https://<apex>/dashboard` with
  Cloud-parity URLs. Ships as a prebuilt, domain-agnostic image; every
  deviation from upstream Studio is
  [documented with reasoning](https://github.com/kmhari/supabase/blob/supastack-studio/SUPASTACK-PATCHES.md).
- **Full project stacks** — each project gets the complete upstream Supabase
  container set (Postgres, GoTrue, PostgREST, Realtime, Storage, Edge
  Functions, pg-meta, analytics, Kong), isolated and individually addressable
  at `https://<ref>.<apex>`.
- **HTTPS everywhere** — one wildcard cert covers the dashboard, the API, MCP,
  and every project subdomain. Direct Postgres at `db.<ref>.<apex>:5432`
  (with a per-project cert for strict-TLS clients) and pooled connections at
  `pooler.<apex>:6543` via Supavisor.
- **Supabase CLI compatible** — `supabase login`, `link`, `db push`,
  `functions deploy`, `secrets set`, `gen types`, `migration list` and more
  work with the unmodified upstream CLI (≥ 2.72). No fork, no shim.
- **Hosted MCP server** — paste `https://mcp.<apex>/mcp` into Claude Code,
  Cursor, or Windsurf, authorize in the browser (OAuth 2.1 + PKCE), and drive
  all your projects via tool calls: `execute_sql`, `list_tables`,
  `apply_migration`, `deploy_edge_function`, `get_logs`, and more.
- **Management API compatibility** — a `/v1/*` surface wire-compatible with
  the Supabase Management API, served at `api.<apex>`.
- **Real auth and orgs** — control-plane GoTrue (the same auth Supabase
  ships) with organizations, Owner / Administrator / Developer / Read-only
  roles, and email invites.
- **Backups** — on-demand and daily automatic backups with per-project
  retention, stored on local disk or any S3-compatible store.
- **Operations built in** — pause / resume / restart / upgrade / delete,
  secrets management backed by Vault, connection-pooler drift reconciliation,
  cert renewal alerts, and an audit log of destructive actions.

## Quickstart

Requirements: a fresh **Ubuntu 22.04+** VM (4 GB+ RAM; each project adds
roughly 1 GB), a **public IP** with ports **80/443** open (plus 5432/6543 for
external Postgres access), and a **domain** you control DNS for. Run as a
sudo-capable non-root user.

```sh
curl -fsSL https://raw.githubusercontent.com/kmhari/supastack/main/install.sh | bash
```

The installer prompts for your domain (works even when piped). To skip the
prompt, pass it explicitly: `… | bash -s -- your-domain.com`.

The installer installs Docker if missing, clones the repo, generates all
secrets into `infra/.env`, pulls the prebuilt platform images from Docker Hub,
starts the control plane, and prints your setup URL. Open it, follow the DNS +
certificate wizard, create your admin account, and you're at
`https://your-domain.com/dashboard`. Works as root or as a sudo-capable user.

Alternatives:

```sh
# From a checkout
git clone https://github.com/kmhari/supastack.git /opt/supastack
cd /opt/supastack
./install.sh your-domain.com
```

No git checkout is needed on the target: copying `install.sh` together with
`infra/docker-compose.yml`, `infra/Caddyfile`, and
`scripts/derive-gotrue-secret.mjs` (keeping their relative paths) to a fresh VM
and running `./install.sh your-domain.com` performs the same pull-mode install
without touching the network for source at all.

To build images from source instead of pulling, use `INSTALL_MODE=build`.

## Architecture

| Layer             | What runs there                                                                                                                                                                                              |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Control plane** | Postgres, Redis, GoTrue (operator auth), API (Fastify), worker (BullMQ jobs: provisioning, backups, certs, reconcilers), shared Studio, MCP server, Caddy (HTTPS + routing), Supavisor (multi-tenant pooler) |
| **Per project**   | A full isolated Supabase stack (`supastack-<ref>-*` containers), provisioned from a baked-in compose template                                                                                                |
| **Edge / TLS**    | Wildcard `*.<apex>` cert for everything; per-project `db.<ref>.<apex>` certs for strict-TLS Postgres clients                                                                                                 |

All platform images are published on Docker Hub as
[`kmhariharasudhan/supastack-*`](https://hub.docker.com/u/kmhariharasudhan),
dual-tagged with the git sha and `latest`. Installs pin to the sha tags via
`SUPASTACK_VERSION` / `STUDIO_PLATFORM_VERSION` in `infra/.env`; upgrading is
editing those pins and `docker compose pull && docker compose up -d`. The
per-project stacks use stock upstream `supabase/*` images.

## Updating

```sh
cd /opt/supastack
git pull
# bump SUPASTACK_VERSION / STUDIO_PLATFORM_VERSION in infra/.env if pinned
sudo docker compose -f infra/docker-compose.yml pull
sudo docker compose -f infra/docker-compose.yml up -d
```

Control-plane migrations run automatically at API boot and are idempotent.

## License

Supastack is licensed under the
[GNU Affero General Public License v3.0](LICENSE) (AGPL-3.0).

You can use, modify, and self-host it freely — including commercially. If you
run a modified version as a network service, the AGPL requires you to make
your modifications' source available to its users.

Supastack orchestrates upstream Supabase components, which keep their own
licenses: the per-project stacks run unmodified `supabase/*` images
(Apache-2.0/MIT/PostgreSQL licenses), and the shared Studio is built from an
[Apache-2.0 fork](https://github.com/kmhari/supabase/tree/supastack-studio)
of the Supabase monorepo with a
[minimal, documented patch set](https://github.com/kmhari/supabase/blob/supastack-studio/SUPASTACK-PATCHES.md).
Supastack is an independent project and is not affiliated with or endorsed by
Supabase Inc.
