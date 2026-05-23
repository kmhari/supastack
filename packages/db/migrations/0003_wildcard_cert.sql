-- 0003_wildcard_cert.sql
--
-- Wildcard TLS cert via DNS-01 (feature 004):
--   * wildcard_certs — ACME order state + issued cert metadata + key storage
--   * cert_renewal_events — audit trail for every issuance and renewal
--
-- All statements are idempotent (IF NOT EXISTS everywhere). Safe to re-run.

-- ─── 1. wildcard_certs ────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS wildcard_certs (
  id                uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id            uuid        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  apex              text        NOT NULL,
  status            text        NOT NULL DEFAULT 'pending'
                                  CHECK (status IN (
                                    'pending',
                                    'awaiting_dns',
                                    'verifying',
                                    'issued',
                                    'failed',
                                    'disabled'
                                  )),
  account_email     text        NOT NULL,
  account_key_pem   bytea       NOT NULL,
  order_url         text,
  challenge_records jsonb       NOT NULL DEFAULT '[]',
  cert_pem          text,
  key_pem           bytea,
  not_before        timestamptz,
  not_after         timestamptz,
  renewal_due       boolean     NOT NULL DEFAULT false,
  last_error        text,
  issued_at         timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  created_by        uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by        uuid        REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS wildcard_certs_apex_unique
  ON wildcard_certs (apex);

CREATE INDEX IF NOT EXISTS wildcard_certs_org_idx
  ON wildcard_certs (org_id);

-- ─── 2. cert_renewal_events ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS cert_renewal_events (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  cert_id         uuid        REFERENCES wildcard_certs(id) ON DELETE CASCADE,
  org_id          uuid        NOT NULL REFERENCES org(id) ON DELETE CASCADE,
  triggered_by    text        NOT NULL CHECK (triggered_by IN ('initial', 'manual')),
  outcome         text        NOT NULL CHECK (outcome IN ('success', 'failure', 'in_progress')),
  error_message   text,
  cert_not_after  timestamptz,
  started_at      timestamptz NOT NULL DEFAULT now(),
  finished_at     timestamptz
);

CREATE INDEX IF NOT EXISTS cert_renewal_events_cert_idx
  ON cert_renewal_events (cert_id, started_at DESC);

CREATE INDEX IF NOT EXISTS cert_renewal_events_org_idx
  ON cert_renewal_events (org_id, started_at DESC);
