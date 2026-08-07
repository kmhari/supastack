-- Feature 122 — credential lifetime + explicit revocation.
-- Idempotent: safe to re-run any number of times.

-- 1. Absolute expiry for personal access tokens. NULL = grandfathered; pre-122
--    tokens keep working until the announced FR-013 backfill sets a value.
ALTER TABLE api_tokens ADD COLUMN IF NOT EXISTS expires_at timestamptz;

-- 2. Explicit, inspectable revocation trail (FR-008). Records who lost access to
--    which org, when, by whom, and how many credentials were revoked.
CREATE TABLE IF NOT EXISTS credential_revocations (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              uuid NOT NULL,
  organization_id      uuid,
  reason               text NOT NULL,
  actor_user_id        uuid,
  pats_revoked         integer NOT NULL DEFAULT 0,
  oauth_grants_revoked integer NOT NULL DEFAULT 0,
  revoked_at           timestamptz NOT NULL DEFAULT now()
);

-- Lookups are "what was revoked for this user" and "what happened in this org".
CREATE INDEX IF NOT EXISTS idx_credential_revocations_user ON credential_revocations (user_id);
CREATE INDEX IF NOT EXISTS idx_credential_revocations_org ON credential_revocations (organization_id);

-- Partial index for the hot PAT-validation path: only live, expiring tokens.
CREATE INDEX IF NOT EXISTS idx_api_tokens_expires_at
  ON api_tokens (expires_at)
  WHERE revoked_at IS NULL AND expires_at IS NOT NULL;
