# Supastack

A self-hosted Supabase Cloud. Provision and manage **many** isolated Supabase
projects on a single Linux host through a web dashboard — each with its own
Postgres, Auth, Storage, Realtime, Edge Functions, and Studio, behind
per-project HTTPS.

The upstream `supabase` CLI works against it unmodified for the workflows it
supports.

## What you get

- **One operator, N projects** on one VM — each fully isolated (`supastack-<ref>-*`).
- **Web dashboard** at `https://<apex>/dashboard` — create / pause / resume / restart / delete projects.
- **Per-project HTTPS** — `https://<ref>.<apex>` via a wildcard Let's Encrypt cert.
- **Direct + pooled Postgres** — `db.<ref>.<apex>:5432` and `pooler.<apex>:6543`.
- **Backups** — on-demand + daily, local disk or S3-compatible (MinIO / R2 / B2).
- **Multi-user orgs** — Owner / Administrator / Developer / Read-only roles, email invites.
- **CLI + MCP compatible** — `supabase login`, `db push`, `functions deploy`; hosted MCP at `mcp.<apex>/mcp`.

## Start here

1. [Installation](Installation) — get the control plane running on a fresh VM.
2. [Configuration](Configuration) — the `.env` secrets reference.
3. [DNS & TLS](DNS-and-TLS) — apex A record + wildcard cert.
4. [First-Time Setup](First-Time-Setup) — the `/setup` wizard.
5. [Creating & Connecting Projects](Creating-and-Connecting-Projects).

## At a glance

| | |
|---|---|
| **Host** | Linux (Ubuntu 22.04+), public IP, Docker + Compose v2 |
| **Control plane** | `db` · `redis` · `api` · `worker` · `web` · `caddy` · `supavisor` |
| **Per project** | `db` · `auth` · `rest` · `storage` · `realtime` · `meta` · `functions` · `analytics` · `vector` · `imgproxy` · `studio` · `kong` |
| **Ports** | 80 / 443 (Caddy) · 5432 (direct PG) · 6543 (pooler) |
| **Dashboard** | `https://<apex>/dashboard` |
