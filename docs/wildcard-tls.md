# Wildcard TLS Certificates

Selfbase can issue a single `*.<apex>` + `<apex>` wildcard certificate from Let's Encrypt using
the ACME DNS-01 challenge. This eliminates per-subdomain certificate issuance delays (the 3-5s
penalty on first HTTPS request to a new project subdomain) and the per-subdomain rate-limit
pressure at scale.

## How it works

1. During `/setup` Step 4, the wizard shows two TXT record values to add at your DNS registrar.
2. You add both values to `_acme-challenge.<apex>` as a multi-value TXT record.
3. The wizard polls DNS every 10s. Once both records appear (✅), the **Issue Certificate**
   button enables.
4. Clicking it completes the ACME DNS-01 challenge with Let's Encrypt and downloads the wildcard cert.
5. Caddy loads the cert via `tls.certificates.load_files` and serves all subdomains from it.

The certificate covers:
- `<apex>` — your dashboard domain
- `*.<apex>` — every project data plane, Studio, and management API subdomain

---

## Adding TXT records at common registrars

### Cloudflare

1. DNS → Add record → Type: **TXT**
2. Name: `_acme-challenge` (Cloudflare adds the apex automatically)
3. Content: paste Value 1
4. Click **Save**. Repeat with Value 2 (same name, different content).
5. TTL: Auto or 60 seconds.

### AWS Route 53

1. Hosted zone → Create record → Record type: **TXT**
2. Record name: `_acme-challenge.<apex>`
3. Value: `"Value 1"` (quotes required for TXT in Route 53)
4. Click **Add another value** → paste `"Value 2"`
5. TTL: 60 → **Create records**.

### Namecheap

1. Domain list → Manage → Advanced DNS → Add New Record
2. Type: **TXT Record**, Host: `_acme-challenge`, Value: paste Value 1 → ✓
3. Repeat for Value 2.

### GoDaddy

1. My Products → DNS → Add → Type: **TXT**
2. Host: `_acme-challenge`, TXT Value: paste Value 1 → Save
3. Repeat for Value 2.

> **Multi-value note**: Some registrars show a single TXT record with two lines; others require
> two separate records with the same host but different values. Both approaches work — ACME just
> needs both values queryable.

---

## Renewal

The wildcard certificate is valid for 90 days. Selfbase alerts you 30 days before expiry via a
dashboard banner.

To renew:
1. Click **Renew now →** in the banner (or go to Settings → TLS).
2. The wizard generates new TXT challenge values.
3. Update the `_acme-challenge.<apex>` TXT records at your registrar with the new values.
4. Click **Issue Certificate** → new cert replaces the old one.

> **Automated renewal** (without manual TXT step) is planned for a future release once Cloudflare
> API credentials are supported. See [issue #6](https://github.com/kmhari/selfbase/issues/6).

---

## Disabling the wildcard

Settings → TLS → **Disable wildcard TLS** → Confirm.

Caddy reverts to per-subdomain on-demand TLS (HTTP-01). Existing projects continue to serve HTTPS
via their individual certs until those expire, then renew on-demand.

---

## Troubleshooting

**TXT records not propagating**

DNS can take 1-10 minutes. Factors:
- Old TTL values (if you lowered TTL after the fact, wait for the old TTL to expire first)
- Registrar-specific propagation lag (some are slower than others)
- The wizard uses public resolvers (1.1.1.1, 8.8.8.8) — check there if your local resolver shows the record but the wizard doesn't

**Wrong TXT values**

Re-initiate from Settings → TLS → **New order** to get fresh challenge values. ACME orders expire
after 7 days; if you see "order expired" errors, this is the fix.

**ACME rate limits**

Let's Encrypt allows 5 duplicate certificate orders per rolling week per registered domain. If
you hit this during testing, use the ACME staging environment:

```bash
ACME_DIRECTORY_URL=https://acme-staging-v02.api.letsencrypt.org/directory
```

Set this in `/opt/selfbase/.env` (or the docker-compose env). Staging certs show "Fake LE" as
the issuer — browsers will warn, but the issuance flow is identical.

**Cert shows self-signed after issuance**

Caddy may still be serving a cached self-signed cert. Hard-refresh in the browser or wait up to
60s for Caddy's cert cache to update. If the issue persists, check Caddy's logs:

```bash
docker compose logs caddy --tail=50
```
