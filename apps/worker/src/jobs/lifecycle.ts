import { db, releasePortsForInstance, schema } from '@supastack/db';
import {
  composeAllHealthy,
  composeDown,
  composePull,
  composeRestart,
  composeRestartService,
  composeStart,
  composeStop,
  composeUp,
  type ComposeContext,
} from '@supastack/docker-control';
import { logger } from '@supastack/shared';
import { eq } from 'drizzle-orm';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { enqueueBackup } from './backup-enqueue.js';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';

export type LifecycleAction = 'pause' | 'resume' | 'restart' | 'restart-db' | 'delete' | 'upgrade';

export interface UpgradeArgs {
  ref: string;
  supabaseVersion: string;
  backupFirst: boolean;
}

export async function handleLifecycle(
  action: LifecycleAction,
  payload: { ref: string } | UpgradeArgs,
): Promise<void> {
  const ref = payload.ref;
  const log = logger.child({ job: 'lifecycle', action, ref });
  const [row] = await db()
    .select()
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!row) {
    log.warn('instance row not found');
    return;
  }

  const ctx: ComposeContext = {
    projectName: `supastack-${ref}`,
    dir: path.join(INSTANCES_DIR, ref),
  };

  switch (action) {
    case 'pause':
      await composeStop(ctx);
      await setStatus(ref, 'paused');
      log.info('paused');
      return;
    case 'resume':
      await composeStart(ctx);
      await waitHealthy(ctx, 60_000);
      await setStatus(ref, 'running');
      log.info('resumed');
      return;
    case 'restart':
      await composeRestart(ctx);
      await waitHealthy(ctx, 60_000);
      await setStatus(ref, 'running');
      log.info('restarted');
      return;
    case 'restart-db':
      await composeRestartService(ctx, 'db');
      await waitHealthy(ctx, 60_000);
      await setStatus(ref, 'running');
      log.info('restarted-db');
      return;
    case 'delete':
      await composeDown(ctx, { removeVolumes: true });
      await releasePortsForInstance(db(), ref);
      // Unregister pooler tenant before dropping the instance row (feature 005).
      // Non-fatal: reconciler will sweep stragglers.
      try {
        const apiUrl = process.env.SUPASTACK_API_URL ?? 'http://api:3001';
        const res = await fetch(`${apiUrl}/internal/pooler/tenants/${ref}`, { method: 'DELETE' });
        if (!res.ok && res.status !== 404) {
          log.warn({ status: res.status }, 'pooler tenant unregister non-2xx; non-fatal');
        }
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'pooler tenant unregister failed; non-fatal');
      }
      await db().delete(schema.supabaseInstances).where(eq(schema.supabaseInstances.ref, ref));
      try {
        await fs.rm(ctx.dir, { recursive: true, force: true });
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'failed to remove instance directory');
      }
      log.info('deleted');
      return;
    case 'upgrade': {
      const args = payload as UpgradeArgs;
      // Optional pre-upgrade backup. If it fails, abort the upgrade — operator
      // can re-run after addressing the backup issue.
      if (args.backupFirst) {
        log.info('triggering pre-upgrade backup');
        await enqueueBackup(ref, 'manual');
        // We don't wait for it to finish; the upgrade job continues. Operators
        // wanting strict "backup-then-upgrade" should use the API to back up,
        // wait for completion, then upgrade.
      }
      await composePull(ctx);
      await composeUp(ctx); // -d recreate via the same Compose project
      await waitHealthy(ctx, 180_000);
      await db()
        .update(schema.supabaseInstances)
        .set({ supabaseVersion: args.supabaseVersion, status: 'running', updatedAt: new Date() })
        .where(eq(schema.supabaseInstances.ref, ref));
      log.info({ to: args.supabaseVersion }, 'upgraded');
      return;
    }
  }
}

async function setStatus(
  ref: string,
  status: 'running' | 'paused' | 'stopped' | 'failed',
): Promise<void> {
  await db()
    .update(schema.supabaseInstances)
    .set({ status, updatedAt: new Date() })
    .where(eq(schema.supabaseInstances.ref, ref));
}

async function waitHealthy(ctx: ComposeContext, timeoutMs: number): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await composeAllHealthy(ctx)) return;
    await new Promise((r) => setTimeout(r, 3_000));
  }
  throw new Error(`containers did not become healthy within ${timeoutMs / 1000}s`);
}
