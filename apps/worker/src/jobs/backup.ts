import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';
import { eq, desc, and } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import { logger } from '@supastack/shared';
import {
  LocalDiskStore,
  S3Store,
  type BackupStore,
  type S3StoreConfig,
} from '@supastack/backup-store';

const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/supastack/backups';

/**
 * On-demand or scheduled backup job. Pipeline:
 *   1. Insert backups row with status='running'
 *   2. Resolve BackupStore from org.backup_store_kind + decrypted config
 *   3. docker exec supastack-<ref>-db pg_dump -U postgres -Fc postgres
 *   4. Stream stdout into BackupStore.put(ref, stream)
 *   5. On success: update row → completed + size, run retention sweep
 *   6. On failure: update row → failed + error
 */
export async function handleBackup(payload: {
  ref: string;
  kind: 'manual' | 'auto';
}): Promise<void> {
  const { ref, kind } = payload;
  const log = logger.child({ job: 'backup', ref, kind });

  const [inst] = await db()
    .select()
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) {
    log.warn('instance row not found');
    return;
  }

  const store = await resolveBackupStore();
  const storeKind = (await getStoreKind()) ?? 'local';

  // Insert running row
  const [created] = await db()
    .insert(schema.backups)
    .values({
      instanceRef: ref,
      kind,
      status: 'running',
      storeKind,
      storeKey: '', // updated on success
    })
    .returning({ id: schema.backups.id });
  const backupId = created!.id;

  try {
    log.info('starting pg_dump');
    const stream = pgDumpStream(`supastack-${ref}-db`);
    const put = await store.put(ref, stream);
    await db()
      .update(schema.backups)
      .set({
        status: 'completed',
        storeKey: put.key,
        sizeBytes: put.size,
        completedAt: new Date(),
      })
      .where(eq(schema.backups.id, backupId));
    await db()
      .update(schema.supabaseInstances)
      .set({ lastBackupAt: new Date(), updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));
    log.info({ key: put.key, sizeMb: Math.round(put.size / 1024 / 1024) }, 'backup completed');

    // Retention sweep — keep the most recent N successful backups.
    await retentionSweep(ref, inst.backupRetain, store);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'backup failed');
    await db()
      .update(schema.backups)
      .set({ status: 'failed', error: message, completedAt: new Date() })
      .where(eq(schema.backups.id, backupId));
    throw err;
  }
}

// ─── helpers ────────────────────────────────────────────────────────────────

function pgDumpStream(containerName: string): Readable {
  // docker exec <db> pg_dump -U postgres -Fc postgres
  const child = spawn(
    'docker',
    ['exec', containerName, 'pg_dump', '-U', 'postgres', '-Fc', 'postgres'],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );
  // Forward stderr to logger; otherwise it accumulates silently.
  child.stderr.on('data', (b: Buffer) => {
    logger.warn({ pgDumpStderr: b.toString().trim() }, 'pg_dump stderr');
  });
  child.on('error', (err) => {
    (child.stdout as Readable).destroy(err);
  });
  return child.stdout as Readable;
}

async function getStoreKind(): Promise<'local' | 's3'> {
  const [row] = await db()
    .select({ kind: schema.installation.backupStoreKind })
    .from(schema.installation)
    .limit(1);
  return (row?.kind as 'local' | 's3') ?? 'local';
}

/** Resolve the configured BackupStore for the (singleton) org. */
export async function resolveBackupStore(): Promise<BackupStore> {
  const [row] = await db()
    .select({
      kind: schema.installation.backupStoreKind,
      configEncrypted: schema.installation.backupStoreConfigEncrypted,
    })
    .from(schema.installation)
    .limit(1);
  if (!row || row.kind === 'local') {
    return new LocalDiskStore(BACKUPS_DIR);
  }
  // s3
  if (!row.configEncrypted) {
    throw new Error('org.backup_store_kind=s3 but config is missing');
  }
  const cfg = decryptJson<S3StoreConfig>(row.configEncrypted, loadMasterKey());
  return new S3Store(cfg);
}

/** Keep most recent N successful backups; delete older from store + table. */
async function retentionSweep(ref: string, retain: number, store: BackupStore): Promise<void> {
  const rows = await db()
    .select({
      id: schema.backups.id,
      storeKey: schema.backups.storeKey,
    })
    .from(schema.backups)
    .where(and(eq(schema.backups.instanceRef, ref), eq(schema.backups.status, 'completed')))
    .orderBy(desc(schema.backups.startedAt));

  const toDelete = rows.slice(retain);
  for (const r of toDelete) {
    try {
      await store.delete(r.storeKey);
    } catch (err) {
      logger.warn({ err: (err as Error).message, key: r.storeKey }, 'failed to delete backup blob');
    }
    await db().delete(schema.backups).where(eq(schema.backups.id, r.id));
  }
  if (toDelete.length > 0) {
    logger.info({ ref, deleted: toDelete.length, retained: retain }, 'retention sweep complete');
  }
}
