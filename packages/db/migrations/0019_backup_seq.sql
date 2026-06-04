-- 0019_backup_seq.sql
--
-- Feature 086 US6 — numeric surrogate id for backups.
--
-- The platform studio (IS_PLATFORM=true) types require a NUMERIC backup id
-- (`BackupsResponse.backups[].id: number`). The native `backups.id` is a uuid
-- (kept as the CLI / `/v1` contract). `seq` is a globally-unique bigint exposed
-- as the studio-facing id; the platform restore route resolves it back to the
-- uuid, scoped to the project (see services/backups-mgmt-service.ts).
--
-- Idempotent + additive (Constitution I): re-running the whole sequence is a no-op.

ALTER TABLE backups ADD COLUMN IF NOT EXISTS seq bigint;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_sequences WHERE sequencename = 'backups_seq_seq') THEN
    CREATE SEQUENCE backups_seq_seq OWNED BY backups.seq;
  END IF;
END$$;

-- Backfill existing rows (no-op on re-run — every row already has a seq).
UPDATE backups SET seq = nextval('backups_seq_seq') WHERE seq IS NULL;

-- New rows get a stable numeric id automatically.
ALTER TABLE backups ALTER COLUMN seq SET DEFAULT nextval('backups_seq_seq');

-- Supports the ref-scoped resolve (instance_ref, seq); seq is globally unique anyway.
CREATE UNIQUE INDEX IF NOT EXISTS backups_ref_seq_uniq ON backups (instance_ref, seq);
