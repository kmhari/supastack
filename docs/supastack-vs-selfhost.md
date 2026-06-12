# Supastack vs. self-hosted Supabase

What you get from Supastack that the official open-source self-hosting setup
([supabase/supabase `docker/`](https://github.com/supabase/supabase/tree/master/docker))
does not give you.

**Framing:** vanilla self-hosting is *one* Supabase project as a hand-managed
`docker compose` stack. Supastack is a **platform** on top of the same upstream
images — a control plane that provisions and operates N projects on one host,
the way Supabase Cloud does, but on your own VM. Your projects still run the
exact stock `supabase/*` containers; Supastack adds everything around them.

## At a glance

| Capability | Vanilla self-host | Supastack |
|---|---|---|
| Projects per host | 1 per compose stack, manual port juggling | N isolated projects, provisioned from the dashboard in ~60–90 s |
| Project creation | Clone repo, copy `.env.example`, hand-generate JWT secret + anon/service keys, `docker compose up` | Click "New project" — keys generated and verified automatically |
| Dashboard | One Studio per project, no project switcher | Single shared Studio (`IS_PLATFORM=true`) for all projects at `/dashboard`, Cloud-parity URLs |
| Dashboard auth | HTTP basic auth (one shared username/password) | Real accounts (GoTrue), organizations, 4-tier RBAC, email invites |
| HTTPS / domains | Bring your own reverse proxy + certs | Guided wildcard `*.<apex>` Let's Encrypt cert (DNS-01), every project at `https://<ref>.<apex>` automatically |
| Public Postgres | Expose 5432 yourself, one project per port | `db.<ref>.<apex>:5432` for every project via SNI routing on one port, plus Supavisor pooling at `pooler.<apex>:6543` |
| `supabase` CLI | Not supported (no Management API) — CLI only works against Cloud or local `supabase start` | Unmodified upstream CLI works: `login`, `link`, `db push`, `functions deploy`, `secrets set`, `gen types`, `migration *` |
| MCP / AI tooling | None | Hosted MCP server at `mcp.<apex>/mcp` with OAuth 2.1 browser authorization |
| Backups | DIY `pg_dump` + cron | On-demand + daily automatic, per-project retention, local or S3-compatible store, restore from the dashboard |
| Lifecycle | `docker compose` by hand | Pause / resume / restart / upgrade / delete from the dashboard, with health gating and audit logging |
| Edge function secrets | Edit `.env`, restart the functions container | Vault-backed secrets with live propagation (~5 s, no restart), manageable via dashboard and CLI |
| Auth (GoTrue) configuration | Hand-edit env vars, restart, repeat | 169 GoTrue settings honored through the dashboard / Management API with validation |
| Install | Manual: clone, configure, generate secrets, wire a proxy | One command (`./install.sh your-domain.com`): Docker, secrets, images, DNS wizard |
| Operations | Nothing | Admin console (fleet, resources, queues, certs, logs), pooler drift reconciler, cert renewal alerts, audit log |

## The details

### 1. Multi-project on a single host

Vanilla self-hosting binds one project to one compose stack with fixed ports —
a second project means hand-editing every port, container name, and volume
path. Supastack provisions each project as an isolated namespaced stack
(`supastack-<ref>-*`) with dynamically allocated ports, its own Postgres, and
its own data directory, from a single click. Projects can't see each other.

### 2. Real API keys that work the first time

Vanilla setup requires generating a JWT secret, then deriving `anon` and
`service_role` keys from it manually (upstream docs point you at a web-based
generator). Get it wrong and PostgREST/GoTrue reject everything with opaque
401s. Supastack generates and signs the keys per project and actively probes
the running services before marking the project `running`.

### 3. The actual Supabase Cloud dashboard experience

Vanilla runs one Studio per project in its default single-project mode behind
shared basic auth. Supastack runs one shared Studio in **platform mode** —
the same `IS_PLATFORM=true` build Supabase Cloud uses — so you get the project
list, the org switcher, Cloud-style URLs (`/dashboard/project/<ref>/...`),
and per-user sessions. Operator accounts are real GoTrue users with
organizations, Owner / Administrator / Developer / Read-only roles, and
email invites — not one shared password in an env var.

### 4. TLS and networking handled end-to-end

Vanilla self-hosting stops at "put a reverse proxy in front." Supastack
includes the edge: a guided setup wizard walks you through the DNS records,
issues a wildcard Let's Encrypt certificate via DNS-01, and routes every
project subdomain, the API host, and the MCP host automatically. Postgres is
reachable per-project at `db.<ref>.<apex>:5432` (a custom STARTTLS+SNI proxy
multiplexes all projects over one port — strict-TLS clients get a dedicated
per-project certificate) and pooled at `pooler.<apex>:6543` via Supavisor
using Cloud's `postgres.<ref>` username convention.

### 5. Supabase CLI compatibility

This is the structural gap: the upstream `supabase` CLI talks to the
**Management API** (`api.supabase.com/v1/*`), which the open-source
distribution simply does not include. Against a vanilla self-host, `supabase
link`, `db push`, `functions deploy`, `secrets set` etc. have nothing to talk
to. Supastack implements a wire-compatible Management API subset, so the
unmodified CLI — including browser-based `supabase login` and passwordless
`db push` — works the same as against Cloud. See
[supabase-cli.md](./supabase-cli.md).

### 6. Hosted MCP server

Supabase Cloud ships `mcp.supabase.com` for AI-assisted workflows; the OSS
distribution has no equivalent. Supastack hosts the upstream MCP server at
`mcp.<apex>/mcp` behind a full OAuth 2.1 authorization flow — paste one URL
into Claude Code / Cursor / Windsurf, authorize in the browser, and run
`execute_sql`, `apply_migration`, `deploy_edge_function`, `get_logs`, and the
rest across all your projects.

### 7. Day-2 operations

Everything vanilla leaves to cron jobs and shell discipline:

- **Backups** — daily automatic + on-demand per project, retention windows,
  local-disk or S3-compatible storage, dashboard-driven restore.
- **Lifecycle** — pause/resume/restart/upgrade per project with health
  verification, instead of remembering compose invocations per stack.
- **Secrets** — edge-function secrets live in each project's Vault and
  propagate to the runtime within seconds, no container restart.
- **Self-healing** — a daily reconciler detects and repairs pooler drift
  (7 failure classes, including Postgres password drift with one-click reset).
- **Visibility** — admin console with per-project resource usage, job queues,
  cert status, and log access; audit log of destructive actions.

## What's the same

The data plane **is** upstream Supabase — stock `supabase/postgres`, GoTrue,
PostgREST, Realtime, Storage, edge-runtime, pg-meta, Kong images, pinned and
upgradeable per project. Your application code, client libraries, and data
formats are exactly as portable as on any Supabase deployment.

## What Supastack does not add

For honesty's sake, Cloud features that neither vanilla self-hosting nor
Supastack currently provide: preview branches, custom vanity domains per
project, network restrictions/bans, SSL enforcement toggles, and advisors.
Supastack is also single-host by design — one VM runs the control plane and
all project stacks.
