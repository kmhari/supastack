import { eq, inArray, not } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared';
import { composePs } from '@supastack/docker-control';

/**
 * Periodic reconciler — honors FR-033. Polls actual container state for every
 * non-deleted instance and flips the DB row's status if it diverges from
 * what we last recorded.
 *
 * Detection rules:
 *  - all containers running + healthy/none → status='running'
 *  - all containers exited (state==='exited') → if current status==='paused', leave;
 *    otherwise flip to 'stopped' (silent crash / OOM-kill)
 *  - mixed (some running some not) → status='failed' with a synthetic provision_error
 *
 * `deleting` is owned by the lifecycle worker and never touched.
 * `provisioning` is owned by the provision worker, but if it's stuck for
 * longer than PROVISION_STUCK_THRESHOLD_MS (the provision worker died mid-run
 * after containers started), we rescue based on actual container state.
 */
const PROVISION_STUCK_THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export async function handleHealthReconciler(): Promise<void> {
  const rows = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      status: schema.supabaseInstances.status,
      updatedAt: schema.supabaseInstances.updatedAt,
    })
    .from(schema.supabaseInstances)
    .where(not(inArray(schema.supabaseInstances.status, ['deleting', 'restoring'])));

  const now = Date.now();
  for (const row of rows) {
    // Skip provisioning rows that haven't been stuck long enough — the
    // provision worker still owns them.
    if (
      row.status === 'provisioning' &&
      now - row.updatedAt.getTime() < PROVISION_STUCK_THRESHOLD_MS
    ) {
      continue;
    }
    try {
      await reconcile(
        row.ref,
        row.status as 'running' | 'paused' | 'stopped' | 'failed' | 'provisioning',
      );
    } catch (err) {
      logger.warn(
        { ref: row.ref, err: (err as Error).message },
        'health-reconciler: failed to inspect instance',
      );
    }
  }
}

async function reconcile(
  ref: string,
  current: 'running' | 'paused' | 'stopped' | 'failed' | 'provisioning',
): Promise<void> {
  const ctx = { projectName: `supastack-${ref}`, dir: '' };
  const containers = await composePs(ctx);

  // If there are no containers at all and the row still claims running, that's
  // a divergence; treat as stopped (operator deleted out-of-band).
  if (containers.length === 0) {
    if (current !== 'stopped') {
      await setStatus(ref, 'stopped', null);
      logger.info({ ref, from: current }, 'reconciler: no containers; marking stopped');
    }
    return;
  }

  const allRunningHealthy = containers.every(
    (c) => c.state === 'running' && (c.health === 'healthy' || c.health === 'none'),
  );
  const allExited = containers.every((c) => c.state === 'exited');

  if (allRunningHealthy) {
    if (current !== 'running') {
      await setStatus(ref, 'running', null);
      logger.info({ ref, from: current }, 'reconciler: all healthy; marking running');
    }
    return;
  }
  if (allExited) {
    // If the user has paused the instance, leave it alone.
    if (current === 'paused') return;
    if (current !== 'stopped') {
      await setStatus(ref, 'stopped', 'all containers exited (likely OOM-kill or host restart)');
      logger.warn({ ref, from: current }, 'reconciler: all exited; marking stopped');
    }
    return;
  }

  // Mixed state — partial outage. Mark failed so the dashboard surfaces it.
  // For a stuck `provisioning` row, the rescue path is the same: surface the
  // real failure instead of leaving it in limbo.
  if (current !== 'failed') {
    const bad = containers
      .filter((c) => c.state !== 'running' || c.health === 'unhealthy')
      .map((c) => `${c.service}=${c.state}/${c.health}`)
      .join(', ');
    const msg =
      current === 'provisioning'
        ? `provision stuck — partial outage detected: ${bad}`
        : `partial outage: ${bad}`;
    await setStatus(ref, 'failed', msg);
    logger.warn({ ref, bad, from: current }, 'reconciler: partial outage; marking failed');
  }
}

async function setStatus(
  ref: string,
  status: 'running' | 'paused' | 'stopped' | 'failed',
  provisionError: string | null,
): Promise<void> {
  await db()
    .update(schema.supabaseInstances)
    .set({ status, provisionError, updatedAt: new Date() })
    .where(eq(schema.supabaseInstances.ref, ref));
}
