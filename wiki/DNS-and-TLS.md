# DNS & TLS

Supastack serves every project under a wildcard of your apex domain, secured by
a single Let's Encrypt wildcard certificate issued via **DNS-01**.

## DNS records you need

Point these at your VM's public IP. Replace `supastack.example.com` with your apex.

| Record | Type | Value | Purpose |
|---|---|---|---|
| `supastack.example.com` | `A` | `<VM public IP>` | apex → dashboard |
| `*.supastack.example.com` | `A` | `<VM public IP>` | every `<ref>.<apex>` project URL |
| `api.supastack.example.com` | `A` (or covered by `*`) | `<VM public IP>` | Management API host |
| `mcp.supastack.example.com` | `A` (or covered by `*`) | `<VM public IP>` | hosted MCP server |
| `pooler.supastack.example.com` | `A` (or covered by `*`) | `<VM public IP>` | pooled Postgres `:6543` |

A single wildcard `*.supastack.example.com` A record covers `api`, `mcp`,
`pooler`, and all `<ref>` subdomains. You still need the **apex** `A` record
separately (wildcards don't match the bare apex).

> Direct Postgres uses `db.<ref>.<apex>:5432` — also covered by the wildcard A record.

## Why DNS-01 (and what to expect)

A wildcard cert **cannot** be issued via HTTP-01 — Let's Encrypt requires
DNS-01 for `*.` names. During [First-Time Setup](First-Time-Setup) the wizard
shows you **TXT records** to add at `_acme-challenge.<apex>`. You add them at
your registrar, wait for them to propagate, then click **Issue Certificate**.

| Step | Where |
|---|---|
| Add apex + wildcard **A** records | before setup |
| Add **TXT** challenge records | during setup, values shown by the wizard |
| Cert issued | one wildcard `*.<apex>` + apex SAN |
| Renewal | dashboard alerts at 30 days remaining |

## Tips

- **Lower your TXT/A TTL** (e.g. 60–300s) before setup so propagation and the
  readiness check are fast.
- **Test against LE staging first** to avoid the production rate limit: set
  `ACME_DIRECTORY_URL` to the staging directory in `.env`, run setup, confirm
  the flow, then switch back to production and re-issue.
- The setup wizard's "Issue Certificate" button stays disabled until both TXT
  records resolve on public resolvers — this is the authoritative readiness
  signal, give DNS a minute.

## Verify

```sh
# Apex + wildcard resolve to your IP
dig +short supastack.example.com
dig +short anything.supastack.example.com

# After issuance: cert is the LE wildcard
curl -v https://supastack.example.com 2>&1 | grep -E "subject|issuer|CN="
```

## Next

- [First-Time Setup](First-Time-Setup) — the wizard that issues the cert.
