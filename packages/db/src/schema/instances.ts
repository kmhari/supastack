import { sql } from 'drizzle-orm';
import {
  pgTable,
  uuid,
  text,
  timestamp,
  integer,
  boolean,
  customType,
  check,
} from 'drizzle-orm/pg-core';
import { org } from './identity.js';

const bytea = customType<{ data: Buffer }>({ dataType: () => 'bytea' });

// ─── supabase_instances ─────────────────────────────────────────────────────
export const supabaseInstances = pgTable(
  'supabase_instances',
  {
    ref: text('ref').primaryKey(),
    orgId: uuid('org_id')
      .notNull()
      .references(() => org.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    status: text('status', {
      enum: ['provisioning', 'running', 'paused', 'stopped', 'failed', 'deleting'],
    }).notNull(),
    supabaseVersion: text('supabase_version').notNull(),
    encryptedSecrets: bytea('encrypted_secrets').notNull(),
    portKong: integer('port_kong').notNull().unique(),
    portStudio: integer('port_studio').notNull().unique(),
    portPostgres: integer('port_postgres').notNull().unique(),
    portPooler: integer('port_pooler').notNull().unique(),
    portAnalytics: integer('port_analytics').notNull().unique(),
    // Host port where the per-instance db:5432 is published, used by the
    // top-level pg-edge proxy. Nullable for pre-feature-005 instances.
    portDbDirect: integer('port_db_direct').unique(),
    createSmtpHost: text('create_smtp_host'),
    createSmtpPort: integer('create_smtp_port'),
    createSmtpUser: text('create_smtp_user'),
    createSmtpPassEncrypted: bytea('create_smtp_pass_encrypted'),
    createEnableSignup: boolean('create_enable_signup').notNull().default(true),
    createJwtExpirySec: integer('create_jwt_expiry_sec').notNull().default(3600),
    backupAutoEnabled: boolean('backup_auto_enabled').notNull().default(true),
    backupRetain: integer('backup_retain').notNull().default(7),
    lastBackupAt: timestamp('last_backup_at', { withTimezone: true }),
    provisionError: text('provision_error'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({ retainPositive: check('backup_retain_positive', sql`${t.backupRetain} >= 1`) }),
);

// ─── port_allocations ───────────────────────────────────────────────────────
export const portAllocations = pgTable('port_allocations', {
  port: integer('port').primaryKey(),
  kind: text('kind', {
    enum: ['kong', 'studio', 'postgres', 'pooler', 'analytics', 'dbDirect'],
  }).notNull(),
  instanceRef: text('instance_ref').references(() => supabaseInstances.ref, {
    onDelete: 'set null',
  }),
});
