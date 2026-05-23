# Data Model: Wildcard TLS Cert via DNS-01

**Feature**: 004-wildcard-cert-dns01 | **Date**: 2026-05-23 | **Updated**: 2026-05-23 (post-clarification)

---

## New Entities

### 1. wildcard_certs (table)

Single source of truth for the ACME order state and issued certificate. One row per apex domain per deployment (effectively a singleton, enforced by unique index on `apex`). Combines the ACME order tracking and certificate metadata into one table — matches the open-frontend `wildcardCerts` pattern.

```sql
CREATE TABLE IF NOT EXISTS wildcard_certs (
  id                  uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id              uuid        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  apex                text        NOT NULL,
  status              text        NOT NULL DEFAULT 'pending'
                                    CHECK (status IN (
                                      'pending',
                                      'awaiting_dns',
                                      'verifying',
                                      'issued',
                                      'failed',
                                      'disabled'
                                    )),
  account_email       text        NOT NULL,
  account_key_pem     bytea       NOT NULL,      -- encrypted: encryptJson(pem, masterKey)
  order_url           text,                       -- Let's Encrypt ACME order URL
  challenge_records   jsonb       NOT NULL DEFAULT '[]',
                                                  -- [{ name, value }] — TXT records to add
  cert_pem            text,                       -- plaintext PEM chain (public)
  key_pem             bytea,                      -- encrypted: encryptJson(pem, masterKey)
  not_before          timestamptz,
  not_after           timestamptz,
  renewal_due         boolean     NOT NULL DEFAULT false,
  last_error          text,
  issued_at           timestamptz,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  created_by          uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by          uuid        REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS wildcard_certs_apex_unique
  ON wildcard_certs (apex);

CREATE INDEX IF NOT EXISTS wildcard_certs_org_idx
  ON wildcard_certs (org_id);
```

**Field notes**:

- `account_key_pem` — RSA 2048 private key PEM, encrypted via `encryptJson(pem, masterKey)`. Generated once on first `initiateWildcardOrder`; reused for all subsequent renewals to preserve the ACME account identity.
- `order_url` — the Let's Encrypt ACME order resource URL (`https://acme-v02.api.letsencrypt.org/acme/order/…`). Stored so `verifyAndFinalize` can resume an in-progress order without creating a new one.
- `challenge_records` — JSON array of `{ name: string, value: string }`. Always has exactly 2 entries for a `apex + *.apex` order (one per authorization). Both reference the same TXT hostname (`_acme-challenge.<apex>`) with different values.
- `cert_pem` — full PEM chain (leaf + intermediates). Stored as plaintext (certificates are public). Also written to `/var/selfbase/certs/<apex>/cert.pem` on the shared volume.
- `key_pem` — private key PEM, encrypted via `encryptJson(pem, masterKey)`. Also written to `/var/selfbase/certs/<apex>/key.pem` on the shared volume (mode 0o600). Stored in DB as backup so cert can be reloaded into Caddy after a volume wipe without re-running ACME.
- `renewal_due` — set `true` by the daily `cert-check` BullMQ job when `not_after - now() < 30 days`. Cleared when a new cert is issued. Drives the dashboard alert banner.
- `status` lifecycle:
  - `pending` — row created, `initiateWildcardOrder` not yet called
  - `awaiting_dns` — ACME order created, TXT records returned to operator
  - `verifying` — TXT confirmed in DNS, ACME challenge being completed
  - `issued` — cert and key written to disk and DB
  - `failed` — `last_error` populated; operator must retry
  - `disabled` — operator explicitly disabled wildcard (via DELETE); cert files remain on disk but Caddy config excludes them

---

### 2. cert_renewal_events (table)

Audit log for every issuance and renewal attempt. Feeds the dashboard TLS history view (FR-015) and the 30-day alert logic.

