# Supastack — Self-Hosted Supabase Cloud

## Context

You want a Supabase Cloud–style control plane for self-hosted Supabase: one place to create, list, pause, back up, and reach multiple full-stack Supabase projects on your own VM. Existing OSS options fall short:

- **SupaConsole** has no LICENSE and ships a *fake* JWT signer (`generateJWT()` uses a random 43-char string as the signature) — instances created by it have non-functional API keys.
- **Multibase** is MIT but the dashboard provisioner is broken in three concrete ways we observed in this session: (a) `dashboard/frontend/src/lib/` is gitignored so the API client file is missing from the repo, (b) `launch.sh` writes the dev's own home dir (`/home/osobh/...`) into the backend `.env`, (c) UI-created instances generate `.env` files missing ~20 variables that the CLI-created ones have, plus passwords containing `$VAR`-shaped substrings that Docker Compose interprets as variable substitutions (e.g., `huntvox/.env: POSTGRES_PASSWORD=...$GINIWZBA8`).

Intended outcome: a focused new project, **supastack**, that mirrors the patterns of `/Users/lord/Code/open-frontend` (Fastify + Drizzle + BullMQ + Caddy with HTTP-01 per-subdomain TLS) and provisions Supabase instances correctly the first time. Single VM, single org with invited collaborators, admin-grade dashboard.

This plan is the v1 implementation blueprint.

## Locked Decisions

| Axis | Decision |
|---|---|
| Project name | **supastack** |
| Relationship to open-frontend | New repo, copy patterns (no shared code, no runtime dep) |
| Control-plane DB | Plain Postgres (not self-hosted Supabase) |
| Multi-host | **Single-host only**, no `host_id` in schema |
| Tenancy | Single org, multiple users, invite-by-email |
| Roles | Admin / Member (2-tier; no Owner role since no billing) |
| Instance shape | Full upstream Supabase stack (13 containers) |
| Identifier | Immutable random 20-char `ref` + editable `name` |
| Subdomain layout | One sub per instance: `<ref>.<apex>` (Kong) + `<ref>.<apex>/studio` (Studio at sub-path) |
| Caddy | **Own** Caddy container + `/internal/tls/ask` pattern (HTTP-01 per-sub) |
| Lifecycle v1 | Create / list / get / delete + pause/resume + version upgrade |
| Backups v1 | On-demand + daily auto (retain 7, toggleable per-instance) |
| Restore v1 | **Not in v1** — `.dump` files only, manual `pg_restore` |
| Secrets at rest | AES-256-GCM in control DB, KEK from `MASTER_KEY` env |
| Backup store | Pluggable `BackupStore` interface; impls: `LocalDiskStore` + `S3Store` |
| Per-instance config | Create-time prompts only; post-create edits are out of band |
| Theme | Clone `supabase/supabase`, lift Tailwind config + tokens + components from `apps/studio` |
| Existing Multibase | Wipe (`docker compose down -v` on demo + huntvox, `rm -rf ~/multibase`) |
| Surfaces v1 | Web dashboard + REST API + Bearer tokens |
| CLI / MCP | Out of v1; design API so they slot in later |
| Auth | Email + password (Argon2id), session cookies + Bearer tokens |
| Tech stack | TypeScript everywhere; Fastify 4, Drizzle ORM, BullMQ, React 18 + Vite, Postgres 16, Redis 7, Caddy 2, dockerode, pnpm monorepo |

## Repo Layout

