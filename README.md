# Supastack

A self-hosted Supabase Cloud — provision and manage multiple full-stack
Supabase instances on your own Linux host through a web dashboard, with
per-instance HTTPS, backups, and a unified org / admin / member model.

Built because every existing OSS option was broken in production:
SupaConsole ships a fake JWT signer (instances produced with it have
non-functional API keys), and Multibase's dashboard provisioner emits
`.env` files with missing variables and `$`-shaped passwords that Docker
Compose silently mangles. Supastack ships the regression tests for both.

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
  (≥ 2.72.7) drives supastack end-to-end: login with a personal access
  token, link a local project, `supabase functions deploy`, `supabase
secrets set`, etc. No fork, no patch, no shim. See
  [`docs/supabase-cli.md`](docs/supabase-cli.md) for the connect-and-go
  guide.
- **Hosted MCP server** — paste one URL into Claude Code / Cursor / Windsurf
  / Claude Desktop, authorize in the browser, and drive all your supastack
  projects via LLM tool calls (`execute_sql`, `list_tables`, `apply_migration`,
  `deploy_edge_function`, `get_logs`, `pause_project`, `restore_project`, …).
  Same UX as Supabase Cloud's `mcp.supabase.com/mcp`. See the
  [MCP setup](#mcp-server) section below.

See [`specs/001-supastack-supabase-platform/spec.md`](specs/001-supastack-supabase-platform/spec.md)
for the full functional requirements and success criteria.

## Quickstart

On a fresh Ubuntu 22.04+ VM with a public IP:

```sh
curl -fsSL https://raw.githubusercontent.com/<you>/supastack/main/install.sh | bash
```

Or clone first and run locally:

```sh
git clone https://github.com/<you>/supastack /opt/supastack
cd /opt/supastack
./install.sh
```

The installer:

1. Installs Docker if missing.
2. Generates `MASTER_KEY` + `SESSION_SECRET` + DB password into `/opt/supastack/.env`.
3. Builds the per-instance Studio image once (~3–5 min).
4. Starts the control-plane stack (`docker compose up -d`).
5. Prints the dashboard URL.

Then point your apex DNS at the host, open the URL, and follow `/setup`.

The full step-by-step walkthrough lives in
[`specs/001-supastack-supabase-platform/quickstart.md`](specs/001-supastack-supabase-platform/quickstart.md).

## CLI setup

The upstream `supabase` CLI works against supastack with a zsh/bash wrapper that auto-injects your PAT and routes commands to your instance.

**1. Drop a `.supastack` file at your project's git root** (gitignore it — it contains your token):

```
token=sbp_your_pat_here
domain=supaviser.dev
```

**2. Add the wrapper to `~/.zshrc`** and `source ~/.zshrc`:

```zsh
# supastack + supabase wrapper:
#   - .supastack at git root → contains token= and domain= lines
#     wrapper injects SUPABASE_ACCESS_TOKEN and auto-generates
#     ~/.config/supastack/<domain>.toml, passing --profile on every invocation
#   - explicit --profile on the command line is respected (not overridden)
supabase() {
  local real_supabase
  real_supabase="$(whence -p supabase)"
  if [[ -z "$real_supabase" ]]; then
    echo "supabase: command not found" >&2; return 127
  fi

  local git_root
  git_root="$(git rev-parse --show-toplevel 2>/dev/null)"

  local extra_env=() extra_args=()

  if [[ -n "$git_root" ]]; then
    # .supastack discovery — single file with token= and domain= lines
    local supastack_file _sb_token _sb_domain
    local search_dir="$(pwd)"
    while [[ "$search_dir" == "$git_root"* ]]; do
      if [[ -f "$search_dir/.supastack" ]]; then
        supastack_file="$search_dir/.supastack"; break
      fi
      [[ "$search_dir" == "$git_root" ]] && break
      search_dir="${search_dir:h}"
    done
    if [[ -n "$supastack_file" ]]; then
      _sb_token="$(grep '^token=' "$supastack_file" 2>/dev/null | cut -d= -f2-)"
      _sb_domain="$(grep '^domain=' "$supastack_file" 2>/dev/null | cut -d= -f2-)"
      _sb_token="${_sb_token##[[:space:]]}"; _sb_token="${_sb_token%%[[:space:]]}"
      _sb_domain="${_sb_domain##[[:space:]]}"; _sb_domain="${_sb_domain%%[[:space:]]}"

      if [[ -n "$_sb_token" ]]; then
        git -C "$git_root" check-ignore -q "$supastack_file" 2>/dev/null || \
          echo "⚠ .supastack contains a token and is not gitignored" >&2
        echo "✓ Using project token (.supastack)" >&2
        extra_env+=("SUPABASE_ACCESS_TOKEN=$_sb_token")
      fi

      if [[ -n "$_sb_domain" ]]; then
        local profile_path="$HOME/.config/supastack/${_sb_domain}.toml"
        if [[ ! -f "$profile_path" ]]; then
          mkdir -p "$HOME/.config/supastack"
          cat > "$profile_path" <<TOML
# Auto-generated by supastack zsh wrapper on first use against $_sb_domain.
name          = "supastack"
api_url       = "https://api.$_sb_domain"
dashboard_url = "https://$_sb_domain/dashboard"
project_host  = "$_sb_domain"
TOML
          echo "✓ Generated supastack profile (${profile_path/#$HOME/~})" >&2
        fi
        if ! [[ " $* " =~ " --profile " ]]; then
          echo "✓ Using supastack profile (.supastack → ${profile_path/#$HOME/~})" >&2
          extra_args=(--profile "$profile_path")
        fi
      fi
    fi
  fi

  if (( ${#extra_env[@]} )); then
    env "${extra_env[@]}" "$real_supabase" "${extra_args[@]}" "$@"
  else
    "$real_supabase" "${extra_args[@]}" "$@"
  fi
  local supabase_rc=$?

  # Post-login cleanup: warn if ~/.supabase/profile is set as global default
  local subcmd arg
  for arg in "$@"; do
    case "$arg" in
      -*) ;;
      *) subcmd="$arg"; break ;;
    esac
  done
  if [[ $supabase_rc -eq 0 && "$subcmd" == "login" && -f "$HOME/.supabase/profile" ]]; then
    echo "" >&2
    echo "⚠ ~/.supabase/profile is set as the global default profile." >&2
    echo "  While that file exists, plain 'supabase login' routes to whatever" >&2
    echo "  profile it points at. Delete it to switch deployments freely." >&2
    if read -q "REPLY?  Delete ~/.supabase/profile now? [y/N] "; then
      echo "" >&2
      rm -f "$HOME/.supabase/profile"
      echo "  ✓ Removed ~/.supabase/profile" >&2
    else
      echo "" >&2
      echo "  Keeping it. 'rm ~/.supabase/profile' when you need to switch." >&2
    fi
  fi

  return $supabase_rc
}
```

On first use the wrapper auto-generates `~/.config/supastack/<domain>.toml` (the CLI profile pointing at `api.<domain>`) and passes `--profile` on every invocation. To switch back to Supabase Cloud, `cd` out of any directory containing a `.supastack` file, or pass `--profile supabase` explicitly.

## MCP server

Supastack ships a hosted multi-project MCP server at `mcp.<apex>/mcp`, backed by an OAuth 2.1 authorization server. No token management needed — authorize once in the browser and every LLM tool call routes to the right project automatically.

### Connect your editor

Paste into your MCP client config. For Claude Code (`~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "supastack": {
      "type": "http",
      "url": "https://mcp.<your-apex>/mcp"
    }
  }
}
```

Same URL works for Cursor, Windsurf, and Claude Desktop (format varies by editor). On the first MCP call your browser opens to the supastack authorize page — if you're already logged into the dashboard, click **Authorize** and the tab closes automatically.

### DNS

`mcp.<apex>` must resolve to the same A-record as `api.<apex>`. The existing wildcard cert covers it — no extra provisioning needed.

### Available tools

| Tool | What it does |
|---|---|
| `list_projects` / `get_project` | List and inspect projects |
| `execute_sql` | Run ad-hoc SQL against a project |
| `list_tables` / `list_extensions` / `list_migrations` | Schema introspection |
| `apply_migration` | Push a migration to a project |
| `generate_typescript_types` | Generate TS types from the project schema |
| `list_edge_functions` / `deploy_edge_function` | Manage Edge Functions |
| `get_logs` | Fetch project logs |
| `list_storage_buckets` | List storage buckets |
| `pause_project` / `restore_project` | Lifecycle control |
| `list_organizations` / `get_organization` | Org info |
| `search_docs` | Search Supabase docs |

### Revoke a client

Open **`/settings/mcp-clients`** in the dashboard. Each row shows the client name, when it was authorized, last used, and a **Revoke** button. Revocation takes effect within ~5 seconds.

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
       │ Supastack Web │   React + Vite dashboard
       └──────┬───────┘
              │
              ↓                       ┌─────────────────────────────────┐
       ┌──────────────┐        ┌─────→│ supastack-<ref> compose project  │
       │ Supastack API │←──┐    │      │ db + auth + rest + realtime +  │
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
       │ Supastack Worker (BullMQ)     │
       │  provision  lifecycle        │
       │  backup     backup-scheduler │
       │  caddy-reload  health-recon  │
       └──────────────────────────────┘
```

## Management API compatibility

Supastack implements a subset of Supabase's Management API at `/v1/*` so the upstream `supabase` CLI works against a self-hosted instance for the workflows we back. The canonical source of truth for endpoint shapes, validation bounds, and field lists is the upstream OpenAPI spec:

**[https://api.supabase.com/api/v1-json](https://api.supabase.com/api/v1-json)**

When implementing or modifying a `/v1/*` endpoint, match upstream's request and response shapes byte-for-byte where reasonable. A pinned snapshot lives alongside the feature that introduces each endpoint (e.g. `specs/009-runtime-config-tunables/upstream-openapi-snapshot.json`) so validation bounds don't drift silently.

Endpoints we haven't implemented return a structured `501 not_implemented` envelope identifying the missing feature — see `apps/api/src/routes/management/not-implemented.ts`.

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
| `specs/001-supastack-supabase-platform/` | Speckit spec + plan + research + contracts + tasks                             |

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
