# Operations & Maintenance

All commands assume the install dir `/opt/supastack` (adjust if you used a
different `INSTALL_DIR`).

## Day-to-day

```sh
cd /opt/supastack
docker compose -f infra/docker-compose.yml ps          # status
docker compose -f infra/docker-compose.yml logs -f api  # tail a service
docker compose -f infra/docker-compose.yml up -d        # apply .env / image changes
docker compose -f infra/docker-compose.yml down         # stop (keeps data)
```

> Per-project stacks are separate Compose projects named `supastack-<ref>`,
> living under `DATA_DIR/instances/<ref>`. Manage them with
> `docker compose -p supastack-<ref> …` — never plain `docker compose` in that
> dir, or you risk clobbering an unrelated stack.

## Upgrading

```sh
cd /opt/supastack
git fetch && git checkout <tag-or-main> && git pull
docker compose -f infra/docker-compose.yml build
docker compose -f infra/docker-compose.yml up -d
```

If the upstream Supabase template was re-vendored, rebuild the Studio image (see
`infra/studio/Dockerfile` and `UPGRADING.md`).

## Backups

- Configure on-demand + daily backups per project from the dashboard.
- Store: local disk (`DATA_DIR/backups`) or S3-compatible (MinIO / R2 / B2).
- Restore is an async worker job; trigger it from the dashboard.

## Certificate renewal

The wildcard cert renews via the dashboard alert at 30 days remaining (manual
DNS-01 TXT refresh in the current build). Watch for the renewal banner.

## Master key

`MASTER_KEY` decrypts every per-project secret. **Back it up offline.** To
rotate, use `scripts/rekey-master.mjs` and follow
[`docs/changes/018-master-key-rotation.md`](https://github.com/kmhari/selfbase/blob/main/docs/changes/018-master-key-rotation.md).

## Reset the VM to a clean state

To wipe everything back to pre-setup (drops control DB, Redis, certs, and all
project data — keeps Docker + images):

```sh
cd /opt/supastack
docker compose -f infra/docker-compose.yml down -v
sudo rm -rf /var/supastack/instances /var/supastack/certs /var/supastack/backups
docker compose -f infra/docker-compose.yml up -d
```

Full runbook: [`docs/vm-reset.md`](https://github.com/kmhari/selfbase/blob/main/docs/vm-reset.md).

## Host hardening

See [`docs/host-hardening.md`](https://github.com/kmhari/selfbase/blob/main/docs/host-hardening.md)
for firewall and host-level recommendations.