```
supastack/
├── apps/
│   ├── api/                  # Fastify control-plane API
│   │   └── src/
│   │       ├── routes/       # /setup, /auth, /orgs, /instances, /backups, /caddy/tls-ask
│   │       ├── plugins/      # auth, rbac, error, cors, helmet
│   │       └── server.ts
│   ├── web/                  # React + Vite dashboard
│   │   └── src/
│   │       ├── lib/api.ts    # axios client; uses VITE_API_URL='' → relative '/api'
│   │       ├── pages/        # Setup, Login, Instances, InstanceDetail, Backups, Members
│   │       └── theme/        # Tailwind config + tokens lifted from upstream supabase/studio
│   ├── worker/               # BullMQ workers
│   │   └── src/jobs/
│   │       ├── provision.ts  # docker compose up -d for new instance
│   │       ├── lifecycle.ts  # pause / resume / restart / delete / upgrade
│   │       ├── backup.ts     # pg_dump → BackupStore
│   │       ├── caddy-reload.ts
│   │       └── backup-scheduler.ts  # cron tick → enqueue daily backups
│   └── caddy/                # Caddy container config (mounted in compose)
│       └── Caddyfile         # static skeleton; routes generated at runtime via admin API
├── packages/
│   ├── db/                   # Drizzle schema + migrations
│   ├── shared/               # types, zod schemas, RBAC action set
│   ├── crypto/               # AES-256-GCM, Argon2id, JWT HS256 (real)
│   ├── docker-control/       # dockerode wrappers + compose-template engine
│   └── backup-store/         # BackupStore interface + LocalDiskStore + S3Store
├── infra/
│   ├── docker-compose.yml    # supastack stack: postgres, redis, caddy, api, worker, web
│   └── supabase-template/    # vendored copy of supabase/docker/* (the stack we template per instance)
├── install.sh                # one-shot installer (similar to /Users/lord/Code/superbase/install.sh)
├── package.json              # pnpm workspace root
└── README.md
```

## Critical Patterns Borrowed From open-frontend

Read these files in open-frontend during implementation as reference:

| Concern | File in open-frontend | Use for |
|---|---|---|
| First-time setup endpoint | `apps/api/src/routes/setup.ts` | Argon2id user, org, optional apex registration in one POST |
| Auth plugin (Bearer + session) | `apps/api/src/plugins/auth.ts` | `req.user`, SHA256-hashed API tokens in DB |
| RBAC | `apps/api/src/plugins/rbac.ts` + `packages/shared/src/rbac.ts` | `app.authorize(req, action, {orgSlug})` |
| Caddy config generation | `apps/edge/src/reload.ts` + `apps/api/src/services/caddy-reload.ts` | atomic POST to `/config` on Caddy admin :2019 |
| TLS-ask gating | `apps/api/src/tls-ask/route.ts` | `GET /internal/tls/ask?domain=<host>` → 200/404 |
| Wildcard cert flow (skip in v1) | `apps/api/src/routes/wildcard-cert.ts` | reference only — we use HTTP-01 per-sub, no wildcards |
| Schema patterns | `packages/db/schema/identity.ts`, `domains.ts` | users / orgs / orgMembers / apiTokens / domains |

**Do not import from open-frontend.** Copy the patterns; supastack has no runtime dependency on open-frontend running.

## Schema (Drizzle, Postgres)

Critical tables (column lists abbreviated to types where obvious):

```ts
// packages/db/schema/identity.ts
users          (id uuid pk, email citext unique, hashed_password text, created_at, updated_at)
org            (id uuid pk, name text, apex_domain text nullable, created_at, updated_at)
                // single-row org table; FK targets below all reference org.id
org_members    (org_id, user_id, role text check role in ('admin','member'), pk(org_id,user_id))
api_tokens     (id uuid pk, user_id, token_sha256 bytea unique, label text, last_used_at, created_at)
sessions       (sid text pk, user_id, expires_at)  // or use @fastify/session w/ Redis store
setup_state    (singleton row, completed_at timestamptz)  // gates /setup

// packages/db/schema/instances.ts
supabase_instances (
  ref            text pk,                       // 20-char random, immutable
  name           text not null,                 // editable display name
  status         text check in ('provisioning','running','paused','stopped','failed','deleting'),
  supabase_version text not null,               // e.g. '2024.11.05'
  encrypted_secrets bytea not null,             // AES-256-GCM-encrypted JSON blob: { jwt_secret, anon_key, service_role_key, postgres_password, dashboard_password, ... }
  port_kong      int unique not null,           // host port for Kong (subdomain target)
  port_studio    int unique not null,           // host port for Studio
  port_postgres  int unique not null,           // internal only, not externally exposed
  port_pooler    int unique not null,           // internal only
  port_analytics int unique not null,           // internal only
  create_smtp_host text, create_smtp_port int, create_smtp_user text,
  create_smtp_pass_encrypted bytea,             // also encrypted
  create_enable_signup boolean default true,
  create_jwt_expiry_sec int default 3600,
  backup_auto_enabled boolean default true,
  backup_retain int default 7,
  created_at, updated_at
)

port_allocations (port int pk, kind text, instance_ref text nullable)
  // unique constraint forces atomic allocation; nullable instance_ref allows reservation

// packages/db/schema/backups.ts
backups (
  id uuid pk,
  instance_ref text fk → supabase_instances.ref,
  kind text check in ('manual','auto'),
  store text check in ('local','s3'),
  store_key text not null,                      // path or S3 key
  size_bytes bigint,
  status text check in ('running','completed','failed'),
  error text nullable,
  started_at, completed_at
)

// packages/db/schema/audit.ts (optional but cheap to add)
audit_log (id, user_id, action, target_kind, target_id, payload jsonb, created_at)
```

