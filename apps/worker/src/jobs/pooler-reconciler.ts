/**
 * BullMQ worker entry for the pooler reconciler (feature 008 US1).
 *
 * Three modes:
 *  - { mode: 'full',   triggerSource: 'cron' | 'manual', actorId? }
 *      Full sweep across all instances. Cron fires this at 03:00 UTC;
 *      api's manual-trigger endpoint also enqueues this.
 *  - { mode: 'single', ref, runId? }
 *      Single-instance pass (US3 reset endpoint syncs through this).
 *      If runId is provided, reuses that row; else creates a new one.
 *
 * Heavy lifting lives in apps/api/src/services/pooler-reconciler.ts —
 * imported via the workspace alias so worker + api stay in sync.
 */
import { logger } from '@selfbase/shared';
import {
  startRun,
  runFullReconcile,
  runSingleInstanceReconcile,
} from '../services/pooler-reconciler.js';

export type PoolerReconcilerJob =
  | { mode: 'full'; triggerSource: 'cron' | 'manual'; actorId?: string; runId?: string }
  | { mode: 'single'; ref: string; runId?: string };

export async function handlePoolerReconciler(job: PoolerReconcilerJob): Promise<void> {
  if (job.mode === 'full') {
    let runId = job.runId;
    if (!runId) {
      const r = await startRun(job.triggerSource, job.actorId);
      runId = r.runId;
    }
    logger.info({ runId, mode: 'full', source: job.triggerSource }, 'pooler-reconciler: starting');
    await runFullReconcile(runId);
  } else {
    let runId = job.runId;
    if (!runId) {
      const r = await startRun('manual');
      runId = r.runId;
    }
    logger.info({ runId, mode: 'single', ref: job.ref }, 'pooler-reconciler: starting');
    await runSingleInstanceReconcile(runId, job.ref);
  }
}
