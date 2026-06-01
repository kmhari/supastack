import { and, eq, isNull, lt, or } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared';
import { enqueueBackup } from './backup-enqueue.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Hourly tick. Find instances with `backup_auto_enabled = true` whose
 * `last_backup_at` is either NULL or older than 24h, and enqueue a backup.
 * Idempotent: if a backup is already in-flight for an instance, BullMQ may
 * pick up multiple but the second will just find no `provisioning` state and
 * proceed as normal — we don't gate further than that for v1.
 */
export async function handleBackupSchedulerTick(): Promise<void> {
  const cutoff = new Date(Date.now() - DAY_MS);
  const rows = await db()
    .select({ ref: schema.supabaseInstances.ref })
    .from(schema.supabaseInstances)
    .where(
      and(
        eq(schema.supabaseInstances.backupAutoEnabled, true),
        eq(schema.supabaseInstances.status, 'running'),
        or(
          isNull(schema.supabaseInstances.lastBackupAt),
          lt(schema.supabaseInstances.lastBackupAt, cutoff),
        ),
      ),
    );

  if (rows.length === 0) {
    logger.debug('backup-scheduler tick: nothing overdue');
    return;
  }

  logger.info({ count: rows.length }, 'backup-scheduler enqueueing overdue backups');
  for (const r of rows) {
    await enqueueBackup(r.ref, 'auto');
  }
}
