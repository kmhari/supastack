-- 0002_cli_compat.sql
--
-- Schema delta for the Supabase CLI compatibility feature (P0):
--   * Add `prefix` column to api_tokens for the new sbp_ token format
--   * Add project_functions table (per-instance edge function metadata)
--   * Add function_deploys table (deploy audit log)
--   * Add project_secrets table (per-instance secret index, encrypted at rest)
--
-- Every statement is idempotent (IF NOT EXISTS everywhere). Safe to re-run.
-- See specs/003-supabase-cli-compat-p0/data-model.md for column rationale.

-- ─── 1. api_tokens.prefix ──────────────────────────────────────────────────
ALTER TABLE api_tokens
  ADD COLUMN IF NOT EXISTS prefix text;

CREATE INDEX IF NOT EXISTS api_tokens_prefix_idx
  ON api_tokens (prefix)
  WHERE prefix IS NOT NULL;

-- ─── 2. project_functions ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_functions (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug            text        NOT NULL,
  name            text        NOT NULL,
  status          text        NOT NULL DEFAULT 'ACTIVE'
                                CHECK (status IN ('ACTIVE', 'REMOVED')),
  verify_jwt      boolean     NOT NULL DEFAULT true,
  version         integer     NOT NULL DEFAULT 1,
  entrypoint_path text,
  import_map_path text,
  source_path     text        NOT NULL,
  size_bytes      bigint      NOT NULL,
  sha256          text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS project_functions_instance_slug
  ON project_functions (instance_ref, slug);

CREATE INDEX IF NOT EXISTS project_functions_active_idx
  ON project_functions (instance_ref, status)
  WHERE status = 'ACTIVE';

-- ─── 3. function_deploys ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS function_deploys (
  id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  function_id   uuid        REFERENCES project_functions(id) ON DELETE CASCADE,
  instance_ref  text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  slug          text        NOT NULL,
  version       integer     NOT NULL,
  status        text        NOT NULL CHECK (status IN ('SUCCEEDED', 'FAILED', 'ROLLED_BACK')),
  size_bytes    bigint,
  sha256        text,
  error_message text,
  started_at    timestamptz NOT NULL DEFAULT now(),
  finished_at   timestamptz,
  deployed_by   uuid        REFERENCES users(id) ON DELETE SET NULL,
  source        text        NOT NULL CHECK (source IN ('cli', 'dashboard', 'api'))
);

CREATE INDEX IF NOT EXISTS function_deploys_instance_idx
  ON function_deploys (instance_ref, started_at DESC);

-- ─── 4. project_secrets ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS project_secrets (
  id              uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref    text        NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  name            text        NOT NULL,
  encrypted_value bytea       NOT NULL,
  value_sha256    text        NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  created_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  updated_by      uuid        REFERENCES users(id) ON DELETE SET NULL,
  CONSTRAINT project_secrets_name_format
    CHECK (name ~ '^[A-Z][A-Z0-9_]{0,63}$')
);

-- Re-runs against a migrated DB get the column too (idempotent).
ALTER TABLE project_secrets
  ADD COLUMN IF NOT EXISTS value_sha256 text;
UPDATE project_secrets SET value_sha256 = '' WHERE value_sha256 IS NULL;
ALTER TABLE project_secrets ALTER COLUMN value_sha256 SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS project_secrets_instance_name
  ON project_secrets (instance_ref, name);
