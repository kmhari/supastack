import { pgTable, uuid, text, timestamp, bigint, index } from 'drizzle-orm/pg-core';
import { supabaseInstances } from './instances.js';

export const backups = pgTable(
  'backups',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    kind: text('kind', { enum: ['manual', 'auto'] }).notNull(),
    status: text('status', { enum: ['running', 'completed', 'failed'] }).notNull(),
    storeKind: text('store_kind', { enum: ['local', 's3'] }).notNull(),
    storeKey: text('store_key').notNull(),
    sizeBytes: bigint('size_bytes', { mode: 'number' }),
    error: text('error'),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
  },
  (t) => [index('backups_instance_started').on(t.instanceRef, t.startedAt)],
);
