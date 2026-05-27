# 017 — Cap Kong nginx workers per project

**Status**: shipped to template; per-project rollout pending operator action.

**Feature dir**: [`specs/017-kong-worker-cap/`](../../specs/017-kong-worker-cap/)

## What changed

Added one environment variable to the `kong` service in `infra/supabase-template/docker-compose.yml`:

```yaml
KONG_NGINX_WORKER_PROCESSES: "2"
```

That's the entire code change. No image bump, no schema, no API surface.

## Why

By default Kong sets `nginx_worker_processes = auto`, which OpenResty resolves to the number of host CPU cores. On the production VM (`supaviser.dev`, 12 cores) this means **12 nginx workers per project**, each running its own LuaJIT VM with the full Kong plugin set loaded — about 120 MiB RSS per worker. The result was ~1.25 GiB per kong container at idle, or ~3.75 GiB across the 3 currently provisioned projects.

Per-project request volume is well under 1% CPU at idle and only briefly spikes under user interaction. 12 workers is wildly over-provisioned. Two workers is enough headroom that a single slow Lua coroutine won't stall the gateway, while keeping memory bounded.

## Expected impact

| Metric | Before | After |
|---|---|---|
| nginx workers per kong container | 12 (= host CPU count) | 2 |
| Idle RSS per kong container | ~1.25 GiB | <300 MiB |
| Total kong memory across 3 projects | ~3.75 GiB | ~750 MiB |

No measurable latency or throughput change at current traffic.

## How to roll out

1. Pull the latest commit on the VM so `/opt/selfbase/infra/supabase-template/docker-compose.yml` reflects the change.
2. For each project under `/opt/selfbase/instances/<ref>/`:
   - Regenerate the per-project compose file from the template (normal selfbase template-application path).
   - `sudo docker compose up -d kong` — recreates the container with the new env var.
3. Verify with `sudo docker top selfbase-<ref>-kong-1 | grep -c 'nginx: worker'` → should print `2`.
4. Verify with `sudo docker stats --no-stream | grep <ref>-kong` → RSS should be under 300 MiB at idle.
5. Smoke-test gateway routes (`/rest/v1/`, `/auth/v1/settings`, `/storage/v1/bucket`) — see [`quickstart.md`](../../specs/017-kong-worker-cap/quickstart.md) for the curl recipe.
6. Stagger across projects (~30s between rolls) to avoid simultaneous gateway downtime windows. Each roll is a normal container restart — a few seconds of dropped/retried requests per project.

## How to roll back

Revert the env-var line (or set `KONG_NGINX_WORKER_PROCESSES: "auto"`), redeploy:

```bash
sudo docker compose up -d kong
```

Restores 12-worker behavior. Trivial and instant.

## Notes for future operators

- The 2-worker cap is a deliberate platform-wide default, not a per-project setting. If a single project ever needs more (sustained high RPS), raise the value in the template; there is no per-project override mechanism (and no project on the platform today justifies one).
- The cap is an **upper bound**, not a target. On a host with fewer than 2 cores, OpenResty will Just Work — `worker_processes 2` does not require 2 physical cores.
- This change does not affect any of Kong's other tuning knobs: shared-dict caches (`mem_cache_size = 128m`), proxy buffer sizes, DNS caches, etc. all remain at their template defaults.
