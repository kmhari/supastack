# VM Reset Runbook

Use this to wipe a supastack VM to a clean pre-install state — e.g. before re-testing the full
signup flow end-to-end, or before a fresh demo.

## What gets removed

- Control-plane Postgres data (users, instances, setup state, wildcard cert records)
- Redis data (sessions, BullMQ jobs)
- Caddy cert cache and config
- Wildcard cert files on disk (`/var/supastack/certs`)
- All provisioned Supabase instance data (`/var/supastack/instances`)

**What stays**: the VM itself, Docker, supastack Docker images, and the apex DNS A record.

---

## Steps

```bash
# 1. Stop everything and drop all named volumes
cd /opt/supastack   # or wherever infra/docker-compose.yml lives
docker compose -f infra/docker-compose.yml down -v

# 2. Remove on-disk data (instances, certs, backups)
sudo rm -rf /var/supastack/instances /var/supastack/certs /var/supastack/backups

# 3. Bring the stack back up
docker compose -f infra/docker-compose.yml up -d

# 4. Wait for all containers to be healthy
docker compose -f infra/docker-compose.yml ps
# All services should show 'healthy' within ~60 seconds
```

## Verify reset

```bash
# setup/status must report open: true
curl -s http://<VM-IP>/api/v1/setup/status | jq .
# → { "open": true }
```

---

## Re-setup walkthrough

The apex domain is NOT re-entered — it comes from `SUPASTACK_APEX` in `infra/.env`, which
survives the reset.

1. Navigate to `http://<VM-IP>/setup` in a browser.
2. **Admin step** — enter admin email, password, organization name → create the admin account
   (you're logged in automatically).
3. **DNS & certificates step** — the wizard shows the A records for `<apex>` / `*.<apex>` and
   the two `_acme-challenge.<apex>` TXT values. Add them at your registrar, wait for the ✅
   status icons, click **Issue Certificate**.
4. **CLI step** — optional CLI/token setup, then finish.
5. Dashboard loads at `https://<apex>/dashboard` with a Let's Encrypt wildcard cert.

## Verify wildcard cert

```bash
# Cert must be CN=*.<apex> from Let's Encrypt
curl -v https://<apex> 2>&1 | grep -E "subject|issuer|CN="

# First request to any new subdomain must use the wildcard (no ACME delay)
curl -v https://<any-ref>.<apex>/rest/v1/ 2>&1 | grep "CN=\*\."
```

## Smoke test post-reset

1. Create a new project from the dashboard.
2. Verify `https://<ref>.<apex>/rest/v1/` returns 200 (data plane reachable).
3. Verify `https://<apex>/dashboard/project/<ref>` loads the project in Studio.
4. From a source checkout, run `pnpm test:cli` (requires `SUPASTACK_APEX`, `SUPASTACK_PAT`,
   `SUPASTACK_PROJECT_REF` env vars).

Each step should land at the same end-state it did before the wipe.
