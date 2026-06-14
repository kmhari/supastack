# Containers & Update Runbook

Every container Supastack runs, where its version is pinned, and how to update it.
An automated upgrade pipeline is planned but not yet built — this documents the **manual** reality.

## The three categories

| #   | Category                                                         | Compose file                                                                       | Where it runs                                                                                           | Update granularity                         |
| --- | ---------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- | ------------------------------------------ |
| 1   | **Control plane** — the Supastack platform itself                | `infra/docker-compose.yml`                                                         | `/opt/supastack` on the VM, one stack                                                                   | Whole-VM, operator-driven                  |
| 2   | **Platform Studio** — shared Supabase Studio, `IS_PLATFORM=true` | `studio` service inside the control-plane compose                                  | Same stack — prebuilt `kmhariharasudhan/supastack-studio-platform` image with runtime apex substitution | Fork sync → image rebuild → `up -d studio` |
| 3   | **Per-project Supabase stacks** — stock upstream images          | `infra/supabase-template/docker-compose.yml`, **copied per instance** at provision | `/var/supastack/instances/<ref>` (compose project `supastack-<ref>`)                                    | Per-instance, via API                      |

---

## 1. Control plane

### 1a. Custom Supastack images (built from this repo)

| Service  | Image                                                                           | Build context                                                                                                                        | Purpose                                                                                           |
| -------- | ------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------- |
| `api`    | `kmhariharasudhan/supastack-api:${SUPASTACK_VERSION:-latest}`                   | `apps/api/Dockerfile`                                                                                                                | Fastify — `/api/v1/*` dashboard + `/v1/*` Management API + platform proxy + pg-edge-proxy (:5432) |
| `worker` | `kmhariharasudhan/supastack-worker:${SUPASTACK_VERSION:-latest}`                | `apps/worker/Dockerfile`                                                                                                             | BullMQ — provision, lifecycle, backups, cert renewal, pooler reconciler, observer                 |
| `mcp`    | `kmhariharasudhan/supastack-mcp:${SUPASTACK_VERSION:-latest}`                   | `apps/mcp/Dockerfile`                                                                                                                | Hosted MCP at `mcp.<apex>/mcp`                                                                    |
| `web`    | `kmhariharasudhan/supastack-web:${SUPASTACK_VERSION:-latest}`                   | `apps/web/Dockerfile`                                                                                                                | Legacy SPA — `/setup` wizard only                                                                 |
| `studio` | `kmhariharasudhan/supastack-studio-platform:${STUDIO_PLATFORM_VERSION:-latest}` | `infra/studio-platform/Dockerfile` (context = the [kmhari/supabase](https://github.com/kmhari/supabase) `supastack-studio` checkout) | Shared platform Studio, `IS_PLATFORM=true` — domain-agnostic via runtime apex substitution (§2)   |

**Key facts**

- **Published on Docker Hub** (public): `kmhariharasudhan/supastack-{api,worker,mcp,web,studio-platform}`, dual-tagged `<git-sha>` + `latest`. **Pin by sha in production** (`SUPASTACK_VERSION=<sha>` in `infra/.env`): `latest` is a moving pointer — a stray `pull && up -d` would silently upgrade, api/worker could skew apart (shared queue contracts), and api auto-runs migrations on boot. `latest` is for quickstarts only.
- Building your own: build from a **clean clone** of this repo (a lived-in checkout risks baking stray local files); pushing to a registry needs `docker login` with publish rights.
- The repo has **no GitHub releases yet** — "upgrade to release vX.Y" is still aspirational (see _Gaps_, below).
- Control-plane DB migrations (`packages/db/migrations/*.sql`) **auto-apply at api boot** (`server.ts` → `migrate()`). A broken migration crash-loops the api container — migrations must stay idempotent.

**Update procedure (pull mode — the default install)**

```sh
# 1. On the VM: bump the pin to the new image sha
cd /opt/supastack
sed -i 's/^SUPASTACK_VERSION=.*/SUPASTACK_VERSION=<new-sha>/' infra/.env

# 2. Pull + recreate
sudo docker compose -f infra/docker-compose.yml pull
sudo docker compose -f infra/docker-compose.yml up -d
```

**Update procedure (build mode — source checkout on the VM)**

```sh
# 1. From your machine: sync source to the VM
rsync -az --delete --exclude node_modules --exclude .git \
  ./ ubuntu@<vm>:/opt/supastack/

# 2. On the VM: source env, rebuild + recreate the changed service(s)
cd /opt/supastack/infra
set -a; source ../.env; set +a
# GOTRUE_JWT_SECRET is NOT in .env — it is HKDF-derived from MASTER_KEY:
export GOTRUE_JWT_SECRET=$(MASTER_KEY="$MASTER_KEY" node ../scripts/derive-gotrue-secret.mjs | cut -d= -f2-)

sudo -E docker compose build api worker   # whichever changed
sudo -E docker compose up -d api worker
```

Per-service guidance:

| Changed                                           | Rebuild              | Notes                                                                                                                                                                                |
| ------------------------------------------------- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `apps/api`                                        | `api`                | Migrations apply on boot; watch `docker compose logs -f api` for migrate errors                                                                                                      |
| `apps/worker`                                     | `worker`             | Env additions need **recreate** (`up -d`), not `restart` — `docker restart` does not reload env                                                                                      |
| `apps/mcp`, `packages/oauth`                      | `mcp`                |                                                                                                                                                                                      |
| `apps/web`                                        | `web`                |                                                                                                                                                                                      |
| `infra/Caddyfile`                                 | nothing (bind-mount) | `docker compose restart caddy`; runtime routes also come from api's `caddy-config.ts` (admin :2019) — after a caddy recreate, re-push them via `POST api:3001/internal/caddy/reload` |
| `packages/*` (shared, db, crypto, docker-control) | every consumer       | `shared`/`db` → api **and** worker; `oauth` → api + mcp                                                                                                                              |
| `infra/supabase-template/*`                       | nothing              | Affects **new provisions only** — see §3                                                                                                                                             |

### 1b. Vendor images (pulled, pinned in `infra/docker-compose.yml`)

| Service     | Image                      | Purpose                                                                                                            | Update caution                                                                                                                           |
| ----------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| `db`        | `postgres:16-alpine`       | Control-plane Postgres (Drizzle schema)                                                                            | Minor-tag bumps fine; **major version = pg_upgrade/dump-restore — do not just bump**                                                     |
| `redis`     | `redis:7-alpine`           | BullMQ queues + revocation lists                                                                                   | Queue jobs in flight are durable; safe to bounce                                                                                         |
| `auth`      | `supabase/gotrue:v2.186.0` | Control-plane dashboard auth                                                                                       | Same image is pinned in the per-project template — keep both in sync intentionally                                                       |
| `supavisor` | `supabase/supavisor:2.7.4` | Top-level multi-tenant pooler (`pooler.<apex>:6543`)                                                               | Tenants re-reconciled by the daily pooler reconciler; verify with the active probe after bump                                            |
| `caddy`     | `caddy:2.11-alpine`        | Edge TLS :80/:443 + on-demand TLS gate; boot config = bind-mounted `infra/Caddyfile`, runtime routes pushed by api | Stock image (:5432 SNI lives in the api's pg-edge-proxy, not Caddy); after recreate, re-push runtime routes via `/internal/caddy/reload` |

**Update procedure**

```sh
# 1. Edit the tag in infra/docker-compose.yml (commit it — the pin is the source of truth)
# 2. On the VM:
cd /opt/supastack/infra && set -a; source ../.env; set +a
sudo -E docker compose pull supavisor       # or db/redis/auth
sudo -E docker compose up -d supavisor
```

For `auth` (GoTrue): config is env-driven; recreate (not restart). Check `wget -qO- localhost:9999/health` inside the container / via healthcheck status.

---

## 2. Platform Studio (shared, `IS_PLATFORM=true`)

The `studio` service runs a **prebuilt domain-agnostic image**:
`kmhariharasudhan/supastack-studio-platform` (`infra/studio-platform/Dockerfile`, built from
the fork `github.com/kmhari/supabase` branch `supastack-studio` = upstream + supastack patches).

Every deviation from upstream Studio source is documented (with reasoning) in
**[SUPASTACK-PATCHES.md on the branch itself](https://github.com/kmhari/supabase/blob/supastack-studio/SUPASTACK-PATCHES.md)**
— the policy is the smallest possible diff against upstream; adding a patch requires an entry
there (currently 2 patches across 3 files: email-only sign-in flags + conditional hCaptcha).

**How it dodges the `NEXT_PUBLIC_*` baking problem**: platform mode requires absolute URLs
inlined at `next build` (`csp.ts`/`_app.tsx` do `new URL(...)` — relative bases crash). The
image bakes a placeholder host (`apex-placeholder.supastack.invalid`); the entrypoint
sed-substitutes it with the runtime `SUPASTACK_APEX` across `/app` at **first boot**, then runs
the standalone server. One image works for any domain → registry-publishable.

- Healthcheck baked in: `/dashboard/api/get-utc-time` (upstream's `/api/platform/profile`
  404s "Endpoint not supported on hosted" in `IS_PLATFORM=true` builds — `proxy.ts` gates all
  non-allow-listed `/api/*` routes)
- Apex change requires a **recreate** (`up -d --force-recreate studio`); the entrypoint refuses
  a restart with a mismatched apex
- Fronted by Caddy catch-all; serves `https://<apex>/dashboard`

**Update procedure (Studio version bump)**

```sh
# 1. Sync the fork with upstream + rebase the patch branch (anywhere with a clone):
scripts/sync-studio-fork.sh <checkout-dir>     # prints the new head sha

# 2. Build the image from the new head (on the VM or CI):
docker build <checkout-dir> -f infra/studio-platform/Dockerfile \
  -t kmhariharasudhan/supastack-studio-platform:<new-sha>

# 3. Roll the service:
#    set STUDIO_PLATFORM_VERSION=<new-sha> in infra/.env, then
sudo -E docker compose up -d studio
```

**Build hygiene (important)**: never build from a lived-in checkout without the sibling
`Dockerfile.dockerignore` — upstream's `.dockerignore` excludes `.env.*` but NOT plain `.env`,
so a stray `apps/studio/.env` with real secrets or a `NEXT_PUBLIC_SITE_URL` would bake into
(and de-anonymize) the image. Verify after build:
`docker run --rm --entrypoint grep <img> -rl <your-apex> /app | wc -l` must be **0**.

---

## 3. Per-project Supabase stacks (stock upstream images)

Template: `infra/supabase-template/docker-compose.yml`. At provision, `writeInstanceStack()`
**copies the whole template dir** to `/var/supastack/instances/<ref>/`, renders `.env`
(mode 0600), rewrites `vector.yml` for `supastack-<ref>-*` container names, and validates with
`docker compose config -q`. Each instance runs as compose project `supastack-<ref>`.

### Image pins (as of this writing)

| Service     | Image                                                                            |
| ----------- | -------------------------------------------------------------------------------- |
| `studio`    | `${STUDIO_IMAGE}` → worker env, default `supabase/studio:2026.04.27-sha-5f60601` |
| `kong`      | `kong/kong:3.9.1`                                                                |
| `auth`      | `supabase/gotrue:v2.186.0`                                                       |
| `rest`      | `postgrest/postgrest:v14.8`                                                      |
| `realtime`  | `supabase/realtime:v2.76.5`                                                      |
| `storage`   | `supabase/storage-api:v1.60.10`                                                  |
| `imgproxy`  | `darthsim/imgproxy:v3.30.1`                                                      |
| `meta`      | `supabase/postgres-meta:v0.96.3`                                                 |
| `functions` | `supabase/edge-runtime:v1.74.0`                                                  |
| `analytics` | `supabase/logflare:1.36.1`                                                       |
| `db`        | `supabase/postgres:15.8.1.085`                                                   |
| `vector`    | `timberio/vector:0.53.0-alpine`                                                  |

### How versions actually work (important)

- The pins above are **frozen into each instance's compose copy at provision time**. Editing the
  template affects **new provisions only**.
- `supabase_instances.supabaseVersion` is a **recorded label** (default `2026.05.01` via
  `SUPABASE_VERSION` env) — it does **not** drive which image tags run. The compose copy does.
- The per-instance `studio` image comes from the worker's `STUDIO_IMAGE` env at provision.

### Update procedure — one instance

```text
POST /api/v1/instances/:ref/upgrade        (admin PAT; audit-logged)
Body: { "supabaseVersion": "<label>", "backupFirst": true }
```

What the worker's `lifecycle:upgrade` actually does today:

1. (optional) enqueue a backup — **fire-and-forget**, it does not wait. For strict
   backup-then-upgrade: trigger backup via API, wait for completion, then upgrade.
2. `docker compose pull` — pulls the tags **already in the instance's compose copy**
3. `docker compose up -d` — recreates changed containers
4. wait healthy (180 s), set `supabaseVersion` label + `running`

So today, upgrading an **existing** instance to genuinely newer images means either:

- **(a) hand-edit** `/var/supastack/instances/<ref>/docker-compose.yml` tags, then call the
  upgrade endpoint (pull+up applies them), or
- **(b)** update the template + re-render the stack — there is **no API for this yet**
  (`writeInstanceStack()` is not called on upgrade; this is the headline automation gap).

Per-instance ops gotcha: always pass the project name when running compose by hand —
`docker compose -p supastack-<ref> ...` from the instance dir — or compose falls back to the
directory-derived default project name and can clobber an unrelated stack on the same host.

### Update procedure — image bump policy

- **Postgres (`supabase/postgres`)**: patch-level bumps (15.8.1.x) are safe pull+up; **never**
  cross a major (15→17) via tag bump — that's a dump/restore migration, out of scope of the
  upgrade job.
- **GoTrue/PostgREST/Realtime/Storage**: check upstream changelogs for env-var renames — new
  required vars need a template change + `.env` re-render (gap (b) above).
- **Studio**: bump `STUDIO_IMAGE` on the worker (compose env) for new provisions; existing
  instances need (a) or (b).
- Keep the **control-plane GoTrue and the template GoTrue in sync** unless intentionally diverging.
- **When bumping any template pin, update the `INSTANCE_IMAGES` list in `install.sh` too** — the installer pulls these upfront so the first project creation isn't a multi-GB download. A unit test (`tests/installer/instance-image-prewarm.test.ts`) fails if the two drift.

---

## 4. Version source-of-truth summary

| What                      | Pinned where                                                                                                                                                                                              | Applies to                     |
| ------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Custom platform images    | Docker Hub `kmhariharasudhan/supastack-*`; `SUPASTACK_VERSION` (git sha) pinned in `infra/.env`                                                                                                           | Control plane                  |
| Vendor control-plane tags | `infra/docker-compose.yml` literal tags                                                                                                                                                                   | Control plane                  |
| Platform Studio           | fork sha in the `kmhariharasudhan/supastack-studio-platform` image tag (`STUDIO_PLATFORM_VERSION` in `infra/.env`); source = `kmhari/supabase#supastack-studio`, synced via `scripts/sync-studio-fork.sh` | Control plane                  |
| Per-project stock tags    | `infra/supabase-template/docker-compose.yml` literal tags                                                                                                                                                 | New provisions                 |
| Per-project running tags  | `/var/supastack/instances/<ref>/docker-compose.yml` (frozen copy)                                                                                                                                         | That instance                  |
| Per-project studio        | worker `STUDIO_IMAGE` env                                                                                                                                                                                 | New provisions                 |
| `supabaseVersion`         | DB column on `supabase_instances`                                                                                                                                                                         | **Label only** — display/audit |

## 5. Gaps (automation roadmap, not yet built)

| Gap                                                                   | Today                                                                                                                                  | Proposal                                                        |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------- |
| Template changes never reach existing instances                       | Hand-edit per instance                                                                                                                 | Call `writeInstanceStack()` in the upgrade path                 |
| Per-instance side-effects of new platform features (GUCs, extensions) | Only new provisions get them                                                                                                           | Versioned instance-migration runner + `instance_migration_log`  |
| Fleet-wide upgrade                                                    | N API calls for N instances                                                                                                            | `POST /api/v1/admin/instances/upgrade` with concurrency cap     |
| Version visibility                                                    | `supabaseVersion` label only                                                                                                           | Dashboard panel: running version + feature level + last upgrade |
| Platform releases                                                     | Images published to Docker Hub (sha-tagged); upgrade = bump `SUPASTACK_VERSION` + `pull` + `up -d`; installer pull-mode is the default | GitHub releases tying a version to image shas                   |
| Whole-stack bounce on upgrade                                         | ~30 s downtime per instance                                                                                                            | Rolling per-service restart (stretch)                           |
