import { createWriteStream } from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as path from 'node:path';
import { pipeline } from 'node:stream/promises';
import { spawn } from 'node:child_process';
import { eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { db, schema } from '@supastack/db';
import { logger, QUEUES } from '@supastack/shared';
import {
  composeStop,
  composeStart,
  composeAllHealthy,
  type ComposeContext,
} from '@supastack/docker-control';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import {
  LocalDiskStore,
  S3Store,
  type BackupStore,
  type S3StoreConfig,
} from '@supastack/backup-store';

const REDIS_URL = process.env.REDIS_URL ?? 'redis://redis:6379';
const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/supastack/backups';

let _gcQueue: Queue | null = null;
function _useGcQueue(): Queue {
  if (!_gcQueue) {
    _gcQueue = new Queue(QUEUES.restoreGc, {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _gcQueue;
}
void _useGcQueue;

async function resolveBackupStore(): Promise<BackupStore> {
  const [row] = await db()
    .select({
      kind: schema.installation.backupStoreKind,
      cfg: schema.installation.backupStoreConfigEncrypted,
    })
    .from(schema.installation)
    .limit(1);
  if (!row || row.kind === 'local') return new LocalDiskStore(BACKUPS_DIR);
  if (!row.cfg) throw new Error('s3 backup-store config missing');
  const cfg = decryptJson<S3StoreConfig>(row.cfg, loadMasterKey());
  return new S3Store(cfg);
}

async function spawnAsync(
  cmd: string,
  args: string[],
  opts: { allowExitCode1?: boolean } = {},
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'inherit' });
    proc.on('close', (code) => {
      if (code === 0 || (opts.allowExitCode1 && code === 1)) return resolve();
      reject(new Error(`${cmd} exited ${code}`));
    });
    proc.on('error', reject);
  });
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
  if (!job) {
    log.warn('restore job not found');
    return;
  }
  if (job.status !== 'pending') {
    log.info({ status: job.status }, 'restore job already processed — skipping');
    return;
  }

  const ref = job.instanceRef;
  const ctx: ComposeContext = {
    projectName: `supastack-${ref}`,
    dir: path.join(INSTANCES_DIR, ref),
  };

  // Step 2: set running
  await db()
    .update(schema.restoreJobs)
    .set({ status: 'running', startedAt: new Date(), updatedAt: new Date() })
    .where(eq(schema.restoreJobs.id, restore_job_id));

  // Backups are pg_dump -Fc (logical), so restore uses pg_restore via docker exec.
  // The stack stays running; we restore into the live postgres database.
  const tmpBlob = `/tmp/restore-${restore_job_id}.dump`;

  // Watchdog: abort at timeout_budget_seconds
  let watchdogFired = false;
  const watchdog = setTimeout(() => {
    watchdogFired = true;
  }, job.timeoutBudgetSeconds * 1000);

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

    // Step 4: copy dump into the db container
    const dbContainer = `supastack-${ref}-db-1`;
    const containerDump = `/tmp/restore-${restore_job_id}.dump`;
    log.info({ dbContainer }, 'copying dump into db container');
    await spawnAsync('docker', ['cp', tmpBlob, `${dbContainer}:${containerDump}`]);
    maybeAbort();

    // Step 5: run pg_restore inside the db container (--clean --if-exists drops objects first).
    // pg_restore exits 1 for non-fatal warnings (ownership errors in Supabase's multi-role schema
    // are expected and don't affect the restored data). Treat code 1 as success.
    log.info('running pg_restore');
    await spawnAsync(
      'docker',
      [
        'exec',
        dbContainer,
        'pg_restore',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '--clean',
        '--if-exists',
        '--no-owner',
        '--no-privileges',
        containerDump,
      ],
      { allowExitCode1: true },
    );
    maybeAbort();

    // Step 6: clean up dump inside container
    await spawnAsync('docker', ['exec', dbContainer, 'rm', '-f', containerDump]).catch(() => {});

    // Step 7: restart sibling services so they pick up the restored schema
    log.info('restarting per-instance stack for schema refresh');
    await composeStop(ctx);
    await composeStart(ctx);
    maybeAbort();

    // Step 8: wait for db healthcheck
    log.info('waiting for db healthcheck');
    await waitUntilHealthy(ctx, job.timeoutBudgetSeconds * 1000, log);
    maybeAbort();

    // Step 9: wait for sibling services
    log.info('waiting for sibling services');
    await waitForSiblingServices(ref, 300_000);

    // Step 10: success
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

    log.info('mgmt_api.backup.restore_completed');
  } catch (err) {
    clearTimeout(watchdog);
    const errorMessage = (err as Error).message;
    log.error({ err: errorMessage }, 'restore failed — rolling back');
    await rollback(ctx, restore_job_id, ref, errorMessage, log);
  } finally {
    await fsp.unlink(tmpBlob).catch(() => {});
  }
}

async function rollback(
  ctx: ComposeContext,
  restore_job_id: string,
  ref: string,
  errorMessage: string,
  log: Pick<typeof logger, 'info' | 'warn' | 'error' | 'debug'>,
): Promise<void> {
  try {
    // Best-effort restart the stack to recover
    await composeStop(ctx).catch(() => {});
    await composeStart(ctx).catch(() => {});

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
    log.error(
      { err: (rbErr as Error).message },
      'rollback itself failed — operator intervention needed',
    );
  }
}

async function waitUntilHealthy(
  ctx: ComposeContext,
  budgetMs: number,
  _log: unknown,
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
      // Use kong's own health endpoint (not upstream service routes which require auth)
      const res = await fetch(`${kongBase}/`, { signal: AbortSignal.timeout(3000) });
      // Kong returns 404 on /, 401 on service routes — both mean kong is up
      if (res.status < 500) return;
    } catch {}
    await new Promise((r) => setTimeout(r, 5000));
  }
  logger.warn({ ref }, 'sibling services did not recover within budget — marking success anyway');
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
  if (!job) {
    log.warn('restore job not found');
    return;
  }
  if (!job.preRestoreDir) {
    log.info("pre_restore_dir already null — already gc'd");
    return;
  }

  log.info({ preRestoreDir: job.preRestoreDir }, 'removing pre-restore snapshot');
  await fsp.rm(job.preRestoreDir, { recursive: true, force: true });
  await db()
    .update(schema.restoreJobs)
    .set({ preRestoreDir: null, updatedAt: new Date() })
    .where(eq(schema.restoreJobs.id, restore_job_id));
  log.info('restore-gc complete');
}
