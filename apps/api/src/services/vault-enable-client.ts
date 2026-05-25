/**
 * Thin BullMQ enqueue client for the vault-enable job.
 *
 * The dashboard's "Enable vault" button hits POST /api/v1/projects/<ref>/vault/enable;
 * that route uses this client to push a job onto the worker's
 * `selfbase.vault-enable` queue. The actual SQL runs in the worker.
 *
 * Idempotency: dashboard idempotency is enforced at the route layer (the
 * route returns the existing in-flight job-id if present). The job itself
 * is also idempotent (SQL uses IF NOT EXISTS).
 *
 * Spec: 010-secrets-management — T017.
 */

import { Queue, type Job } from 'bullmq';
import { Redis } from 'ioredis';

const QUEUE_NAME = 'selfbase.vault-enable';

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (!_queue) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');
    _queue = new Queue(QUEUE_NAME, {
      connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
  }
  return _queue;
}

export type VaultEnablePayload = { ref: string; source: 'dashboard-button' };

/**
 * Look for an active (waiting/delayed/active) vault-enable job for `ref`.
 * Returns its job id, or null if none. Used by the route for idempotent
 * double-clicks.
 */
export async function findInFlightVaultEnable(ref: string): Promise<string | null> {
  const queue = getQueue();
  const jobs = await queue.getJobs(['waiting', 'delayed', 'active'], 0, 100);
  const match = jobs.find((j: Job) => (j.data as VaultEnablePayload)?.ref === ref);
  return match?.id ?? null;
}

export async function enqueueVaultEnable(payload: VaultEnablePayload): Promise<string> {
  const job = await getQueue().add('enable', payload, {
    removeOnComplete: 50,
    removeOnFail: 50,
    attempts: 2,
    backoff: { type: 'exponential', delay: 5000 },
  });
  if (!job.id) throw new Error('vault-enable: bullmq returned job without id');
  return job.id;
}
