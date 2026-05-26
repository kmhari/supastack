-- 0013_oauth_tables.sql
--
-- Feature 014 — OAuth 2.1 authorization server.
--
-- Four tables backing the authorize/token/refresh/revoke lifecycle. Hot-path
-- revocation lives in Redis (selfbase:oauth:revoked:<jti>); the
-- oauth_revocations table here is an audit-trail / cold-path fallback.
--
-- Idempotent — every statement uses IF NOT EXISTS / DO NOTHING patterns so
-- re-running the full migration sequence is a no-op.

-- ─── oauth_clients ─────────────────────────────────────────────────────────
-- RFC 7591 dynamically-registered OAuth clients (v1 has no pre-registered
-- allow-list; every MCP client self-registers via /v1/oauth/register).

CREATE TABLE IF NOT EXISTS oauth_clients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_name     text NOT NULL,
  redirect_uris   text[] NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  created_by_ip   inet,
  metadata        jsonb
);

-- ─── oauth_codes ───────────────────────────────────────────────────────────
-- Short-lived (≤60s) single-use authorization codes. Issued by authorize,
-- consumed by token endpoint (PKCE verifier checked at consume time).

CREATE TABLE IF NOT EXISTS oauth_codes (
  code            text PRIMARY KEY,
  client_id       uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    text NOT NULL,
  code_challenge  text NOT NULL,
  scope           text NOT NULL,
  expires_at      timestamptz NOT NULL,
  used_at         timestamptz
);

CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires_at ON oauth_codes(expires_at);

-- ─── oauth_refresh_tokens ──────────────────────────────────────────────────
-- Opaque rotating refresh tokens. Single-use (rotated on every refresh);
-- 30-day idle expiry. `previous_token` field supports refresh-token-reuse
-- detection per RFC 6749 §10.4.

CREATE TABLE IF NOT EXISTS oauth_refresh_tokens (
  token           text PRIMARY KEY,
  client_id       uuid NOT NULL REFERENCES oauth_clients(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  scope           text NOT NULL,
  issued_at       timestamptz NOT NULL DEFAULT now(),
  last_used_at    timestamptz NOT NULL DEFAULT now(),
  revoked_at      timestamptz,
  previous_token  text
);

CREATE INDEX IF NOT EXISTS idx_oauth_refresh_user_client
  ON oauth_refresh_tokens(user_id, client_id);
CREATE INDEX IF NOT EXISTS idx_oauth_refresh_last_used
  ON oauth_refresh_tokens(last_used_at);

-- ─── oauth_revocations ─────────────────────────────────────────────────────
-- Audit-trail / cold-path lookup for revoked access tokens. Hot-path check
-- is Redis (selfbase:oauth:revoked:<jti>); this table is for forensics +
-- a backstop if Redis is unavailable on a future request.

CREATE TABLE IF NOT EXISTS oauth_revocations (
  id              bigserial PRIMARY KEY,
  jti             text NOT NULL,
  user_id         uuid NOT NULL,
  client_id       uuid NOT NULL,
  revoked_at      timestamptz NOT NULL DEFAULT now(),
  revoke_reason   text
);

CREATE INDEX IF NOT EXISTS idx_oauth_revocations_jti ON oauth_revocations(jti);
