-- 0006_pg_edge_certs.sql
--
-- Per-project ACME certs covering db.<ref>.<apex> exactly. Strict-TLS clients
-- (rustls/sqlx/`supabase db diff --linked`/Go pgx with verify-full) need the
-- cert's SAN to match the hostname being connected to. The single wildcard
-- *.<apex> only covers one label deep (RFC 6125), so db.<ref>.<apex> is NOT
-- covered. Solution: per-project HTTP-01 cert auto-issued on instance create.
--
-- The pg-edge-proxy's SNICallback returns the per-project cert when available,
-- falling back to the wildcard cert for any SNI without a per-project cert
-- (apex, studio-, projects whose per-project cert hasn't been issued yet, etc.)

CREATE TABLE IF NOT EXISTS pg_edge_certs (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  hostname        text        NOT NULL,                       -- db.<ref>.<apex>
  cert_pem        text,                                       -- full PEM chain (public)
  key_pem         bytea,                                      -- encrypted private key
  not_before      timestamptz,
  not_after       timestamptz,
  status          text        NOT NULL DEFAULT 'pending'
                                CHECK (status IN ('pending','issued','failed','expired')),
  last_error      text,
  last_issued_at  timestamptz,
  last_attempt_at timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pg_edge_certs_hostname_unique
  ON pg_edge_certs (hostname);
CREATE INDEX IF NOT EXISTS pg_edge_certs_instance_idx
  ON pg_edge_certs (instance_ref);
CREATE INDEX IF NOT EXISTS pg_edge_certs_renewal_idx
  ON pg_edge_certs (not_after)
  WHERE status = 'issued';
