# VM Reset Runbook

Use this to wipe a selfbase VM to a clean pre-install state — e.g. before re-testing the full
signup flow end-to-end, or before a fresh demo.

## What gets removed

- Control-plane Postgres data (users, instances, setup state, wildcard cert records)
- Redis data (sessions, BullMQ jobs)
- Caddy cert cache and config
- Wildcard cert files on disk (`/var/selfbase/certs`)
- All provisioned Supabase instance data (`/var/selfbase/instances`)

**What stays**: the VM itself, Docker, selfbase Docker images, and the apex DNS A record.

---

## Steps

```bash
# 1. Stop everything and drop all named volumes
cd /opt/selfbase   # or wherever infra/docker-compose.yml lives
docker compose -f infra/docker-compose.yml down -v

# 2. Remove on-disk data (instances, certs, backups)
sudo rm -rf /var/selfbase/instances /var/selfbase/certs /var/selfbase/backups

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

1. Navigate to `http://<VM-IP>/setup` in a browser.
2. **Step 1** — Enter admin email, password, organization name → Create super-admin.
3. **Step 2** — Copy the master API token → Continue.
4. **Step 3** — Enter apex domain (e.g. `selfbase.example.com`) → confirm A record DNS resolves → Continue.
5. **Step 4** — Add the two TXT records shown at `_acme-challenge.<apex>` at your DNS registrar.
   Wait for both ✅ status icons → click **Issue Certificate**.
6. Dashboard loads at `https://<apex>/dashboard` with a Let's Encrypt wildcard cert.

## Verify wildcard cert

```bash
# Cert must be CN=*.<apex> from Let's Encrypt
curl -v https://<apex> 2>&1 | grep -E "subject|issuer|CN="

# First request to any new subdomain must use the wildcard (no ACME delay)
curl -v https://<any-ref>.<apex>/rest/v1/ 2>&1 | grep "CN=\*\."
```

## Smoke test post-reset

Run the production smoke-test sequence (SC-005):

1. Create a new project from the dashboard.
2. Verify `https://<ref>.<apex>/rest/v1/` returns 200 (data plane reachable).
3. Verify `https://studio-<ref>.<apex>/` loads Studio.
4. Run `pnpm test:cli` (requires `SELFBASE_APEX`, `SELFBASE_PAT`, `SELFBASE_PROJECT_REF` env vars).

Each step should land at the same end-state it did before the wipe.
