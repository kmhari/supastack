# Research: Wildcard TLS Cert via DNS-01

**Feature**: 004-wildcard-cert-dns01 | **Date**: 2026-05-23 | **Updated**: 2026-05-23 (post-clarification)

## Decision 1: ACME Client Strategy

**Decision**: `acme-client` npm package with **manual DNS-01** — the operator adds the TXT records themselves at their registrar. The platform never calls any DNS provider API in v1.

**Rationale**:
- Works with any DNS provider (Cloudflare, Route 53, Namecheap, GoDaddy, etc.) without credentials.
- The reference implementation in `/Users/lord/Code/open-frontend/apps/api/src/services/acme-manual.ts` is proven and battle-tested — direct copy+adapt.
- No custom Caddy build required: stock `caddy:2.8-alpine` supports `tls.certificates.load_files`.
- No DNS API credentials to store, rotate, revoke, or validate — simpler DB schema.
- Automated Cloudflare API integration tracked in [issue #6](https://github.com/kmhari/selfbase/issues/6); can be layered on top without restructuring.

**Alternatives considered**:
- Custom Caddy build with `caddy-dns/cloudflare` module — requires Docker image build, Cloudflare-only, more complex cert lifecycle tracking. Rejected.
- `lego` sidecar — another container, cert hand-off complexity. Rejected.

**acme-client API used**:
```ts
import acme from 'acme-client';
const client = new acme.Client({ directoryUrl: acme.directory.letsencrypt.production, accountKey });
await client.createAccount({ termsOfServiceAgreed: true, contact: [`mailto:${adminEmail}`] });
const order = await client.createOrder({ identifiers: [
  { type: 'dns', value: apex },
  { type: 'dns', value: `*.${apex}` },
]});
const authorizations = await client.getAuthorizations(order);
// ... per-authz: getChallengeKeyAuthorization → TXT record value
// After operator adds TXT + DNS confirmed:
await client.completeChallenge(dnsChallenge);
await client.waitForValidStatus(dnsChallenge);
const [keyPem, csr] = await acme.crypto.createCsr({ commonName: apex, altNames: [apex, `*.${apex}`] });
const finalized = await client.finalizeOrder(order, csr);
const certPem = await client.getCertificate(finalized);
```

---

## Decision 2: TXT Challenge Records (Two Values, One Name)

**Decision**: ACME DNS-01 for `apex + *.apex` in a single order generates **two authorizations**, each with a different challenge value, but **both on the same TXT record name** (`_acme-challenge.<apex>`). The operator must add both values as a multi-value TXT entry.

**Confirmed from open-frontend**:
```ts
// Both authz.identifier.value = 'apex.com' and '*.apex.com' produce:
const recordName = `_acme-challenge.${authz.identifier.value.replace(/^\*\./, '')}`;
// → always '_acme-challenge.apex.com' for both
// Each produces a different keyAuth value → both values required simultaneously
```

**UX implication**: The wizard shows TWO `Value` fields for the same `_acme-challenge.<apex>` host record. The DNS check polls for both values being present. Phrased in the wizard as: "Add a TXT record with BOTH values below — some registrars call this a 'multi-value' TXT record."

---

## Decision 3: DNS Propagation Check

**Decision**: Use Node.js `dns/promises.Resolver` pointed at public resolvers (1.1.1.1, 8.8.8.8, 9.9.9.9) to verify TXT record visibility before completing the ACME challenge.

**Rationale**: Public resolvers closely match what Let's Encrypt's validators see, avoiding stale-cache false negatives from the system resolver.

**Implementation** (from open-frontend verbatim):
```ts
const resolver = new Resolver();
resolver.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
const values = (await resolver.resolveTxt('_acme-challenge.apex.com')).flat();
const found = expectedValues.every(v => values.includes(v));
```

**Polling**: Frontend polls `GET /api/wildcard-certs/status?apex=<apex>` every 10 seconds. The status endpoint re-runs the DNS check on each call, returning `{ allDnsReady: bool, dnsChecks: [{ name, value, found }] }`.

---

## Decision 4: Cert + Key Storage

**Decision**: Three-layer storage:
1. **Disk** (`/var/selfbase/certs/<apex>/cert.pem` + `key.pem`) — Caddy reads from here via `tls.certificates.load_files`. Written by the API container to the shared `certs-data` Docker volume.
2. **DB** — `wildcard_certs` table stores cert PEM (plaintext — it's public), encrypted key PEM, and all order metadata. This allows cert reload after disk loss without re-running ACME.
3. **Encrypted key PEM** — `encryptJson(keyPem, loadMasterKey())` → bytea column. Same mechanism as backup store config and instance secrets.

**Shared volume**: `certs-data` Docker volume mounted at `/var/selfbase/certs` in both `api` (write) and `caddy` (read, `:ro`).

---

## Decision 5: Caddy Integration (no custom build needed)

**Decision**: Stock `caddy:2.8-alpine`. When a wildcard cert exists, `buildCaddyConfig()` adds two blocks to the Caddy JSON config:

**Block 1 — `tls.certificates.load_files`** (tells Caddy to load the cert from disk):
```json
{
  "tls": {
    "certificates": {
      "load_files": [{
        "certificate": "/var/selfbase/certs/apex.com/cert.pem",
        "key": "/var/selfbase/certs/apex.com/key.pem",
        "tags": ["wildcard:apex.com"]
      }]
    },
    "automation": {
      "on_demand": { "ask": "http://api:3001/internal/tls/ask" },
      "policies": [{ "on_demand": true }]
    }
  }
}
```

**Block 2 — `tls_connection_policies`** on the HTTPS server (tells Caddy which cert to use for `*.apex` SNI):
```json
{
  "tls_connection_policies": [
    {
      "match": { "sni": ["apex.com", "*.apex.com"] },
      "certificate_selection": { "any_tag": ["wildcard:apex.com"] }
    },
    {}
  ]
}
```

Without a wildcard cert: only `{ "automation": { ... } }` (existing behavior, no `certificates` block, no `tls_connection_policies`).

**No change to `infra/docker-compose.yml` caddy service image** — stays `caddy:2.8-alpine`.

---

## Decision 6: ACME Account Key

**Decision**: Generate once at first `initiateWildcardOrder` call; reuse on all subsequent calls (including renewal). Store encrypted in `wildcard_certs.account_key_pem`. Using `encryptJson(accountKeyPem.toString('utf8'), masterKey)`.

**Rationale** (from open-frontend): The ACME account key is the long-lived identity with Let's Encrypt. Generating a new key per renewal would create a new account and consume rate-limit quota. Reuse is the correct pattern.

**Key type**: RSA 2048 via `await acme.crypto.createPrivateKey()` (acme-client default).

---

## Decision 7: Renewal Strategy (v1)

**Decision**: Manual renewal with dashboard alert. No automated background renewal in v1.

**Flow**:
1. A BullMQ daily cron job (`cert-check`) probes `not_after` from the `wildcard_certs` table.
2. If `not_after - now() < 30 days` AND status is `issued`: mark `renewal_due = true` in DB.
3. Dashboard reads `renewal_due` flag and shows a persistent banner with expiry date + "Renew now" button.
4. Operator clicks "Renew" → hits `POST /api/wildcard-certs/initiate` → wizard re-renders with new TXT challenge values (the ACME account key is reused; order URL refreshed) → operator adds TXT → clicks Verify → new cert issued.

**Automated renewal** (Cloudflare API) tracked in [issue #6](https://github.com/kmhari/selfbase/issues/6).

---

## Decision 8: ACME Account Email

**Decision**: Use the super-admin's email (stored in `users` table from `/setup`). This is the same email the operator used to create their selfbase account.

**Rationale**: No additional configuration needed; the email is already available. Let's Encrypt uses it only for expiry/policy notifications — using the admin email is correct.

---

## Decision 9: ACME Directory

**Decision**: Use `acme.directory.letsencrypt.production` by default. Support `ACME_DIRECTORY_URL` env override for staging during development (matches open-frontend pattern).

```ts
const DIRECTORY_URL = process.env.ACME_DIRECTORY_URL ?? acme.directory.letsencrypt.production;
```

---

## Decision 10: Certs Directory Path

**Decision**: `/var/selfbase/certs` in both containers (mounted from `certs-data` volume). Per-apex subdirectory: `/var/selfbase/certs/<apex>/cert.pem` + `key.pem`.

```ts
const CERTS_DIR = process.env.SELFBASE_CERTS_DIR ?? '/var/selfbase/certs';
// path: CERTS_DIR/<apex>/cert.pem
```

Caddy reads the same path (volume is read-only in caddy). On VM wipe, this volume is cleared alongside pg-data (as noted in the spec assumptions), so re-setup re-issues the cert cleanly.

---

## Reference Implementation

All ACME logic is adapted from:
- `open-frontend/apps/api/src/services/acme-manual.ts` — core ACME flow
- `open-frontend/apps/api/src/routes/wildcard-cert.ts` — route handlers + DNS check
- `open-frontend/apps/edge/src/reload.ts` — Caddy config generation with `load_files` + `tls_connection_policies`

These are the proven patterns; selfbase adapts them to its DB schema, Docker layout, and auth model.
