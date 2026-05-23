# API Contracts: Wildcard TLS Cert via DNS-01

**Feature**: 004-wildcard-cert-dns01 | **Date**: 2026-05-23 | **Updated**: 2026-05-23 (post-clarification)

All routes registered in Fastify under the authenticated namespace. Caddy's `handle_path /api/*` strips the `/api` prefix, so `POST /api/wildcard-certs/initiate` reaches Fastify as `POST /wildcard-certs/initiate`.

Authentication: all wildcard-cert endpoints require `org.update` permission (admin role).

---

## POST /wildcard-certs/initiate

**Purpose**: Start (or restart) a DNS-01 ACME order. Returns the TXT record name and values the operator must add at their registrar.

**Auth**: `org.update`

**Request body**: none (apex comes from `org.apexDomain`)

**Pre-conditions**:
- `org.apexDomain` must be set (returns 409 otherwise)
- A `wildcard_certs` row may already exist (idempotent — creates a new ACME order, reuses stored account key)

**Server behaviour**:
1. Load org row → get `apex`
2. Load or generate ACME account key (stored encrypted in `wildcard_certs.account_key_pem`)
3. Get admin email from `users` table (first admin user)
4. Call `acme-client`: `createAccount` (idempotent) + `createOrder({ identifiers: [apex, *.apex] })`
5. Call `getAuthorizations` → derive TXT record name and values (always 2 values for the same `_acme-challenge.<apex>` hostname)
6. Upsert `wildcard_certs` row with `status='awaiting_dns'`, `order_url`, `challenge_records`
7. Insert `cert_renewal_events` with `{ outcome: 'in_progress', triggered_by: 'initial' | 'manual' }`
8. Insert audit log `tls.initiated`
9. Return challenge records

**Response 201**:
```json
{
  "apex": "selfbase.example.com",
  "status": "awaiting_dns",
  "challengeRecords": [
    {
      "name": "_acme-challenge.selfbase.example.com",
      "value": "abc123base64urlvalue1"
    },
    {
      "name": "_acme-challenge.selfbase.example.com",
      "value": "def456base64urlvalue2"
    }
  ],
  "ttlHint": 60
}
```

**Error responses**:
- `409` — no apex domain configured: `{ error: "Apex domain must be set before requesting a wildcard certificate" }`
- `429` — Let's Encrypt rate limit hit: `{ error: "ACME rate limit reached. Try again in N hours." }`
- `502` — Let's Encrypt unreachable: `{ error: "ACME directory unreachable" }`

---

## POST /wildcard-certs/verify

**Purpose**: Check that TXT records are visible in DNS, then complete the ACME challenge, finalize the order, download the certificate, write cert+key to disk, and reload Caddy.

**Auth**: `org.update`

**Request body**: none (apex from `org.apexDomain`; order from `wildcard_certs` row)

**Server behaviour**:
1. Load `wildcard_certs` row for `org.apexDomain` — must be in `awaiting_dns` or `verifying` status
2. Resolve TXT records via public DNS resolvers (1.1.1.1, 8.8.8.8, 9.9.9.9)
3. If any challenge value is missing → return `{ status: 'awaiting_dns', dnsChecks: [...] }` (200, not error)
4. Mark `status='verifying'`
5. Call `acme-client`: recreate account (idempotent) → `getOrder(orderUrl)` → `getAuthorizations` → per-authz `completeChallenge` + `waitForValidStatus`
6. `acme.crypto.createCsr({ commonName: apex, altNames: [apex, *.apex] })`
7. `finalizeOrder` → `getCertificate` → PEM chain
8. Write `cert.pem` + `key.pem` to `/var/selfbase/certs/<apex>/`
9. Update `wildcard_certs`: `status='issued'`, `cert_pem`, `key_pem` (encrypted), `not_before`, `not_after`, `issued_at`, `last_error=null`
10. Update `cert_renewal_events`: `outcome='success'`, `cert_not_after`, `finished_at`
11. Insert audit log `tls.issued`
12. Rebuild Caddy config + reload (`reloadCaddy()`)
13. Return issued status

**Response 200** — DNS not yet ready:
```json
{
  "status": "awaiting_dns",
  "dnsChecks": [
    { "name": "_acme-challenge.selfbase.example.com", "value": "abc123...", "found": true },
    { "name": "_acme-challenge.selfbase.example.com", "value": "def456...", "found": false }
  ],
  "allDnsReady": false
}
```

**Response 200** — Certificate issued:
```json
{
  "status": "issued",
  "apex": "selfbase.example.com",
  "notBefore": "2026-05-23T12:00:00Z",
  "notAfter": "2026-08-21T12:00:00Z"
}
```