Migrations are idempotent (per your global rule). Use Drizzle's `migrate()` on boot.

## Provisioning Flow

`POST /api/v1/instances` with `{ name, supabaseVersion?, smtp?, enableSignup?, jwtExpirySec? }`:

1. **Authorize**: `app.authorize(req, 'instance.create')`.
2. **Generate `ref`**: 20 lowercase alphanumeric chars from CSPRNG (matches Cloud format).
3. **Allocate ports atomically**: insert 5 rows into `port_allocations` inside a transaction, scanning a configured range (e.g., 30000–39999), retry on conflict.
4. **Generate secrets** (`packages/crypto`):
   - `jwt_secret`: 40 random bytes, base64.
   - `anon_key`, `service_role_key`: **real HS256 JWT** signed with `jwt_secret`. Payload mirrors upstream: `{ role: "anon" | "service_role", iss: "supabase", iat, exp: iat + 5y }`. Use `jsonwebtoken`. NEVER produce a fake signature.
   - `postgres_password`: 32 random alphanumerics. **Must not contain `$`** (Docker Compose substitution bug we observed in Multibase). Use a charset of `[A-Za-z0-9]` only.
   - `dashboard_password`: 16 random alphanumerics.
5. **Encrypt** all secrets with KEK (from `MASTER_KEY` env, 32 bytes) → AES-256-GCM. Store the IV+ciphertext+tag blob in `supabase_instances.encrypted_secrets`.
6. **Insert** the `supabase_instances` row with status='provisioning'.
7. **Enqueue** BullMQ job `provision({ ref })`.
8. **Return** `{ ref, name, status: 'provisioning' }`.

Worker `provision` handler (`apps/worker/src/jobs/provision.ts`):

