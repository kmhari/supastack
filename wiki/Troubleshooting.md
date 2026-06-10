# Troubleshooting

## `docker compose up` exits with `… required`

The `.env` is missing a required secret (e.g.
`MASTER_KEY required`, `GOTRUE_JWT_SECRET required`, `SUPASTACK_APEX required`,
`SUPAVISOR_API_JWT_SECRET required`). Populate every variable from
[Configuration](Configuration) and re-run `up -d`. Remember `GOTRUE_JWT_SECRET`
is derived from `MASTER_KEY` via `scripts/derive-gotrue-secret.mjs`.

## Control plane never becomes healthy

```sh
docker compose -f infra/docker-compose.yml ps
docker compose -f infra/docker-compose.yml logs --tail=100 api worker db
```

- `db` unhealthy → check `CONTROL_DB_PASSWORD` (must contain no `$` — Compose mangles it).
- `api`/`worker` crash-loop → usually a bad/empty required env var; check the first error line.

## `/setup` won't issue the certificate

- Both `_acme-challenge.<apex>` **TXT** records must resolve on public resolvers
  before the button enables. Lower TTL and wait. Verify:
  `dig +short TXT _acme-challenge.supastack.example.com`
- Hitting Let's Encrypt **rate limits** while testing? Set `ACME_DIRECTORY_URL`
  to LE staging in `.env`, re-run, then switch back to production.
- The apex **A record** must resolve to this host (step 3) before step 4.

## Project subdomain doesn't load / cert errors

- Confirm the **wildcard** `*.<apex>` A record exists and points at the host.
- Confirm the wildcard cert was issued: `curl -v https://<ref>.<apex> | grep "CN=\*\."`.

## Dashboard login cookie issues

Once on HTTPS, set `COOKIE_SECURE=1` in `.env` and `up -d`. On plain HTTP keep
it `0`.

## A project stack misbehaves

Per-project stacks are `supastack-<ref>` Compose projects under
`DATA_DIR/instances/<ref>`:

```sh
cd /var/supastack/instances/<ref>
docker compose -p supastack-<ref> ps
docker compose -p supastack-<ref> logs -f
```

Or pause/restart it from the dashboard.

## CLI can't reach the deployment

- Profile `api_url` must be `https://api.<apex>` (not the apex root).
- `SUPABASE_ACCESS_TOKEN` must be a valid PAT.
- A stale global `~/.supabase/profile` overrides everything — delete it to switch
  deployments. See [CLI Setup](CLI-Setup).

## Still stuck

Open an issue: <https://github.com/kmhari/selfbase/issues> with the failing
command, `docker compose ps`, and the relevant `logs --tail=100` output (redact
secrets).