**Response 200** — ACME challenge failed:
```json
{
  "status": "failed",
  "message": "urn:ietf:params:acme:error:dns: No TXT records found for DNS challenge"
}
```

**Error responses**:
- `404` — no ACME order in progress: `{ error: "No pending wildcard cert order. Call /initiate first." }`
- `409` — cert already issued (not in awaiting_dns/verifying): `{ error: "Certificate already issued. Call /initiate to start a renewal." }`

---

## GET /wildcard-certs/status

**Purpose**: Returns current wildcard cert state for the setup wizard progress polling and the dashboard TLS panel.

**Auth**: `org.read`

**Query params**: none (uses `org.apexDomain`)

**Response 200** — no row or status='pending':
```json
{ "cert": null }
```

**Response 200** — order in progress:
```json
{
  "cert": {
    "apex": "selfbase.example.com",
    "status": "awaiting_dns",
    "challengeRecords": [
      { "name": "_acme-challenge.selfbase.example.com", "value": "abc123...", "found": false },
      { "name": "_acme-challenge.selfbase.example.com", "value": "def456...", "found": false }
    ],
    "allDnsReady": false,
    "lastError": null
  }
}
```

**Response 200** — issued:
```json
{
  "cert": {
    "apex": "selfbase.example.com",
    "status": "issued",
    "notBefore": "2026-05-23T12:00:00Z",
    "notAfter": "2026-08-21T12:00:00Z",
    "issuedAt": "2026-05-23T12:05:42Z",
    "renewalDue": false,
    "lastError": null,
    "renewalHistory": [
      {
        "triggeredBy": "initial",
        "outcome": "success",
        "startedAt": "2026-05-23T12:00:00Z",
        "finishedAt": "2026-05-23T12:05:42Z"
      }
    ]
  }
}
```

**DNS check** (included when `status === 'awaiting_dns'`): The endpoint resolves TXT records in real-time on each call using public resolvers and returns per-record `found` flags. Frontend uses this for the live DNS propagation indicator.

---

## DELETE /wildcard-certs

**Purpose**: Disable the wildcard certificate and revert Caddy to per-subdomain on-demand TLS.

**Auth**: `org.update`

**Server behaviour**:
1. Update `wildcard_certs.status = 'disabled'`
2. Rebuild Caddy config (removes `load_files` + `tls_connection_policies` blocks)
3. Reload Caddy
4. Insert audit log `tls.disabled`
5. Cert+key files remain on disk (Caddy no longer references them)

**Response 204**: No body.

**Error**: `404` if no wildcard cert configured.

---

## GET /org (modified — add hasCert field)

**Purpose**: Enrich the existing org response with wildcard cert presence flag. Used by the dashboard to conditionally show the "Add wildcard TLS" banner (FR-009).

**Change**: Add `hasCert: boolean` field derived from `wildcard_certs` row existence with `status='issued'`.

**Modified response**:
```json
{
  "id": "...",
  "name": "Acme Corp",
  "apexDomain": "selfbase.example.com",
  "backupStoreKind": "local",
  "hasCert": false
}
```

---

## Setup Wizard Integration

The DNS-01 step in the wizard operates as follows after setup POST completes (operator is authenticated):

```
POST /api/setup  →  session established
  → operator sees DNS-01 step
    → GET /api/wildcard-certs/status  (check if existing order)
      → if no order: POST /api/wildcard-certs/initiate  →  show TXT records
        → operator adds TXT at registrar
          → POST /api/wildcard-certs/verify  (operator clicks "Verify")
            → { status: 'awaiting_dns' }  → show per-record DNS status
            → { status: 'issued' }        → advance to "Done" panel
```

Wizard also auto-polls `GET /api/wildcard-certs/status` every 10 seconds to show live TXT propagation status without requiring the operator to keep clicking "Verify".

---

## Caddy Admin (internal — not operator-facing)

After `POST /wildcard-certs/verify` succeeds, the API calls `reloadCaddy()` which POSTs to `http://caddy:2019/load`. The new Caddy config includes:

```json
{
  "apps": {
    "tls": {
      "certificates": {
        "load_files": [{
          "certificate": "/var/selfbase/certs/apex.com/cert.pem",
          "key": "/var/selfbase/certs/apex.com/key.pem",
          "tags": ["wildcard:apex.com"]
        }]
      },
      "automation": { ... }
    },
    "http": {
      "servers": {
        "openfront_https": {
          "tls_connection_policies": [
            { "match": { "sni": ["apex.com", "*.apex.com"] },
              "certificate_selection": { "any_tag": ["wildcard:apex.com"] } },
            {}
          ],
          ...
        }
      }
    }
  }
}
```
