import { sql } from 'drizzle-orm';
import {
  pgTable,
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

// ─── org (singleton) ────────────────────────────────────────────────────────
export const org = pgTable(
  'org',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    name: text('name').notNull(),
    apexDomain: text('apex_domain').unique(),
    backupStoreKind: text('backup_store_kind', { enum: ['local', 's3'] })
      .notNull()
      .default('local'),
    backupStoreConfigEncrypted: bytea('backup_store_config_encrypted'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  // Singleton constraint via partial unique index over constant 1 (see data-model.md §I1 fix)
  () => ({}),
);

// ─── users ──────────────────────────────────────────────────────────────────
export const users = pgTable('users', {
  id: uuid('id').defaultRandom().primaryKey(),
  email: citext('email').notNull().unique(),
  hashedPassword: text('hashed_password').notNull(),
  createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
});

// ─── org_members ────────────────────────────────────────────────────────────
export const orgMembers = pgTable(
  'org_members',
  {
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    userId: uuid('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.orgId, t.userId] }) }),
);

// ─── invites ────────────────────────────────────────────────────────────────
export const invites = pgTable(
  'invites',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    email: citext('email').notNull(),
    tokenSha256: bytea('token_sha256').notNull().unique(),
    role: text('role', { enum: ['admin', 'member'] }).notNull(),
    invitedByUserId: uuid('invited_by_user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    consumedAt: timestamp('consumed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    emailOpen: uniqueIndex('invites_email_open')
      .on(t.email)
      .where(sql`${t.consumedAt} IS NULL`),
  }),
);

// ─── api_tokens ─────────────────────────────────────────────────────────────
//
// `prefix` (added in migration 0002_cli_compat.sql) stores the first 12
// characters of the plaintext token (`sbp_<8-hex>` for new sbp_-format
// tokens). Used by the dashboard to display a stable, non-reversible
// label per token in the list view. Nullable for legacy tokens minted
// before the prefix column existed.
export const apiTokens = pgTable('api_tokens', {
  id: uuid('id').defaultRandom().primaryKey(),
  userId: uuid('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  tokenSha256: bytea('token_sha256').notNull().unique(),
  label: text('label').notNull(),
  prefix: text('prefix'),
  // Feature 011 — 'manual' for tokens minted via the settings page;
  // 'cli' for tokens minted via the CLI device-code login flow. Default
  // 'manual' so existing callers + rows are unaffected.
  source: text('source', { enum: ['manual', 'cli'] })
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
