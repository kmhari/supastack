# Quickstart — Supastack

End-to-end walkthrough from a fresh Linux VM to a working Supabase instance reachable over HTTPS. This is the canonical smoke test for v1; the integration suite mirrors these steps.

## Prerequisites

- A Linux host with a public IPv4 (Ubuntu 22.04/24.04 recommended)
- DNS for an apex domain (e.g., `supastack.example.com`) and a wildcard or per-subdomain record pointed at the host:
  - `supastack.example.com           A   <ip>`
  - `*.supastack.example.com         A   <ip>`  *(or add A records per `<ref>` as instances are created)*
- Inbound 80 and 443 open in firewall
- Non-root user with sudo

## 1. Install

```bash
curl -fsSL https://supastack.dev/install.sh | bash
```

What the script does:
- Installs Docker Engine + Compose if missing
- Clones the supastack repo to `/opt/supastack`
- Generates `MASTER_KEY`, `SESSION_SECRET`, and a control-plane DB password (via `openssl rand`)
- Builds the per-instance Studio image once (`supastack/studio:<pinned-commit>`)
- `docker compose pull && docker compose up -d`
- Waits for the control-plane to report healthy
- Prints next-step URL

Expected runtime: 3–6 minutes on a 4-vCPU VM (Studio build dominates).

## 2. First-time setup

Open the URL the installer printed (or `http://<ip>`). The dashboard redirects to `/setup`.

Submit:
- **Email** + **password** for the super-admin
- **Organization name** (cosmetic)
- **Apex domain** — must already point at this host

On success you're logged in and the master API token is shown **once**. Store it now if you intend to use the REST API.

**Verification**: `curl https://<apex>/api/v1/setup/status` returns `{"open": false}`.

## 3. Create your first instance

In the dashboard:
- Click **New Instance**
- Enter a **name** (e.g., "huntvox prod")
- (Optional) Fill SMTP host/port/user/password for invite + recovery emails
- Click **Create**

Watch the status pill:
- `provisioning` (≈ 60–90 s on a warm host)
- `running`

When `running`, the dashboard shows:
- Stable **ref** (e.g., `apbkobhfnmcqqzqeeqss`)
- API URL: `https://<ref>.<apex>`
- Studio URL: `https://<ref>.<apex>/studio`

**Verification of cert issuance**: in another terminal, `curl -I https://<ref>.<apex>/rest/v1/`. The first request takes 2–5 s while Caddy issues the cert; subsequent calls are instant. The TLS cert chain is valid (Let's Encrypt).

## 4. Confirm the keys actually work

This is the **SupaConsole regression test** — confirms that the JWTs we generated were signed correctly.

In the dashboard, click **Reveal credentials** (you'll be prompted for your password). Copy the `anon_key`.

```bash
ANON='eyJhbGciOiJIUzI1NiIs...'   # paste here
curl -H "apikey: $ANON" https://<ref>.<apex>/rest/v1/
```

Expected: **200** with a JSON description of the PostgREST API. If you get a 401 with `JWSError`, the JWT signing is broken — the bug we explicitly designed to avoid.

## 5. Open Studio

Click **Open Studio** in the dashboard (or visit `https://<ref>.<apex>/studio/project/default`). Studio loads with the table editor, SQL editor, auth users, storage browser — all serving assets under `/studio/...` correctly (no 404s on `_next/static/*`).

## 6. Make a backup

In the instance detail view → **Backups** → **Create Backup**. Within ~30 s for a small empty database the status flips to `completed`. Click **Download** to grab the `.dump` artifact.

Validate offline:

```bash
pg_restore --list supastack-<ref>-<timestamp>.dump | head
```

Should list the schemas + objects. Restoring into a fresh DB:

```bash
createdb scratch && pg_restore -d scratch supastack-<ref>-<timestamp>.dump
```

…should complete without errors.

## 7. Toggle daily backup

In the instance settings, ensure **Daily auto-backup** is **on** with retention `7`. There's no immediate visible change; the scheduler tick (hourly) is responsible for the next run. To verify, set retention to `3`, run **Create Backup** four times in a row, and confirm the oldest is auto-deleted from the list after the fourth completes.

## 8. Pause + resume

Click **Pause** on the instance. Within 30 s, status flips to `paused`; `docker compose ps` for that project shows all containers `Exit 0`. Click **Resume**: status returns to `running` within 60 s; the API responds with the same `anon_key` and the same data.

## 9. Invite a teammate

**Org → Members → Invite**. Enter email + role = `member`. A link appears (and is emailed if SMTP is configured at the *instance* level — note: control-plane email is via the org's chosen approach; for v1 the link is always visible in the dashboard).

Open the link in an incognito browser. Accept with a new password. You're in as `member`. Try clicking **Delete instance** — the button is hidden; if you call the API directly, you get **403 forbidden**.

## 10. Delete the instance

Back as admin: open the instance detail, **Delete**. Confirm. The instance enters `deleting` state, containers stop, ports are freed, the data directory is removed, the subdomain stops responding within ~30 s.

---

## Troubleshooting

| Symptom | Likely cause | Where to look |
|---|---|---|
| First HTTPS request hangs forever | DNS not pointed at host | `dig <ref>.<apex>` from another network |
| First HTTPS request returns Caddy "no certificate available" | `/internal/tls/ask` denied | Check API logs for the deny line; confirm the instance row exists and status is not `deleting` |
| `provisioning` → `failed` immediately | Compose env validation failure | Instance detail shows `provisionError`; full output in worker logs |
| API returns 401 with `JWSError` | This should never happen | Open a bug — the JWT signer is broken |
| Backup hangs | `pg_dump` inside the db container is failing | `docker logs supastack-<ref>-db` |
| Studio shows 404 on `_next/static/*` | `NEXT_PUBLIC_BASE_PATH` mismatch | Confirm Studio image was built with `=/studio` |

---

## Cleanup (for repeat runs)

```bash
docker compose -f /opt/supastack/infra/docker-compose.yml down -v
sudo rm -rf /var/supastack  # /var/supastack/instances and /var/supastack/backups
# remove any supastack-<ref> Compose projects:
docker ps -a --filter "name=supastack-" --format "{{.Names}}" | xargs -r docker rm -f
```

Note: this destroys ALL data — do not run on a host you care about.
