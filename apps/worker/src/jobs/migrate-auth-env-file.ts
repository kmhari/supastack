/**
 * One-shot boot-time migration: re-up the auth container for every running
 * instance so Docker picks up the new `env_file: .env` directive added in
 * feature 024 (#77).
 *
 * Safe to re-run on worker restart — composeUpService is idempotent and
 * Docker skips the recreate when the compose config hasn't changed.
 */
import { db, schema } from '@supastack/db';
import { composeUpService, type ComposeContext } from '@supastack/docker-control';
import { logger } from '@supastack/shared';
import { eq } from 'drizzle-orm';
import path from 'node:path';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const log = logger.child({ job: 'migrate-auth-env-file' });

export async function runMigrateAuthEnvFile(): Promise<void> {
  const instances = await db()
    .select({ ref: schema.supabaseInstances.ref })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.status, 'running'));

  log.info({ count: instances.length }, 'migrate-auth-env-file: starting');

  for (const inst of instances) {
    const ctx: ComposeContext = {
      projectName: `supastack-${inst.ref}`,
      dir: path.join(INSTANCES_DIR, inst.ref),
    };
    try {
      await composeUpService(ctx, 'auth');
      log.info({ ref: inst.ref }, 'migrate-auth-env-file: auth recreated');
    } catch (err) {
      log.error({ ref: inst.ref, err }, 'migrate-auth-env-file: failed, skipping');
    }
  }

  log.info({ count: instances.length }, 'migrate-auth-env-file: complete');
}
