import { eq, inArray, not } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { logger } from '@selfbase/shared';
import { composePs } from '@selfbase/docker-control';

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
 * We never overwrite status='provisioning' or 'deleting' (those are owned by
 * other workers).
 */
export async function handleHealthReconciler(): Promise<void> {
  const rows = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      status: schema.supabaseInstances.status,
    })
    .from(schema.supabaseInstances)
    .where(not(inArray(schema.supabaseInstances.status, ['provisioning', 'deleting'])));

  for (const row of rows) {
    try {
      await reconcile(row.ref, row.status as 'running' | 'paused' | 'stopped' | 'failed');
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
  current: 'running' | 'paused' | 'stopped' | 'failed',
): Promise<void> {
  const ctx = { projectName: `selfbase-${ref}`, dir: '' };
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
  if (current !== 'failed') {
    const bad = containers
      .filter((c) => c.state !== 'running' || c.health === 'unhealthy')
      .map((c) => `${c.service}=${c.state}/${c.health}`)
      .join(', ');
    await setStatus(ref, 'failed', `partial outage: ${bad}`);
    logger.warn({ ref, bad }, 'reconciler: partial outage; marking failed');
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
