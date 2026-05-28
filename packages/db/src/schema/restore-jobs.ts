import { pgTable, uuid, text, timestamp, integer, index } from 'drizzle-orm/pg-core';
import { supabaseInstances } from './instances.js';
import { backups } from './backups.js';

export const restoreJobs = pgTable(
  'restore_jobs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    instanceRef: text('instance_ref')
      .notNull()
      .references(() => supabaseInstances.ref, { onDelete: 'cascade' }),
    backupId: uuid('backup_id')
      .notNull()
      .references(() => backups.id),
    status: text('status', { enum: ['pending', 'running', 'success', 'failed'] })
      .notNull()
      .default('pending'),
    startedAt: timestamp('started_at', { withTimezone: true }),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    errorMessage: text('error_message'),
    timeoutBudgetSeconds: integer('timeout_budget_seconds').notNull(),
    preRestoreDir: text('pre_restore_dir'),
    createdAt: timestamp('created_at', { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    instanceCreatedIdx: index('restore_jobs_instance_created').on(t.instanceRef, t.createdAt),
  }),
);
