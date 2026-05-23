/**
 * One-shot script: register every existing supabase_instances row as a tenant
 * in the top-level supavisor. Idempotent (registerTenant treats 409 as success
 * and pooler_tenants upsert is a no-op for duplicates).
 *
 * Invocation:
 *   docker exec selfbase-api-1 node /app/apps/api/scripts/backfill-pooler-tenants.js
 * Or via tsx in dev:
 *   pnpm --filter @selfbase/api exec tsx scripts/backfill-pooler-tenants.ts
 */
import { not, inArray } from 'drizzle-orm';
import { makeDb, db, schema } from '@selfbase/db';
import { registerTenantForInstance } from '../src/services/pooler-tenants.js';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) throw new Error('DATABASE_URL required');
  makeDb(dbUrl);

  const instances = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      name: schema.supabaseInstances.name,
      status: schema.supabaseInstances.status,
    })
    .from(schema.supabaseInstances)
    .where(not(inArray(schema.supabaseInstances.status, ['deleting'])));

  console.log(`backfill: ${instances.length} instances to process`);
  let ok = 0, fail = 0;
  for (const inst of instances) {
    try {
      await registerTenantForInstance(inst.ref);
      console.log(`  ✓ ${inst.ref} (${inst.name})`);
      ok++;
    } catch (err) {
      console.error(`  ✗ ${inst.ref} (${inst.name}): ${(err as Error).message}`);
      fail++;
    }
  }
  console.log(`done — ${ok} registered, ${fail} failed`);
  if (fail > 0) process.exit(1);
}

main().catch((err) => {
  console.error('backfill fatal:', err);
  process.exit(1);
});
