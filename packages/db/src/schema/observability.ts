import { pgTable, bigint, text, timestamp, numeric, jsonb, index } from 'drizzle-orm/pg-core';

/**
 * Feature 116 — admin ops console observability tables. Written by the worker
 * `observer` job; read (only) by the api admin endpoints. See migration 0023.
 */

export const resourceSamples = pgTable(
  'resource_samples',
  {
    id: bigint('id', { mode: 'number' }).primaryKey().generatedByDefaultAsIdentity(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
    /** 'host' | 'project' */
    scope: text('scope').notNull(),
    /** project ref when scope='project'; null for host. */
    ref: text('ref'),
    cpuPct: numeric('cpu_pct'),
    memUsedBytes: bigint('mem_used_bytes', { mode: 'number' }),
    memLimitBytes: bigint('mem_limit_bytes', { mode: 'number' }),
    diskUsedBytes: bigint('disk_used_bytes', { mode: 'number' }),
    /** host-only: { project_data, backups, other, free } */
    diskBreakdown: jsonb('disk_breakdown'),
  },
  (t) => ({
    scopeRefTime: index('idx_resource_samples_scope_ref_time').on(t.scope, t.ref, t.capturedAt),
    capturedAt: index('idx_resource_samples_captured_at').on(t.capturedAt),
  }),
);

export const controlPlaneSnapshots = pgTable('control_plane_snapshots', {
  container: text('container').primaryKey(),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().defaultNow(),
  health: text('health'),
  status: text('status'),
  image: text('image'),
  logTail: text('log_tail'),
});
