import { Queue, Worker, type QueueOptions, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@supastack/shared';
import { handleCaddyReload } from './jobs/caddy-reload.js';
import { handleProvision } from './jobs/provision.js';
import { handleLifecycle } from './jobs/lifecycle.js';
import { handleBackup } from './jobs/backup.js';
import { handleBackupSchedulerTick } from './jobs/backup-scheduler.js';
import { handleHealthReconciler } from './jobs/health-reconciler.js';
import { handlePgEdgeCertIssue } from './jobs/pg-edge-cert-issue.js';
import { handlePoolerReconciler, type PoolerReconcilerJob } from './jobs/pooler-reconciler.js';
import { handleVaultEnable, type VaultEnableJobData } from './jobs/vault-enable-job.js';
import { handleCleanupOauthCodes } from './jobs/cleanup-oauth-codes.js';
import { handleCleanupOauthRefresh } from './jobs/cleanup-oauth-refresh.js';
import { handleRestore, handleRestoreGc } from './jobs/restore.js';

const REDIS_URL = process.env.REDIS_URL!;

function ioredisConnection(): Redis {
  return new Redis(REDIS_URL, { maxRetriesPerRequest: null });
}

function queueOpts(): QueueOptions {
  return { connection: ioredisConnection() };
}
function workerOpts(): WorkerOptions {
  return { connection: ioredisConnection(), concurrency: 1 };
}

/** All BullMQ queue names. */
export const QUEUES = {
  provision: 'supastack.provision',
  lifecycle: 'supastack.lifecycle',
  backup: 'supastack.backup',
  backupScheduler: 'supastack.backup-scheduler',
  caddyReload: 'supastack.caddy-reload',
  healthReconciler: 'supastack.health-reconciler',
  pgEdgeCertIssue: 'supastack.pg-edge-cert-issue',
  poolerReconciler: 'supastack.pooler-reconciler',
  vaultEnable: 'supastack.vault-enable',
  cleanupOauthCodes: 'supastack.cleanup-oauth-codes',
  cleanupOauthRefresh: 'supastack.cleanup-oauth-refresh',
  restore: 'supastack.restore',
  restoreGc: 'supastack.restore-gc',
} as const;

export interface Queues {
  provision: Queue;
  lifecycle: Queue;
  backup: Queue;
  backupScheduler: Queue;
  caddyReload: Queue;
  healthReconciler: Queue;
  pgEdgeCertIssue: Queue;
  poolerReconciler: Queue;
  vaultEnable: Queue;
  cleanupOauthCodes: Queue;
  cleanupOauthRefresh: Queue;
  restore: Queue;
  restoreGc: Queue;
}

export function connectQueues(): Queues {
  return {
    provision: new Queue(QUEUES.provision, queueOpts()),
    lifecycle: new Queue(QUEUES.lifecycle, queueOpts()),
    backup: new Queue(QUEUES.backup, queueOpts()),
    backupScheduler: new Queue(QUEUES.backupScheduler, queueOpts()),
    caddyReload: new Queue(QUEUES.caddyReload, queueOpts()),
    healthReconciler: new Queue(QUEUES.healthReconciler, queueOpts()),
    pgEdgeCertIssue: new Queue(QUEUES.pgEdgeCertIssue, queueOpts()),
    poolerReconciler: new Queue(QUEUES.poolerReconciler, queueOpts()),
    vaultEnable: new Queue(QUEUES.vaultEnable, queueOpts()),
    cleanupOauthCodes: new Queue(QUEUES.cleanupOauthCodes, queueOpts()),
    cleanupOauthRefresh: new Queue(QUEUES.cleanupOauthRefresh, queueOpts()),
    restore: new Queue(QUEUES.restore, queueOpts()),
    restoreGc: new Queue(QUEUES.restoreGc, queueOpts()),
  };
}

export interface WorkersHandle {
  workers: Worker[];
}

/**
 * Start all BullMQ workers. Phase 2 only wires up the caddy-reload job —
 * provision/lifecycle/backup workers land in Phase 3/5.
 */
export function startWorkers(): WorkersHandle {
  const workers: Worker[] = [
    new Worker(QUEUES.caddyReload, async () => handleCaddyReload(), workerOpts()),
    new Worker(
      QUEUES.provision,
      async (job) => handleProvision(job.data as { ref: string }),
      workerOpts(),
    ),
    new Worker(
      QUEUES.lifecycle,
      async (job) => {
        const action = job.name as 'pause' | 'resume' | 'restart' | 'delete' | 'upgrade';
        await handleLifecycle(
          action,
          job.data as { ref: string; supabaseVersion?: string; backupFirst?: boolean },
        );
      },
      workerOpts(),
    ),
    new Worker(
      QUEUES.backup,
      async (job) => handleBackup(job.data as { ref: string; kind: 'manual' | 'auto' }),
      workerOpts(),
    ),
    new Worker(QUEUES.backupScheduler, async () => handleBackupSchedulerTick(), workerOpts()),
    new Worker(QUEUES.healthReconciler, async () => handleHealthReconciler(), workerOpts()),
    new Worker(
      QUEUES.pgEdgeCertIssue,
      async (job) => handlePgEdgeCertIssue(job.data as { ref: string }),
      { ...workerOpts(), concurrency: 2 },
    ),
    new Worker(
      QUEUES.poolerReconciler,
      async (job) => handlePoolerReconciler(job.data as PoolerReconcilerJob),
      workerOpts(),
    ),
    new Worker(
      QUEUES.vaultEnable,
      async (job) => handleVaultEnable(job.data as VaultEnableJobData),
      { ...workerOpts(), concurrency: 5 },
    ),
    new Worker(QUEUES.cleanupOauthCodes, async () => handleCleanupOauthCodes(), workerOpts()),
    new Worker(QUEUES.cleanupOauthRefresh, async () => handleCleanupOauthRefresh(), workerOpts()),
    new Worker(
      QUEUES.restore,
      async (job) => handleRestore(job.data as { restore_job_id: string }),
      workerOpts(),
    ),
    new Worker(
      QUEUES.restoreGc,
      async (job) => handleRestoreGc(job.data as { restore_job_id: string }),
      workerOpts(),
    ),
  ];
  for (const w of workers) {
    w.on('failed', (job, err) => {
      logger.error({ job: job?.id, queue: w.name, err }, 'job failed');
    });
    w.on('error', (err) => {
      logger.error({ queue: w.name, err }, 'worker error');
    });
  }
  return { workers };
}

export async function stopWorkers(handle: WorkersHandle): Promise<void> {
  await Promise.all(handle.workers.map((w) => w.close()));
}
