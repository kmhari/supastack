/**
 * Thin enqueue client used by the api (manual trigger endpoint, and later
 * the reset-pg-password endpoint) to kick off pooler-reconciler jobs in
 * the worker queue.
 *
 * The api also does a quick "is a run already in flight?" check by querying
 * reconciler_runs directly so the manual-trigger endpoint can return 409
 * without round-tripping through Redis.
 */
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';

const QUEUE_NAME = 'selfbase.pooler-reconciler';

let _queue: Queue | null = null;
function getQueue(): Queue {
  if (!_queue) {
    const url = process.env.REDIS_URL;
    if (!url) throw new Error('REDIS_URL not set');
    _queue = new Queue(QUEUE_NAME, { connection: new Redis(url, { maxRetriesPerRequest: null }) });
  }
  return _queue;
}

export type EnqueuePayload =
  | { mode: 'full'; triggerSource: 'manual'; actorId: string; runId: string }
  | { mode: 'single'; ref: string; runId: string };

export async function enqueueReconcilerJob(payload: EnqueuePayload, priority = 10): Promise<void> {
  await getQueue().add('trigger', payload, {
    priority, // lower = higher priority; manual triggers use 10 (above default 0 cron tick)
    removeOnComplete: 50,
    removeOnFail: 50,
  });
}

/** Check if a reconciler run is currently in-flight (used by manual trigger endpoint for 409). */
export async function findInFlightRun(): Promise<{ id: string; startedAt: Date } | null> {
  const [row] = await db()
    .select({ id: schema.reconcilerRuns.id, startedAt: schema.reconcilerRuns.startedAt })
    .from(schema.reconcilerRuns)
    .where(eq(schema.reconcilerRuns.status, 'running'))
    .limit(1);
  return row ?? null;
}
