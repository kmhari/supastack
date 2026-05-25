import {
  pgTable,
  uuid,
  text,
  integer,
  jsonb,
  timestamp,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import { users } from './identity.js';

/**
 * Feature 008 US1 — tracks the lifecycle of each pooler-reconciler run.
 * Partial unique index `uq_reconciler_runs_one_running` enforces at most
 * one in-flight run.
 */
export const reconcilerRuns = pgTable(
  'reconciler_runs',
  {
    id: uuid('id').defaultRandom().primaryKey(),
    startedAt: timestamp('started_at', { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    status: text('status').notNull().default('running'),
    instancesSeen: integer('instances_seen').notNull().default(0),
    actionsTaken: jsonb('actions_taken')
      .notNull()
      .default(sql`'{}'::jsonb`),
    errorMessage: text('error_message'),
    triggerSource: text('trigger_source').notNull().default('cron'),
    actorId: uuid('actor_id').references(() => users.id, { onDelete: 'set null' }),
  },
  (t) => ({
    startedAtIdx: index('idx_reconciler_runs_started_at').on(t.startedAt),
  }),
);

export type ReconcilerRunStatus = 'running' | 'success' | 'partial_failure' | 'failed';

export type ReconcilerActionsTaken = {
  registered_missing?: number;
  retried_success?: number;
  retried_failed?: number;
  unregistered_deleting?: number;
  unregistered_orphan?: number;
  password_drift_detected?: number;
};
