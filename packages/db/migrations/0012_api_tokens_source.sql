-- 0012_api_tokens_source.sql
--
-- Feature 011 — CLI device-code login.
--
-- Adds a `source` marker to api_tokens so the dashboard can visually
-- distinguish PATs minted via the CLI device-code flow from those
-- created manually in the settings page. Existing rows backfill to
-- 'manual' via the column default.
--
-- Idempotent.

ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'manual';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'api_tokens_source_check'
  ) THEN
    ALTER TABLE api_tokens
      ADD CONSTRAINT api_tokens_source_check CHECK (source IN ('manual', 'cli'));
  END IF;
END $$;
