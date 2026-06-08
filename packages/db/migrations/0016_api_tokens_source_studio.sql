-- 0016_api_tokens_source_studio.sql
--
-- Feature 025 — Shared Studio (IS_PLATFORM=true).
--
-- Widens the api_tokens.source CHECK constraint to allow 'studio' as a
-- valid value. 'studio' tokens are minted by the GoTrue shim on Studio
-- login and revoked on logout.
--
-- Idempotent.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_source_check'
  ) THEN
    ALTER TABLE api_tokens DROP CONSTRAINT api_tokens_source_check;
  END IF;
  ALTER TABLE api_tokens
    ADD CONSTRAINT api_tokens_source_check
    CHECK (source IN ('manual', 'cli', 'studio'));
END $$;
