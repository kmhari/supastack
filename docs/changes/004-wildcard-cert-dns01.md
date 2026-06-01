# Feature 004 — Wildcard TLS cert via DNS-01

**Closed**: Issue #2
**Status**: ✅ shipped, live on production
**Spec**: [specs/004-wildcard-cert-dns01/](../../specs/004-wildcard-cert-dns01/)
**Operator guide**: [docs/wildcard-tls.md](../wildcard-tls.md)

## What changed

Before: every project subdomain (`<ref>.<apex>`, `studio-<ref>.<apex>`, etc.) triggered Caddy's on-demand TLS issuance the first time it was hit. This caused first-request latency spikes, hit Let's Encrypt's per-account-per-day rate limits when provisioning multiple projects, and meant every cert was managed independently.

After: a single `*.<apex>` + `<apex>` certificate covers everything. Issued via ACME DNS-01 challenge during the `/setup` wizard. All per-instance subdomains served by the same cert; on-demand TLS removed.

## Architecture

| Component                                       | Role                                                                                                                                                 |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/setup` wizard step 4                          | Shows the two TXT records the operator must add at their registrar                                                                                   |
| `apps/api/src/services/acme.ts`                 | ACME DNS-01 client (acme-client lib) — opens order, retrieves TXT challenges, polls public DNS for propagation, completes validation, downloads cert |
| `wildcard_certs` table                          | Persists ACME account key + cert + key, PEM-encoded; key encrypted via master key                                                                    |
| `certs-data` Docker volume                      | Mounted RO into caddy/api/supavisor at `/var/supastack/certs/<apex>/{cert.pem,key.pem}`                                                               |
| `apps/api/src/services/cert-check.ts`           | Daily BullMQ job that surfaces a dashboard alert at 30 days remaining                                                                                |
| Redis pub/sub `supastack:wildcard-cert:reloaded` | Hot-reload signal — caddy + pg-edge-proxy + supavisor subscribe and re-load the new cert without restart                                             |

## Endpoints / surfaces

| Endpoint                               | What it does                                                                   |
| -------------------------------------- | ------------------------------------------------------------------------------ |
| `POST /api/v1/wildcard-certs/initiate` | Open ACME order, return the two TXT records for the operator to add            |
| `POST /api/v1/wildcard-certs/verify`   | Poll DNS for the TXT records, complete the challenge, finalize, store the cert |
| `GET /api/v1/wildcard-certs/status`    | Current cert state (notAfter, issuer, etc.) — used by the renewal banner       |
| `DELETE /api/v1/wildcard-certs`        | Remove the stored cert (operator override)                                     |

## CLI / operator workflow

```text
1. Operator finishes admin signup in /setup wizard step 1-3
2. Step 4 prompts for the apex domain
3. Platform shows: "Add these two TXT records at <apex>'s DNS provider"
   ┌────────────────────────────────────────────────────┐
   │ Name:  _acme-challenge.<apex>                      │
   │ Value: <token1>                                    │
   │ Name:  _acme-challenge.<apex>                      │
   │ Value: <token2>                                    │
   └────────────────────────────────────────────────────┘
4. Operator adds both at their registrar
5. Auto-polling every 10s; "Issue Certificate" button enables when both visible
6. Click → ACME validates → cert downloaded + cached
7. Done — every <ref>.<apex> URL now serves with the wildcard cert
```

## Renewal (today)

Manual. A dashboard banner at 30 days remaining tells the operator to add fresh TXT records + click "Renew". Automated renewal via Cloudflare DNS API is spec'd in feature 007 (issue #6).

## Cross-feature touch points

- **Feature 005** mounts the same cert in supavisor (`GLOBAL_DOWNSTREAM_CERT_PATH`) and in the pg-edge-proxy for direct `db.<ref>.<apex>:5432` TLS termination
- **Feature 005 Phase 7** adds per-project ACME (HTTP-01) certs for `db.<ref>.<apex>` strict-TLS clients (`rustls`/`sqlx`) because wildcard certs only match one DNS label

## Key files

- `apps/api/src/services/acme.ts`
- `apps/api/src/services/cert-check.ts`
- `apps/api/src/routes/wildcard-certs.ts`
- `apps/web/src/pages/Setup.tsx` (step 4)
- `apps/web/src/components/WildcardCertCard.tsx`
- `packages/db/migrations/0003_wildcard_cert.sql`
- `packages/db/src/schema/tls.ts`
