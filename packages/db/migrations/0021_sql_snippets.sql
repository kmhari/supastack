-- 0021_sql_snippets.sql
--
-- Feature 108 — SQL Snippets persistence for Studio's SQL Editor.
-- owner_id is a soft FK to auth.users (GoTrue-owned) — no hard FK.

CREATE TABLE IF NOT EXISTS sql_snippet_folders (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref text NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  owner_id    uuid,
  name        text NOT NULL,
  parent_id   uuid,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sql_snippets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  instance_ref text NOT NULL REFERENCES supabase_instances(ref) ON DELETE CASCADE,
  owner_id    uuid,
  folder_id   uuid,
  name        text NOT NULL DEFAULT 'Untitled Query',
  description text,
  content     text NOT NULL DEFAULT '',
  visibility  text NOT NULL DEFAULT 'user' CHECK (visibility IN ('user', 'project')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sql_snippets_instance_ref ON sql_snippets(instance_ref);
CREATE INDEX IF NOT EXISTS idx_sql_snippets_owner_id ON sql_snippets(owner_id);
CREATE INDEX IF NOT EXISTS idx_sql_snippet_folders_instance_ref ON sql_snippet_folders(instance_ref);
