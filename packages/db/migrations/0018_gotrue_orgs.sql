-- Feature 084 — GoTrue control-plane auth + multi-tenant orgs cutover.
--
-- Splits the `org` singleton into `installation` (apex + backups) + multi-row
-- `organizations` (tenant); moves identity to GoTrue's `auth.users`; drops the
-- legacy `users`/`org`/`invites`/`org_members`. The drops are an intentional,
-- approved GREENFIELD destructive change (plan.md Complexity Tracking) — the
-- only exception to the additive default (Constitution I). Everything is guarded
-- so re-running the whole sequence is a no-op (Constitution I — idempotent).

-- 1. installation singleton (apex + backup store), seeded from `org` if present.
CREATE TABLE IF NOT EXISTS installation (
  id integer PRIMARY KEY DEFAULT 1,
  apex_domain text UNIQUE,
  backup_store_kind text NOT NULL DEFAULT 'local',
  backup_store_config_encrypted bytea,
  smtp_config_encrypted bytea,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT installation_singleton CHECK (id = 1)
);

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'org')
     AND NOT EXISTS (SELECT 1 FROM installation) THEN
    INSERT INTO installation (id, apex_domain, backup_store_kind, backup_store_config_encrypted)
    SELECT 1, apex_domain, backup_store_kind, backup_store_config_encrypted FROM org LIMIT 1;
  END IF;
END $$;

-- 2. organizations (tenant; 20-char ref id, NOT a uuid).
CREATE TABLE IF NOT EXISTS organizations (
  id text PRIMARY KEY,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- 3. organization_members.
CREATE TABLE IF NOT EXISTS organization_members (
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (organization_id, user_id)
);

-- 4. organization_invitations.
CREATE TABLE IF NOT EXISTS organization_invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id text NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  email citext NOT NULL,
  token_sha256 bytea NOT NULL UNIQUE,
  role text NOT NULL,
  invited_by_user_id uuid NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS organization_invitations_email_open
  ON organization_invitations (organization_id, email) WHERE consumed_at IS NULL;

-- 5. Drop ALL foreign keys referencing the legacy `public.org`/`public.users`
--    tables (by any name), so the type change + drops below succeed regardless of
--    constraint naming. Soft actor refs (audit_log, project-config, tls) just lose
--    the FK.
--    IMPORTANT (idempotency): scope BOTH the FK-owning table and the referenced
--    table to the `public` schema. GoTrue later creates `auth.users` plus many
--    `auth.*` tables whose FKs reference a relation literally named `users`
--    (auth.identities, auth.sessions, auth.mfa_factors, …). Without the schema
--    filter, a re-run of this migration matches those GoTrue FKs and emits an
--    unqualified `ALTER TABLE identities …` that resolves to a non-existent
--    `public.identities` → crash. Post-cutover (public.users/org dropped) the
--    filtered loop matches nothing → clean no-op.
DO $$
DECLARE c record;
BEGIN
  FOR c IN
    SELECT tc.table_schema, tc.constraint_name, tc.table_name
    FROM information_schema.table_constraints tc
    JOIN information_schema.constraint_column_usage ccu
      ON tc.constraint_name = ccu.constraint_name AND tc.table_schema = ccu.table_schema
    WHERE tc.constraint_type = 'FOREIGN KEY'
      AND tc.table_schema = 'public'
      AND ccu.table_schema = 'public'
      AND ccu.table_name IN ('org', 'users')
  LOOP
    EXECUTE format('ALTER TABLE %I.%I DROP CONSTRAINT IF EXISTS %I', c.table_schema, c.table_name, c.constraint_name);
  END LOOP;
END $$;

-- 6. supabase_instances.org_id: uuid → text, repointed at organizations (RESTRICT).
DO $$
DECLARE legacy_id text;
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'supabase_instances' AND column_name = 'org_id' AND data_type = 'uuid'
  ) THEN
    ALTER TABLE supabase_instances ALTER COLUMN org_id TYPE text USING org_id::text;
  END IF;

  -- Greenfield-on-a-live-VM: any pre-existing projects reference the dropped
  -- `org` singleton. Move them to a fresh "Legacy" tenant org (proper 20-char
  -- lowercase ref) so the new FK is satisfiable. The first operator claims
  -- ownership of ownerless orgs at /setup. No-op on a truly empty install.
  IF EXISTS (SELECT 1 FROM supabase_instances)
     AND EXISTS (
       SELECT 1 FROM supabase_instances si
       WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = si.org_id)
     ) THEN
    legacy_id := (
      SELECT string_agg(substr('abcdefghijklmnopqrstuvwxyz', (random() * 25)::int + 1, 1), '')
      FROM generate_series(1, 20)
    );
    INSERT INTO organizations (id, name) VALUES (legacy_id, 'Legacy (pre-084)');
    UPDATE supabase_instances
    SET org_id = legacy_id
    WHERE NOT EXISTS (SELECT 1 FROM organizations o WHERE o.id = supabase_instances.org_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'supabase_instances_org_id_organizations_fk'
  ) THEN
    ALTER TABLE supabase_instances
      ADD CONSTRAINT supabase_instances_org_id_organizations_fk
      FOREIGN KEY (org_id) REFERENCES organizations(id) ON DELETE RESTRICT;
  END IF;
END $$;

-- 7. wildcard_certs / cert_renewal_events org_id: now vestigial → nullable, no FK.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'wildcard_certs' AND column_name = 'org_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE wildcard_certs ALTER COLUMN org_id DROP NOT NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'cert_renewal_events' AND column_name = 'org_id' AND is_nullable = 'NO'
  ) THEN
    ALTER TABLE cert_renewal_events ALTER COLUMN org_id DROP NOT NULL;
  END IF;
END $$;

-- 8. Greenfield cutover: drop the legacy tables (dependents already repointed).
--    Schema-qualified to `public` so a stray search_path containing `auth` can
--    never let `DROP TABLE … users` hit GoTrue's `auth.users` on a re-run.
DROP TABLE IF EXISTS public.org_members;
DROP TABLE IF EXISTS public.invites;
DROP TABLE IF EXISTS public.users;
DROP TABLE IF EXISTS public.org;