```sql
CREATE TABLE IF NOT EXISTS cert_renewal_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_id         uuid        REFERENCES wildcard_certs(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  triggered_by    text        NOT NULL CHECK (triggered_by IN ('initial', 'manual')),
  outcome         text        NOT NULL CHECK (outcome IN ('success', 'failure', 'in_progress')),
  error_message   text,
  cert_not_after  timestamptz,      -- populated on success: new cert's expiry
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX IF NOT EXISTS cert_renewal_events_cert_idx
  ON cert_renewal_events (cert_id, started_at DESC);

CREATE INDEX IF NOT EXISTS cert_renewal_events_org_idx
  ON cert_renewal_events (org_id, started_at DESC);
```

**`triggered_by`** values:
- `initial` — first issuance during /setup wizard
- `manual` — operator-triggered from dashboard "Renew" button (or post-setup first-time)

Note: `auto` (background automated renewal) is not present in v1. It will be added when issue #6 (Cloudflare API) ships.

---

## Removed Entities (from initial plan)

The earlier plan proposed three separate tables (`dns_providers`, `tls_certificates`, `cert_renewal_events`). After the manual DNS-01 clarification:

- `dns_providers` — **removed** (no DNS API credentials to store in v1)
- `tls_certificates` — **merged into `wildcard_certs`** (ACME order state + cert metadata belong together)
- `cert_renewal_events` — **kept** (same purpose, simplified `triggered_by` enum)

---

## Modified Entities

### org (existing table) — no changes

No new columns. `wildcard_certs.org_id` references `org.id`.

### audit_log (existing table)

New events added to the existing audit log:
- `'tls.initiated'` — operator started an ACME order (TXT records generated)
- `'tls.issued'` — wildcard cert issued and loaded
- `'tls.renewed'` — new cert issued via renewal flow
- `'tls.failed'` — ACME order failed (error recorded in `wildcard_certs.last_error`)
- `'tls.disabled'` — operator disabled the wildcard

---

## Entity Relationships

```
org (1) ──────────── (0..1) wildcard_certs
wildcard_certs (1) ─── (*) cert_renewal_events
org (1) ──────────────── (*) cert_renewal_events
```

`wildcard_certs` is effectively a singleton per org (one apex per deployment), enforced by the unique index on `apex`.

---

## State Transitions

### wildcard_certs.status

```
                POST /wildcard-certs/initiate
pending ──────────────────────────────────────► awaiting_dns
                                                      │
                        POST /wildcard-certs/verify   │
                        (TXT not yet in DNS)          │ (TXT confirmed)
                              ▼                       ▼
                        awaiting_dns ◄────── verifying
                                                  │
                                      (ACME fails) │ (ACME succeeds)
                                          ▼        ▼
                                        failed   issued
                                          │          │
                                  (retry) │          │ (renewal due)
                                          └──────────┘
                                                  │
                                       renewal flow re-runs
                                                  │
                                               issued (new cert)
                                       
issued ─────────────────────────────────────────► disabled
       DELETE /wildcard-certs (operator action)
```

### cert_renewal_events.outcome

```
in_progress → success   (cert written to disk, Caddy reloaded, DB updated)
in_progress → failure   (ACME error, DNS check failure, or write error)
```

---

## Migration File

**Filename**: `packages/db/migrations/0003_wildcard_cert.sql`

All statements use `IF NOT EXISTS` — safe to re-run on any existing deployment. No table drops, no data loss.

---

## Drizzle Schema

**New file**: `packages/db/src/schema/tls.ts`

Exports: `wildcardCerts`, `certRenewalEvents`

**Edit**: `packages/db/src/schema/index.ts` — add `export * from './tls.js'`

---

## Shared Volume

**`certs-data`** Docker volume:
- Mounted at `/var/selfbase/certs` in `api` container (read-write; API writes cert+key files)
- Mounted at `/var/selfbase/certs` in `caddy` container (read-only; Caddy reads cert+key files)

File paths per apex:
```
/var/selfbase/certs/<apex>/cert.pem    (mode 0o644)
/var/selfbase/certs/<apex>/key.pem     (mode 0o600)
```

On VM wipe, this volume is removed alongside `pg-data` and `caddy-data`. Re-setup re-issues the ACME cert and rewrites the files.
