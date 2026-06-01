-- Supastack v1 initial schema. Idempotent — safe to run any number of times.
-- citext + pgcrypto are installed by migrate.ts before this runs.
-- The org_singleton partial unique index is added by migrate.ts after this runs.

CREATE TABLE IF NOT EXISTS "org" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "name" text NOT NULL,
  "apex_domain" text UNIQUE,
  "backup_store_kind" text NOT NULL DEFAULT 'local' CHECK ("backup_store_kind" IN ('local','s3')),
  "backup_store_config_encrypted" bytea,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "email" citext NOT NULL UNIQUE,
  "hashed_password" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "org_members" (
  "org_id" uuid NOT NULL REFERENCES "org"("id") ON DELETE CASCADE,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "role" text NOT NULL CHECK ("role" IN ('admin','member')),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("org_id", "user_id")
);

CREATE TABLE IF NOT EXISTS "invites" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "org_id" uuid NOT NULL REFERENCES "org"("id") ON DELETE CASCADE,
  "email" citext NOT NULL,
  "token_sha256" bytea NOT NULL UNIQUE,
  "role" text NOT NULL CHECK ("role" IN ('admin','member')),
  "invited_by_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "expires_at" timestamptz NOT NULL,
  "consumed_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "invites_email_open"
  ON "invites" ("email") WHERE "consumed_at" IS NULL;

CREATE TABLE IF NOT EXISTS "api_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token_sha256" bytea NOT NULL UNIQUE,
  "label" text NOT NULL,
  "last_used_at" timestamptz,
  "revoked_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "setup_state" (
  "id" int PRIMARY KEY DEFAULT 1 CHECK ("id" = 1),
  "completed_at" timestamptz
);

CREATE TABLE IF NOT EXISTS "supabase_instances" (
  "ref" text PRIMARY KEY,
  "org_id" uuid NOT NULL REFERENCES "org"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "status" text NOT NULL CHECK ("status" IN ('provisioning','running','paused','stopped','failed','deleting')),
  "supabase_version" text NOT NULL,
  "encrypted_secrets" bytea NOT NULL,
  "port_kong" int NOT NULL UNIQUE,
  "port_studio" int NOT NULL UNIQUE,
  "port_postgres" int NOT NULL UNIQUE,
  "port_pooler" int NOT NULL UNIQUE,
  "port_analytics" int NOT NULL UNIQUE,
  "create_smtp_host" text,
  "create_smtp_port" int,
  "create_smtp_user" text,
  "create_smtp_pass_encrypted" bytea,
  "create_enable_signup" boolean NOT NULL DEFAULT true,
  "create_jwt_expiry_sec" int NOT NULL DEFAULT 3600,
  "backup_auto_enabled" boolean NOT NULL DEFAULT true,
  "backup_retain" int NOT NULL DEFAULT 7 CHECK ("backup_retain" >= 1),
  "last_backup_at" timestamptz,
  "provision_error" text,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "port_allocations" (
  "port" int PRIMARY KEY,
  "kind" text NOT NULL CHECK ("kind" IN ('kong','studio','postgres','pooler','analytics')),
  "instance_ref" text REFERENCES "supabase_instances"("ref") ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS "backups" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "instance_ref" text NOT NULL REFERENCES "supabase_instances"("ref") ON DELETE CASCADE,
  "kind" text NOT NULL CHECK ("kind" IN ('manual','auto')),
  "status" text NOT NULL CHECK ("status" IN ('running','completed','failed')),
  "store_kind" text NOT NULL CHECK ("store_kind" IN ('local','s3')),
  "store_key" text NOT NULL,
  "size_bytes" bigint,
  "error" text,
  "started_at" timestamptz NOT NULL DEFAULT now(),
  "completed_at" timestamptz
);
CREATE INDEX IF NOT EXISTS "backups_instance_started"
  ON "backups" ("instance_ref", "started_at");

CREATE TABLE IF NOT EXISTS "audit_log" (
  "id" bigserial PRIMARY KEY,
  "actor_user_id" uuid REFERENCES "users"("id") ON DELETE SET NULL,
  "action" text NOT NULL,
  "target_kind" text,
  "target_id" text,
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
