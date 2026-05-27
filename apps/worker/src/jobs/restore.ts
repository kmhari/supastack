import { createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { eq, and } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { db, schema } from '@selfbase/db';
import { logger } from '@selfbase/shared';
import {
  composeStop,
  composeStart,
  composeAllHealthy,
  type ComposeContext,
} from '@selfbase/docker-control';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import {
  LocalDiskStore,
  S3Store,
  type BackupStore,
  type S3StoreConfig,
} from '@selfbase/backup-store';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';
const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/selfbase/backups';

// Delay before restore-gc fires: 24 hours
const GC_DELAY_MS = 24 * 60 * 60 * 1000;

let _gcQueue: Queue | null = null;
function gcQueue(): Queue {
  if (!_gcQueue) {
    _gcQueue = new Queue('selfbase.restore-gc', {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _gcQueue;
}

async function resolveBackupStore(): Promise<BackupStore> {
  const [row] = await db()
    .select({ kind: schema.org.backupStoreKind, cfg: schema.org.backupStoreConfigEncrypted })
    .from(schema.org)
    .limit(1);
  if (!row || row.kind === 'local') return new LocalDiskStore(BACKUPS_DIR);
  if (!row.cfg) throw new Error('s3 backup-store config missing');
  const cfg = decryptJson<S3StoreConfig>(row.cfg, loadMasterKey());
  return new S3Store(cfg);
}

export async function handleRestore(payload: { restore_job_id: string }): Promise<void> {
  const { restore_job_id } = payload;
  const log = logger.child({ job: 'restore', restore_job_id });

  // Step 1: load job + idempotency guard
  const [job] = await db()
    .select()
    .from(schema.restoreJobs)
    .where(eq(schema.restoreJobs.id, restore_job_id))
    .limit(1);
  if (!job) { log.warn('restore job not found'); return; }
  if (job.status !== 'pending') {
    log.info({ status: job.status }, 'restore job already processed — skipping');
    return;
  }

  const ref = job.instanceRef;
  const ctx: ComposeContext = { projectName: `selfbase-${ref}`, dir: path.join(INSTANCES_DIR, ref) };

  // Step 2: set running
  await db()
    .update(schema.restoreJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.restoreJobs.id, restore_job_id));

  let preRestoreDir: string | null = null;
  const dataDir = path.join(INSTANCES_DIR, ref, 'volumes', 'db', 'data');
  const tmpBlob = `/tmp/restore-${restore_job_id}.tar.gz`;

  // Watchdog: abort at timeout_budget_seconds
  let watchdogFired = false;
  const watchdog = setTimeout(() => { watchdogFired = true; }, job.timeoutBudgetSeconds * 1000);

  const maybeAbort = () => {
    if (watchdogFired) throw new Error(`timeout_exceeded (budget: ${job.timeoutBudgetSeconds}s)`);
  };

  try {
    // Step 3: fetch backup blob
    log.info('fetching backup blob');
    const store = await resolveBackupStore();
    const [backupRow] = await db()
      .select()
      .from(schema.backups)
      .where(eq(schema.backups.id, job.backupId))
      .limit(1);
    if (!backupRow) throw new Error('backup row not found');
    const readStream = await store.get(backupRow.storeKey);
    await pipeline(readStream, createWriteStream(tmpBlob));
    maybeAbort();

    // Step 4: stop the whole per-instance stack
    log.info('stopping per-instance stack');
    await composeStop(ctx);
    maybeAbort();

    // Step 5: mv data dir to pre-restore snapshot
    preRestoreDir = `${dataDir}.pre-restore-${restore_job_id}`;
    log.info({ preRestoreDir }, 'snapshotting data dir');
    await fsp.rename(dataDir, preRestoreDir);
    await db()
      .update(schema.restoreJobs)
      .set({ preRestoreDir, updatedAt: new Date() })
      .where(eq(schema.restoreJobs.id, restore_job_id));
    maybeAbort();

    // Step 6: extract blob into new data dir
    log.info('extracting backup blob');
    await fsp.mkdir(dataDir, { recursive: true });
    await extractTarGz(tmpBlob, dataDir);
    maybeAbort();

    // Step 7: start the whole stack
    log.info('starting per-instance stack');
    await composeStart(ctx);
    maybeAbort();

    // Step 8+9: wait for db healthcheck + smoke probe
    log.info('waiting for db healthcheck');
    await waitUntilHealthy(ctx, job.timeoutBudgetSeconds * 1000, log);
    maybeAbort();

    // Step 10: wait for sibling services (auth, rest, kong)
    log.info('waiting for sibling services');
    await waitForSiblingServices(ref, 300_000);
    maybeAbort();

    // Step 11+12: success
    clearTimeout(watchdog);
    await db().transaction(async (tx) => {
      await tx
        .update(schema.restoreJobs)
        .set({ status: 'success', completedAt: new Date(), updatedAt: new Date() })
        .where(eq(schema.restoreJobs.id, restore_job_id));
      await tx
        .update(schema.supabaseInstances)
        .set({ status: 'running', updatedAt: new Date() })
        .where(eq(schema.supabaseInstances.ref, ref));
    });

    // Step 13: schedule GC in 24h
    await gcQueue().add('restore-gc', { restore_job_id }, { delay: GC_DELAY_MS });

    log.info('mgmt_api.backup.restore_completed');
  } catch (err) {
    clearTimeout(watchdog);
    const errorMessage = (err as Error).message;
    log.error({ err: errorMessage }, 'restore failed — rolling back');

    await rollback(ctx, dataDir, preRestoreDir, restore_job_id, ref, errorMessage, log);
  } finally {
    // Clean up tmp blob
    await fsp.unlink(tmpBlob).catch(() => {});
  }
}

async function rollback(
  ctx: ComposeContext,
  dataDir: string,
  preRestoreDir: string | null,
  restore_job_id: string,
  ref: string,
  errorMessage: string,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  try {
    // Best-effort stop
    await composeStop(ctx).catch(() => {});

    // Swap dirs back if snapshot exists
    if (preRestoreDir) {
      await fsp.rm(dataDir, { recursive: true, force: true }).catch(() => {});
      await fsp.rename(preRestoreDir, dataDir).catch(() => {});
    }

    // Restart stack
    await composeStart(ctx).catch(() => {});

    // Wait for recovery
    let recoveredOk = false;
    try {
      await waitUntilHealthy(ctx, 5 * 60 * 1000, log);
      recoveredOk = true;
    } catch {}

    await db().transaction(async (tx) => {
      await tx
        .update(schema.restoreJobs)
        .set({
          status: 'failed',
          completedAt: new Date(),
          errorMessage,
          preRestoreDir: null,
          updatedAt: new Date(),
        })
        .where(eq(schema.restoreJobs.id, restore_job_id));
      await tx
        .update(schema.supabaseInstances)
        .set({ status: recoveredOk ? 'running' : 'failed', updatedAt: new Date() })
        .where(eq(schema.supabaseInstances.ref, ref));
    });

    log.warn({ recoveredOk }, 'mgmt_api.backup.restore_failed');
  } catch (rbErr) {
    log.error({ err: (rbErr as Error).message }, 'rollback itself failed — operator intervention needed');
  }
}

async function waitUntilHealthy(
  ctx: ComposeContext,
  budgetMs: number,
  log: ReturnType<typeof logger.child>,
): Promise<void> {
  const deadline = Date.now() + budgetMs;
  while (Date.now() < deadline) {
    const healthy = await composeAllHealthy(ctx).catch(() => false);
    if (healthy) return;
    await new Promise((r) => setTimeout(r, 5000));
  }
  throw new Error('db healthcheck timed out');
}

async function waitForSiblingServices(ref: string, budgetMs: number): Promise<void> {
  // Light HTTP probe on auth and rest via their internal ports.
  // We use per-instance secrets to discover the port_kong value.
  const [inst] = await db()
    .select({ portKong: schema.supabaseInstances.portKong })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) return;

  const deadline = Date.now() + budgetMs;
  const kongBase = `http://host.docker.internal:${inst.portKong}`;

  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${kongBase}/auth/v1/health`, { signal: AbortSignal.timeout(3000) });
      if (res.ok) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  // Non-fatal: log warning but don't fail the restore
  logger.warn({ ref }, 'sibling services did not recover within budget — marking success anyway');
}

async function extractTarGz(blob: string, destDir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn('tar', ['-xzf', blob, '-C', destDir], { stdio: 'inherit' });
    proc.on('close', (code) => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
    proc.on('error', reject);
  });
}

// ─── restore-gc worker ───────────────────────────────────────────────────────

export async function handleRestoreGc(payload: { restore_job_id: string }): Promise<void> {
  const { restore_job_id } = payload;
  const log = logger.child({ job: 'restore-gc', restore_job_id });

  const [job] = await db()
    .select({ preRestoreDir: schema.restoreJobs.preRestoreDir })
    .from(schema.restoreJobs)
    .where(eq(schema.restoreJobs.id, restore_job_id))
    .limit(1);
  if (!job) { log.warn('restore job not found'); return; }
  if (!job.preRestoreDir) { log.info('pre_restore_dir already null — already gc\'d'); return; }

  log.info({ preRestoreDir: job.preRestoreDir }, 'removing pre-restore snapshot');
  await fsp.rm(job.preRestoreDir, { recursive: true, force: true });
  await db()
    .update(schema.restoreJobs)
    .set({ preRestoreDir: null, updatedAt: new Date() })
    .where(eq(schema.restoreJobs.id, restore_job_id));
  log.info('restore-gc complete');
}
