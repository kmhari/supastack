import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { db, schema, releasePortsForInstance } from '@selfbase/db';
import { logger } from '@selfbase/shared';
import {
  composeAllHealthy,
  composeDown,
  composeRestart,
  composeStart,
  composeStop,
  type ComposeContext,
} from '@selfbase/docker-control';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';

type LifecycleAction = 'pause' | 'resume' | 'restart' | 'delete';

export async function handleLifecycle(action: LifecycleAction, ref: string): Promise<void> {
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
    projectName: `selfbase-${ref}`,
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
    case 'delete':
      await composeDown(ctx, { removeVolumes: true });
      await releasePortsForInstance(db(), ref);
      await db().delete(schema.supabaseInstances).where(eq(schema.supabaseInstances.ref, ref));
      try {
        await fs.rm(ctx.dir, { recursive: true, force: true });
      } catch (err) {
        log.warn({ err: (err as Error).message }, 'failed to remove instance directory');
      }
      log.info('deleted');
      return;
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
