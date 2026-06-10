# First-Time Setup

After the control plane is [installed](Installation) and your
[DNS A records](DNS-and-TLS) point at the host, finish setup in the browser.

## The `/setup` wizard

Open `http://<VM-IP>/setup` (plain HTTP — TLS isn't issued yet).

| Step | What you do |
|---|---|
| **1. Super-admin** | Enter admin email, password, and organization name → **Create super-admin**. |
| **2. API token** | Copy the master Personal Access Token (PAT) shown → **Continue**. Store it safely — you'll use it for the CLI and API. |
| **3. Apex domain** | Enter your apex (e.g. `supastack.example.com`). The wizard checks the apex **A record** resolves to this host → **Continue**. |
| **4. Wildcard cert** | The wizard shows **two TXT records** to add at `_acme-challenge.<apex>`. Add them at your DNS registrar. Wait for both ✅ icons → **Issue Certificate**. |

When the cert is issued, the dashboard loads at
**`https://<apex>/dashboard`** with a valid Let's Encrypt wildcard cert.

## After setup

- Set `COOKIE_SECURE=1` in `.env` and `docker compose … up -d` now that you're on HTTPS.
- `GET /api/v1/setup/status` flips to `{ "open": false }` — setup is one-time;
  the apex is also enforced as a redirect gate until completed.

## Verify

```sh
# Wildcard cert in place
curl -v https://supastack.example.com 2>&1 | grep "CN=\*\."

# A brand-new subdomain serves over TLS immediately (no per-subdomain ACME wait)
curl -v https://anyref.supastack.example.com/ 2>&1 | grep "CN=\*\."
```

## Next

- [Creating & Connecting Projects](Creating-and-Connecting-Projects)
- [CLI Setup](CLI-Setup)
- If anything is stuck, see [Troubleshooting](Troubleshooting).
