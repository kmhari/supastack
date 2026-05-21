import { Queue, Worker, type QueueOptions, type WorkerOptions } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@selfbase/shared';
import { handleCaddyReload } from './jobs/caddy-reload.js';
import { handleProvision } from './jobs/provision.js';
import { handleLifecycle } from './jobs/lifecycle.js';

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
  provision: 'selfbase.provision',
  lifecycle: 'selfbase.lifecycle',
  backup: 'selfbase.backup',
  backupScheduler: 'selfbase.backup-scheduler',
  caddyReload: 'selfbase.caddy-reload',
  healthReconciler: 'selfbase.health-reconciler',
} as const;

export interface Queues {
  provision: Queue;
  lifecycle: Queue;
  backup: Queue;
  backupScheduler: Queue;
  caddyReload: Queue;
  healthReconciler: Queue;
}

export function connectQueues(): Queues {
  return {
    provision: new Queue(QUEUES.provision, queueOpts()),
    lifecycle: new Queue(QUEUES.lifecycle, queueOpts()),
    backup: new Queue(QUEUES.backup, queueOpts()),
    backupScheduler: new Queue(QUEUES.backupScheduler, queueOpts()),
    caddyReload: new Queue(QUEUES.caddyReload, queueOpts()),
    healthReconciler: new Queue(QUEUES.healthReconciler, queueOpts()),
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
        const { ref } = job.data as { ref: string };
        const action = job.name as 'pause' | 'resume' | 'restart' | 'delete';
        await handleLifecycle(action, ref);
      },
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