1. Read row, decrypt secrets.
2. Create `/var/supastack/instances/<ref>/` directory.
3. Copy `infra/supabase-template/*` into it.
4. Generate `.env` from a **complete** template (catch-all for every variable upstream uses — referenced from a known-good `.env.example` pinned to the Supabase version). Specifically:
   - All generated secrets
   - All ports
   - `SUPABASE_PUBLIC_URL=https://<ref>.<apex>`
   - `API_EXTERNAL_URL=https://<ref>.<apex>`
   - `SITE_URL=https://<ref>.<apex>`
   - `STUDIO_PORT`, `KONG_HTTP_PORT`, etc. from allocated ports
   - `NEXT_PUBLIC_BASE_PATH=/studio` for the Studio service (constant — same for every instance because Studio always lives at `/studio` on its instance's own subdomain)
   - **`DOCKER_SOCKET_LOCATION=/var/run/docker.sock`** (the var Multibase forgot)
   - All `MAILER_URLPATHS_*`, `ENABLE_*`, `PGRST_DB_SCHEMAS`, `POOLER_*` — every var the upstream compose references must be set, even if empty-string
   - SMTP values from create-time form (encrypted at rest, decrypted only when writing this `.env`)
5. `docker compose -p supastack-<ref> --env-file .env up -d`.
6. Poll `docker compose ps` until all containers are healthy or 3-minute timeout.
7. Register two routes via Caddy admin API (atomic config replace, see below):
   - `<ref>.<apex>` → `127.0.0.1:<port_kong>` with `handle /studio*` → `127.0.0.1:<port_studio>` and `handle /*` → Kong
8. Update `supabase_instances.status = 'running'`.
9. On any error: capture into `audit_log`, set status='failed', leave instance dir for inspection.

## Caddy + TLS

`infra/docker-compose.yml` includes a Caddy 2 container with admin API enabled on `:2019` (bound to control-plane network only):

```Caddyfile
{
  admin :2019
  on_demand_tls {
    ask http://api:3001/internal/tls/ask
  }
}

# Static skeleton — instance routes are injected via admin API
:80 {
  redir https://{host}{uri}
}

# Note: per-instance routes are added at runtime by apps/worker/src/jobs/caddy-reload.ts
# Each instance adds a server block:
#   <ref>.<apex>:443 {
#     tls { on_demand }
#     handle /studio* { reverse_proxy 127.0.0.1:<port_studio> }
#     handle          { reverse_proxy 127.0.0.1:<port_kong> }
#   }
```

`apps/worker/src/jobs/caddy-reload.ts`:
- Read all `supabase_instances` with status in (`running`, `paused`).
- Build the full Caddy JSON config (`apps/api/src/services/caddy-config.ts`).
- `POST http://caddy:2019/load` with the config (atomic swap).

`apps/api/src/routes/tls-ask.ts`:
- `GET /internal/tls/ask?domain=<host>` — only callable from Caddy container (network-isolated).
- Returns 200 if `<host>` matches `<ref>.<apex>` for any non-deleted instance, else 404. Apex itself (control-plane host) also returns 200.

This is **identical in shape** to open-frontend's TLS-ask, so HTTP-01 per-subdomain works without any DNS API calls. No wildcard certs.

## Studio Embedding — Key Implementation Note

The user picked "path-rewrite with per-instance Studio image", but a useful simplification: **because every instance has its own subdomain, the Studio basePath is the same constant (`/studio`) for every instance.** No per-instance image build needed.

- **Build Studio image once** during supastack setup: `NEXT_PUBLIC_BASE_PATH=/studio` baked in at build time.
- Pin to a known-good upstream Studio commit.
- Reference that image in `infra/supabase-template/docker-compose.yml`.
- Caddy routes `<ref>.<apex>/studio/*` to the per-instance Studio container; everything else to Kong.
- Dashboard "Open Studio" button links to `https://<ref>.<apex>/studio/project/default` (Studio's self-hosted mode uses `default` as the project slug internally).

Optional in v1.5: iframe Studio inside the dashboard chrome at `/p/<ref>/studio` for embedded UX. Same URL behind the scenes.

## Backup Pipeline

`packages/backup-store/src/index.ts`:

```ts
export interface BackupStore {
  put(ref: string, stream: Readable, sizeHint?: number): Promise<{ id: string; key: string; size: number }>;
  get(key: string): Promise<Readable>;
  delete(key: string): Promise<void>;
  list(ref: string): Promise<{ key: string; size: number; createdAt: Date }[]>;
}
```

Impls in v1:
- `LocalDiskStore({ root: '/var/supastack/backups' })` → writes to `<root>/<ref>/<timestamp>.dump`.
- `S3Store({ bucket, region, accessKeyId, secretAccessKey })` → `s3://<bucket>/<ref>/<timestamp>.dump`.

Worker `backup` job (`apps/worker/src/jobs/backup.ts`):
1. Insert `backups` row, status='running'.
2. `docker exec supastack-<ref>-db pg_dump -U postgres -Fc postgres` → stream into chosen `BackupStore`.
3. Update row status='completed' with size + key, or 'failed' with error.

Worker `backup-scheduler` (`apps/worker/src/jobs/backup-scheduler.ts`):
- BullMQ repeatable job, fires hourly.
- Picks instances with `backup_auto_enabled = true` whose last successful backup is >24h old → enqueue `backup` job.
- Retention cleanup: for each instance, keep the most recent N (`backup_retain`) successful backups, delete the rest from the store + DB.

## First-Time Setup

Mirrors open-frontend's `/api/v1/setup` exactly:

1. Operator runs `install.sh`:
   - Installs Docker / Compose if missing
   - Clones supastack repo to `/opt/supastack`
   - Generates `MASTER_KEY=$(openssl rand -hex 32)`, `SESSION_SECRET=$(openssl rand -hex 32)`, control-DB password
   - Writes `/opt/supastack/.env`
   - `docker compose pull && docker compose up -d`
   - Prints: "Open http://<host>/setup"

2. `GET /api/v1/setup/status`:
   - 200 if no users yet → frontend renders setup form.
   - 410 if setup already complete → frontend redirects to /login.

3. `POST /api/v1/setup` with `{ email, password, orgName, apexDomain? }`:
   - Idempotency: re-check setup is unlocked inside transaction.
   - Hash password (Argon2id), create user, create org (singleton row), create org_members row (role='admin'), set `setup_state.completed_at`.
   - If `apexDomain` provided: insert into `org.apex_domain`, trigger Caddy reload (apex becomes routable for the dashboard itself).
   - Generate a master API token, return once: `{ userId, orgId, apiToken }`.

4. After setup, the operator logs in via `/login` (email+password → session cookie + optional Bearer token via `/api/v1/auth/tokens`).

5. **Invite flow**: `POST /api/v1/members/invites` creates a one-time link emailed via the org's SMTP config (or printed in dev). 24h validity, matches Cloud.

## Web Dashboard Surface (v1)

| Route | Purpose |
|---|---|
| `/setup` | First-time super-admin creation form (shown only when status=open) |
| `/login` | Email + password |
| `/` | Instance list with status pills, "Create Instance" CTA |
| `/instances/new` | Create form: name, SMTP (optional), signup toggle, JWT expiry |
| `/p/<ref>` | Instance detail: status, ports, [reveal] credentials, action buttons |
| `/p/<ref>/backups` | Backup list + create + download links + retention toggle |
| `/p/<ref>/studio` | Link to `https://<ref>.<apex>/studio` (v1: new tab; v1.5: iframe) |
| `/settings/org` | Org name + apex domain edit |
| `/settings/members` | List + invite + remove |
| `/settings/tokens` | API tokens (create, list, revoke) |

Visual style: clone `supabase/supabase` at a pinned commit, copy:
- `apps/studio/tailwind.config.ts` (extended palette + plugins)
- `apps/studio/ui/` shared components (Button, Input, Modal, Toast — only what we need)
- Design tokens from `packages/common/CSS variables`

Do not vendor the entire monorepo — just the design system bits, kept under `apps/web/src/theme/`.

## v1 In / Out

**In v1:**
- First-time setup, login, sessions, Bearer tokens
- Single org, Admin + Member roles, invite + revoke
- Create / list / get / delete instance
- Pause / resume / restart instance
- Per-instance credentials viewer (reveal-on-click with re-auth)
- Per-instance subdomain via HTTP-01 (HTTPS automatic on first request)
- Backups: on-demand + daily auto + retention
- Backup destination: local disk or S3 (configurable per-org)
- Version upgrade per instance (pull + recreate, optional backup-first)
- Studio at `<ref>.<apex>/studio` (new tab link)

**Explicitly out of v1 (do not build):**
- Restore from backup (manual `pg_restore` for now)
- CLI
- MCP server
- Multi-host scheduling, host agents
- Wildcard certs (HTTP-01 per-sub is the only TLS path)
- Project-scoped permissions (admin/member are org-wide)
- Soft-delete with grace period (delete = immediate)
- Branching, edge-functions deploy, custom domains per instance
- Auto-pause on idle
- Real-time logs / metrics dashboard
- Audit log UI (table exists; surface in v1.5)
- Read-only role
- OAuth / SAML SSO
- Billing, quotas
- Studio iframe-embedded chrome (v1: open-in-new-tab; v1.5 adds iframe wrapper)

## Build Sequence

Rough ordering. Each step ships something demoable.

1. **Repo scaffold + control-plane stack** (`infra/docker-compose.yml`): Postgres, Redis, Caddy admin :2019, empty API+worker+web. `docker compose up` produces a green health check.
2. **Schema + migrations** (Drizzle): identity tables only first, then instances + ports + backups + audit.
3. **Auth + first-time setup**: copy patterns from open-frontend's `routes/setup.ts` and `plugins/auth.ts`. Web `/setup` and `/login` pages.
4. **Org + members + invites**: list, invite (one-time link), revoke.
5. **Caddy admin-API integration**: implement `caddy-config.ts` + `caddy-reload.ts` + `tls-ask` endpoint. Verify by manually inserting a fake instance row and seeing apex serve through Caddy with auto-issued cert.
6. **Vendor `infra/supabase-template/`**: pin a Supabase version, copy `supabase/docker/*` into the repo, document the upgrade-template procedure.
7. **`crypto` package**: AES-256-GCM, Argon2id, real HS256 JWT signer. Unit-test against known vectors. Make sure generated passwords never contain `$`.
8. **`docker-control` package**: compose-template engine (`.env` from a known-complete `.env.example`), dockerode wrappers for up/down/ps/exec.
9. **Provision worker job**: end-to-end create-instance from API → Caddy route → first HTTPS request issues cert. Verify the resulting Supabase instance accepts a request signed by its `service_role_key`.
10. **Lifecycle worker jobs**: pause / resume / restart / delete / upgrade.
11. **Backup pipeline**: `BackupStore` interface + LocalDiskStore + S3Store + on-demand + daily scheduler.
12. **Web dashboard pages**: Instances list, detail, backups, settings. Theme-lift from supabase/studio.
13. **`install.sh`** on a fresh VM: end-to-end smoke (provision supastack → setup → create instance → reach Studio).

Roughly 2–3 weeks of focused work for one person. Steps 1–6 are pure infrastructure (~1 week). Steps 7–10 are the value (~1 week). Steps 11–13 are polish (~3–5 days).

## Verification

End-to-end smoke test after `install.sh` completes on a fresh VM:

1. `curl -s http://<host>/api/v1/setup/status` → 200 with `{"open": true}`.
2. POST to `/api/v1/setup` with operator credentials + apex domain → 201 with master token.
3. Login via web at `https://<apex>` (cert auto-issued, served by Caddy).
4. Create instance "test" via the dashboard.
5. Within ~90 seconds, instance status flips to 'running'. UI shows two URLs: `https://<ref>.<apex>` (Kong) and `https://<ref>.<apex>/studio`.
6. Click "Reveal" on the credentials panel, copy `anon_key`. Run:
   ```bash
   curl -H "apikey: <anon_key>" https://<ref>.<apex>/rest/v1/
   ```
   Expect a `200` with `{ "swagger": ... }`. Confirms Kong + PostgREST + signed JWT validation all work — this is the SupaConsole test that would fail.
7. Open `https://<ref>.<apex>/studio` — Studio loads with all assets served under `/studio` correctly (no 404s on JS/CSS).
8. Trigger an on-demand backup. Wait. Confirm a `.dump` file appears at `/var/supastack/backups/<ref>/<timestamp>.dump`. `pg_restore --list` against it lists the public schema.
9. Toggle daily auto off, confirm scheduler skips it. Toggle back on, confirm scheduler picks it up within the next hourly tick.
10. Pause the instance. Containers `Exit 0`. Resume. They come back. Volume data intact.
11. Open a second browser, invite a Member via dashboard. Accept invite via the emailed (or logged) one-time link. Confirm Member can see the instance list but can't see the Delete button.
12. Issue a Bearer token. `curl -H "Authorization: Bearer <token>" http://<host>/api/v1/instances` → 200 returns the list.
13. Smoke the failure modes:
    - Try to create an instance with name 256 chars long → 400.
    - Try to delete via Member account → 403.
    - Stop the Caddy container, restart it — instance routes are restored on next reload trigger.
    - Kill `MASTER_KEY` env var, restart api — startup fails fast with a clear error (never silently fall back to plaintext).

If all 13 steps pass on a fresh VM in a single run of `install.sh` + 5 minutes of clicking, v1 is done.

## Bugs Explicitly Not To Repeat

Lessons from SupaConsole + Multibase + our own first-pass install.sh:

1. **JWT signatures**: use `jsonwebtoken` library with HS256. Never produce a fake/random signature. Unit test that the generated `anon_key` validates against the same `jwt_secret`.
2. **Port allocation**: DB-tracked with unique constraint inside a transaction. Never `Date.now() % N`.
3. **`.env` generation**: derive from a pinned upstream `.env.example` — never hand-maintain a subset. Every variable upstream's compose references must be present, even if empty-string.
4. **Password charset**: alphanumeric only. No `$`. Test that generated passwords round-trip through Docker Compose unchanged.
5. **`DOCKER_SOCKET_LOCATION`**: always set explicitly to `/var/run/docker.sock`.
6. **Hardcoded paths**: no developer-home paths anywhere. All paths derive from runtime env or relative project root.
7. **Gitignore hygiene**: do not put `lib/` in `.gitignore` — too aggressive. Ignore `node_modules/`, `.venv/`, `dist/`, `.env*`, build artifacts. Run `git check-ignore -v src/lib/api.ts` in CI to assert that source code never gets ignored.
8. **Vite `allowedHosts`**: don't hardcode dev-team hostnames. Either `true` for dev or accept a runtime env.
9. **`VITE_API_URL`**: ship empty by default → axios uses relative `/api` → Vite proxies in dev, reverse-proxy handles in prod. Never bake `localhost:3001` into client JS.
10. **Two control planes**: avoid the Multibase trap of CLI + dashboard both mutating state. The API is the single writer; CLI/MCP (future) call the API.
