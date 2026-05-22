import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { QUEUES } from '../queues.js';

const REDIS_URL = process.env.REDIS_URL!;

let _q: Queue | null = null;
function backupQueue(): Queue {
  if (!_q) {
    _q = new Queue(QUEUES.backup, {
      connection: new Redis(REDIS_URL, { maxRetriesPerRequest: null }),
    });
  }
  return _q;
}

/**
 * Enqueue a backup job. Called from API (on-demand) AND from lifecycle
 * (backupFirst before upgrade) AND from the scheduler (daily auto).
 */
export async function enqueueBackup(ref: string, kind: 'manual' | 'auto'): Promise<void> {
  await backupQueue().add('backup', { ref, kind }, { removeOnComplete: 100 });
}
