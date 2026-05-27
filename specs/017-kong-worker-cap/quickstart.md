# Quickstart: Verify Kong Worker Cap

Live-VM verification recipe. Run from a laptop with SSH access to `ubuntu@148.113.1.164`.

## 1. Baseline memory + worker count

```bash
ssh ubuntu@148.113.1.164 "sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' | grep kong"
ssh ubuntu@148.113.1.164 "sudo docker top selfbase-<REF>-kong-1 | grep -c 'nginx: worker'"
```

Expected before the change: ~1.25 GiB RSS per kong container, **12** worker processes (or whatever `nproc` returns on the host).

## 2. Deploy the template change

From the repo root on the VM, after rsyncing the updated `infra/supabase-template/docker-compose.yml`:

```bash
# Pick one project ref to roll first
REF=<project-ref>
cd /opt/selfbase/instances/$REF   # per-project compose location
# Regenerate the per-project compose from the updated template, then:
sudo docker compose up -d kong
```

Alternatively (testing the env var in isolation, without regenerating compose):

```bash
sudo docker compose exec -e KONG_NGINX_WORKER_PROCESSES=2 kong kong reload
```

Note: `kong reload` re-execs the master and respawns workers under the new directive. Faster than full container restart but doesn't survive the next container recreation — only use it for the smoke check before doing a full deploy.

## 3. Post-change memory + worker count

```bash
ssh ubuntu@148.113.1.164 "sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' | grep $REF-kong"
ssh ubuntu@148.113.1.164 "sudo docker top selfbase-$REF-kong-1 | grep -c 'nginx: worker'"
```

**Pass criteria (SC-001, SC-004)**:

- Worker count: **2** (was 12).
- Container RSS: **< 300 MiB** at idle (was ~1.25 GiB).

## 4. Smoke test the gateway

From a laptop, against the rolled project:

```bash
PROJ_URL=https://<ref>.<apex>
curl -fsS -o /dev/null -w '%{http_code}\n' "$PROJ_URL/rest/v1/" -H "apikey: $ANON_KEY"
curl -fsS -o /dev/null -w '%{http_code}\n' "$PROJ_URL/auth/v1/settings" -H "apikey: $ANON_KEY"
curl -fsS -o /dev/null -w '%{http_code}\n' "$PROJ_URL/storage/v1/bucket" -H "Authorization: Bearer $SERVICE_ROLE_KEY"
```

**Pass criteria (FR-006)**: all return 200/expected codes; no 5xx; no observable latency change.

## 5. Roll remaining projects

Repeat step 2 for each remaining project. Stagger ~30s apart to avoid simultaneous gateway restarts.

## 6. Total host memory check (SC-002)

```bash
ssh ubuntu@148.113.1.164 "free -h && sudo docker stats --no-stream --format 'table {{.Name}}\t{{.MemUsage}}' | grep kong"
```

**Pass criteria (SC-002)**: total kong memory across all projects drops by **≥ 2.5 GiB** vs. baseline.

## 7. Watch for regressions (SC-003)

Over the next 7 days, check the dashboard's per-project error-rate panel (or `selfbase-<ref>-analytics-1` Logflare) for gateway-originated 5xx. Compare 7-day rolling window before and after.

## Rollback

If anything misbehaves:

```bash
# Revert the env var in infra/supabase-template/docker-compose.yml,
# regenerate per-project compose, then for each affected project:
sudo docker compose up -d kong
```

Restores 12 workers and the previous memory footprint within seconds per project.
