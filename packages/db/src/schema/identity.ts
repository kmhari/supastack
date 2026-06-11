import { sql } from 'drizzle-orm';
import {
  pgTable,
  pgSchema,
  uuid,
  text,
  timestamp,
  customType,
  integer,
  primaryKey,
  check,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

const citext = customType<{ data: string }>({
  dataType: () => 'citext',
});
const bytea = customType<{ data: Buffer }>({
  dataType: () => 'bytea',
});

// ─── auth.users (GoTrue-owned, feature 084) ─────────────────────────────────
// GoTrue owns the `auth` schema in the control DB. We only READ a thin
// projection (id + email) to resolve operator identity for PAT/OAuth/session.
// Never written to by Drizzle — GoTrue manages it.
const authSchema = pgSchema('auth');
export const authUsers = authSchema.table('users', {
  id: uuid('id').primaryKey(),
  email: citext('email').notNull(),
});

// `users` is the operator-identity table. Post-084 it lives in GoTrue's
// `auth.users`; this alias keeps actor/created-by references (audit, cli-compat,
// project-config, reconciler-runs, tls) + identity joins pointing at the right
// place. Note: only `id` + `email` are projected (GoTrue owns the rest). The
// physical FKs live in the hand-written .sql migrations, not here.
export const users = authUsers;

// ─── installation (singleton — platform/installation settings) ──────────────
// Feature 084 — split out of the old `org` singleton. Holds the backup
// destination + SMTP. Exactly one row (id = 1), never a tenant. The apex domain
// is NOT stored here — it is the single source `SUPASTACK_APEX` env (feature 117;
// migration 0024 dropped the old column).
export const installation = pgTable(
  'installation',
  {
    id: integer('id').primaryKey().default(1),
    backupStoreKind: text('backup_store_kind', { enum: ['local', 's3'] })
      .notNull()
      .default('local'),
    backupStoreConfigEncrypted: bytea('backup_store_config_encrypted'),
    // Feature 084 US6 — operator SMTP credentials (envelope-encrypted). Null until configured.
    smtpConfigEncrypted: bytea('smtp_config_encrypted'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ singleton: check('installation_singleton', sql`${t.id} = 1`) }),
);

// ─── organizations (tenant, multi-row) ──────────────────────────────────────
// Feature 084 — `id` is a 20-char ref (generateRef), used as both the API id
// and the URL/path slug. NOT a UUID. `name` is the editable display label.
export const organizations = pgTable('organizations', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

export const ORG_ROLES = ['owner', 'administrator', 'developer', 'read_only'] as const;

// ─── organization_members ───────────────────────────────────────────────────
export const organizationMembers = pgTable(
  'organization_members',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    // References auth.users(id) — soft FK (GoTrue owns that table); not declared
    // as a Drizzle .references() to avoid a cross-schema migration ordering dep.
    userId: uuid('user_id').notNull(),
    role: text('role', { enum: ORG_ROLES }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.organizationId, t.userId] }) }),
);

// ─── organization_invitations ───────────────────────────────────────────────
export const organizationInvitations = pgTable(
  'organization_invitations',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organizations.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    tokenSha256: bytea('token_sha256').notNull().unique(),
    role: text('role', { enum: ORG_ROLES }).notNull(),
    invitedByUserId: uuid('invited_by_user_id').notNull(),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailOpen: uniqueIndex('organization_invitations_email_open')
      .on(t.organizationId, t.email)
      .where(sql`${t.consumedAt} IS NULL`),
  }),
);

// ─── api_tokens ─────────────────────────────────────────────────────────────
// Feature 084 — `user_id` now references auth.users(id) (soft FK). Format +
// behavior unchanged (sbp_<40hex>, sha256-hashed).
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id').notNull(),
  tokenSha256: bytea('token_sha256').notNull().unique(),
  label: text('label').notNull(),
  prefix: text('prefix'),
  source: text('source', { enum: ['manual', 'cli', 'studio'] })
    .notNull()
    .default('manual'),
  lastUsedAt: timestamp('last_used_at', { withTimezone: true }),
  revokedAt: timestamp('revoked_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── setup_state (singleton) ────────────────────────────────────────────────
export const setupState = pgTable(
  'setup_state',
  {
    id: integer('id').primaryKey().default(1),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => ({ singleton: check('setup_state_singleton', sql`${t.id} = 1`) }),
);
