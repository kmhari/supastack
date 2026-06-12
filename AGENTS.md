# Supastack — agent guide

Supastack is a self-hosted, multi-project Supabase platform: one Docker compose
control plane that provisions N isolated full-stack Supabase projects on a
single VM. The dashboard is upstream Supabase Studio (`IS_PLATFORM=true`); the
unmodified upstream `supabase` CLI and MCP clients work against it.

## Layout

```
apps/
  api/       Fastify — /api/v1/* (dashboard) + /v1/* (Supabase Management API compat)
  worker/    BullMQ jobs — provision, lifecycle, backups, certs, pooler reconciler
  web/       React SPA — /setup wizard, /admin console, /docs pages only
  mcp/       Hosted MCP server (mcp.<apex>/mcp, OAuth 2.1)
packages/
  db/        Drizzle schema + raw .sql migrations
  shared/    Zod schemas, RBAC matrix, QUEUES constant, logger
  crypto/    Master-key envelope encryption
  oauth/     OAuth 2.1 server internals
  docker-control/  compose-template renderer + docker helpers
  backup-store/    local-disk + S3 backup stores
infra/
  docker-compose.yml       control-plane stack
  supabase-template/       per-project compose template (baked into worker image)
  studio-platform/         platform Studio image build (from kmhari/supabase#supastack-studio)
tests/       integration + installer guards + cli-e2e shell scripts
docs/        operator runbooks (docs/README.md is the index)
```

## Commands

```sh
pnpm test         # vitest, all workspaces
pnpm lint         # eslint + test-collection guard + page-coverage guard
pnpm typecheck    # tsc across workspaces
pnpm build        # all workspaces
pnpm vitest run tests/installer/   # run one suite
```

## Hard rules

- **Migrations are idempotent.** Every `packages/db/migrations/*.sql` must be
  safe to re-run (`IF NOT EXISTS` everywhere). A broken migration crash-loops
  the api at boot. Schema changes are additive unless explicitly destructive.
  Use `GENERATED AS IDENTITY`, never `CREATE SEQUENCE … OWNED BY`.
- **`/v1/*` is a compatibility contract.** The upstream Management API OpenAPI
  (https://api.supabase.com/api/v1-json) is canonical for paths and shapes —
  never invent or drift `/v1` surface. Dashboard-only endpoints go under
  `/api/v1/*`.
- **BullMQ queue names come from the shared `QUEUES` constant**
  (`@supastack/shared`) on both producer (api) and consumer (worker) sides —
  a string literal on one side silently drops jobs.
- **Per-instance state changes go through the worker**, never directly from
  the api (exception: synchronous admin actions needing immediate feedback).
  Only the worker has the docker socket.
- **RBAC**: every new admin endpoint adds an action to
  `packages/shared/src/rbac.ts` and calls `app.authorize(req, '<action>')`.
- **Secrets** are envelope-encrypted with the master key (`@supastack/crypto`);
  plaintext never leaves the api container. Never commit secrets;
  `GOTRUE_JWT_SECRET` is HKDF-derived from `MASTER_KEY`, not stored.
- **Caddy routes have TWO sources**: the boot `infra/Caddyfile` AND the runtime
  config pushed by `apps/api/src/services/caddy-config.ts`. A new route must
  land in BOTH or it works until the next cold boot (or only after one).
- **Tests cover happy AND sad paths.** `any` is lint-allowed in tests only —
  never in production code.
- **Image pins**: bumping a pin in `infra/supabase-template/docker-compose.yml`
  requires updating `INSTANCE_IMAGES` in `install.sh` (a test enforces this).

## Architecture notes

- Each project runs as compose project `supastack-<ref>` from a frozen copy of
  the template at `/var/supastack/instances/<ref>/` — template changes affect
  new provisions only.
- The platform Studio image is domain-agnostic: a placeholder apex is baked at
  `next build` and sed-substituted with `SUPASTACK_APEX` at first boot. Studio
  source changes happen in the fork (kmhari/supabase, branch
  `supastack-studio`) with every patch documented in its SUPASTACK-PATCHES.md.
- Platform images publish to Docker Hub (`kmhariharasudhan/supastack-*`),
  dual-tagged git-sha + latest. `install.sh` is the entry point for fresh
  hosts (pull mode by default — no source checkout needed).
- Operator docs live in `docs/` — update them when behavior they describe
  changes.
