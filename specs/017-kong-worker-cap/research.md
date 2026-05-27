# Research: Kong Worker Process Cap

## Q1 — How does Kong currently size nginx workers?

**Finding**: The per-instance Kong service (`infra/supabase-template/docker-compose.yml:81–127`) does not set `KONG_NGINX_WORKER_PROCESSES`. Kong's default for that directive is `auto`, which OpenResty resolves to the number of host CPU cores visible to the container. The production VM `supaviser.dev` has 12 cores; `docker top` confirms each kong container runs 1 master + 12 worker processes.

**Per-process memory**: each worker reports ~118–122 MiB RSS. Multiplied across 12 workers + master, the cgroup-deduplicated container footprint is ~1.25 GiB per project (verified live).

**Why workers are heavy**: each OpenResty worker holds its own LuaJIT VM instance with the full Kong plugin set (`request-transformer,cors,key-auth,acl,basic-auth,request-termination,ip-restriction,post-function`) and a copy of the parsed declarative-config route table. The shared-dict caches (`mem_cache_size = 128m`, `dns_cache_size`, `ssl_session_cache`) are shared, but the Lua VM state is per-worker by design.

## Q2 — How is the worker count configured for Kong?

**Options considered**:

1. **`KONG_NGINX_WORKER_PROCESSES` env var** — Kong recognises any `KONG_NGINX_*` env as an injection into the generated nginx.conf. `KONG_NGINX_WORKER_PROCESSES=2` sets the `worker_processes 2;` directive. This is the official, documented mechanism.
2. **Custom `nginx.conf` template via `KONG_NGINX_HTTP_*` / template overrides** — heavier, requires shipping a custom template file in the image or as a volume.
3. **Modify the entrypoint** (`volumes/api/kong-entrypoint.sh`) to compute and inject a value — adds dynamic complexity for no upside.

**Decision**: Option 1. Single env var, idiomatic, no new files.

**Rationale**: Option 1 is the smallest change that achieves the goal. Options 2 and 3 add surface area without unlocking any capability we need.

## Q3 — What value should the cap be?

**Constraints**:

- `1` is unsafe: a single slow Lua coroutine (cosocket, plugin work) blocks every request through the gateway. No headroom for graceful degradation.
- `12` (current `auto` on the prod VM) is wildly over-provisioned. The observed steady-state CPU per kong container is well under 1% across all 3 projects.
- A small number (2–4) gives concurrency headroom against the worst case while keeping per-project memory bounded.

**Decision**: **2**.

**Rationale**: Two workers means a hung worker has a hot spare; both can run simultaneously. The memory cost is ~240 MiB per project (vs. ~1.25 GiB today). If a project's traffic ever justifies more, the same env var can be raised — but no current project's request rate would benefit from > 2 workers.

**Alternatives considered**:

- **4 workers** — defensible as "still small, more headroom". Adds ~240 MiB per project vs. the 2-worker baseline. Today's request volume doesn't motivate it, so we choose the smaller default and accept that scaling up is one env-var change away.
- **`min(auto, 2)` via custom logic** — the cap is already an upper bound (`worker_processes 2` on a 1-core host still works fine — Kong will not spawn more workers than the directive). No custom logic needed.

## Q4 — Rollout strategy for existing projects?

**Path**: The platform's per-project compose files are generated from `infra/supabase-template/docker-compose.yml` (see `packages/docker-control/src/compose-template.ts`). Editing the template means:

- **New projects**: pick up `KONG_NGINX_WORKER_PROCESSES=2` automatically on provision.
- **Existing projects** on the production VM: pick up the value the next time their compose is regenerated and `docker compose up -d kong` is invoked. The api/worker already know how to regenerate per-project compose during normal lifecycle ops; if a sweep is desired, run it as a one-off operator action.

**Downtime**: ~5–10 seconds per project (Kong container restart). In-flight requests during that window will fail and clients retry. Acceptable for a maintenance window. To stagger: roll one project, wait, verify, then the next.

**Rollback**: revert the env var, redeploy kong. Returns to 12-worker behavior. Trivial.

## Q5 — Are there any tests or downstream consumers that depend on the current worker count?

**Finding**: `grep -rn "KONG_NGINX_WORKER\|worker_processes\|nginx_worker" .` returns no matches in `apps/`, `packages/`, or `tests/`. No code paths inspect or assume a specific worker count. Safe to change.

## Q6 — Are there shared-state-via-worker assumptions in the Kong plugin set we use?

**Plugins in use**: `request-transformer, cors, key-auth, acl, basic-auth, request-termination, ip-restriction, post-function`.

**Finding**: None of these plugins rely on cross-worker state (auth caching uses Kong's `mem_cache_size` shared dict, which is OS-shared memory between workers). Reducing the worker count cannot break correctness — only throughput, which is over-provisioned by ~6×.

## Open Questions

None. All assumptions and decisions are documented above.
