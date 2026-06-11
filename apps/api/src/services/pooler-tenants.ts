import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { getApex } from '@supastack/shared';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import type { InstanceSecrets } from './instance-secrets.js';
import { registerTenant, unregisterTenant } from './pooler-client.js';

/**
 * Register a project as a tenant in the top-level supavisor (Phase 5).
 * Inserts a `pooler_tenants` row + calls supavisor's admin HTTP API.
 *
 * Should be called from the same transaction as `supabase_instances` row
 * creation so a failed registration rolls back the whole provision.
 */
export async function registerTenantForInstance(ref: string): Promise<void> {
  const [inst] = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
      portDbDirect: schema.supabaseInstances.portDbDirect,
      portPostgres: schema.supabaseInstances.portPostgres,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new Error(`instance ${ref} not found`);

  const apex = getApex();
  if (!apex) throw new Error('apex domain not configured');

  // dbDirect is the host port that publishes the per-instance db:5432.
  // For pre-feature-005 instances, fall back to portPostgres (which the old
  // per-instance supavisor used).
  const dbHostPort = inst.portDbDirect ?? inst.portPostgres;

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const sniHostname = `pooler.${apex}`;

  // Upsert tracking row with status='registering'.
  await db()
    .insert(schema.poolerTenants)
    .values({
      instanceRef: ref,
      externalId: ref,
      sniHostname,
      status: 'registering',
    })
    .onConflictDoUpdate({
      target: schema.poolerTenants.externalId,
      set: {
        status: 'registering',
        lastError: null,
        updatedAt: new Date(),
      },
    });

  try {
    await registerTenant({
      externalId: ref,
      dbHost: 'host.docker.internal',
      dbPort: dbHostPort,
      dbDatabase: 'postgres',
      dbPassword: secrets.postgresPassword,
      sniHostname,
      poolSize: 20,
      maxClients: 100,
    });

    await db()
      .update(schema.poolerTenants)
      .set({ status: 'active', lastError: null, updatedAt: new Date() })
      .where(eq(schema.poolerTenants.externalId, ref));

    await db()
      .insert(schema.poolerEvents)
      .values({
        externalId: ref,
        event: 'register',
        detail: { sniHostname, dbPort: dbHostPort },
      });
  } catch (err) {
    const msg = (err as Error).message;
    await db()
      .update(schema.poolerTenants)
      .set({ status: 'failed', lastError: msg, updatedAt: new Date() })
      .where(eq(schema.poolerTenants.externalId, ref));
    await db()
      .insert(schema.poolerEvents)
      .values({
        externalId: ref,
        event: 'register_failed',
        detail: { error: msg },
      });
    throw err;
  }
}

export async function unregisterTenantForInstance(ref: string): Promise<void> {
  try {
    await unregisterTenant(ref);
    await db().insert(schema.poolerEvents).values({ externalId: ref, event: 'unregister' });
  } catch (err) {
    await db()
      .insert(schema.poolerEvents)
      .values({
        externalId: ref,
        event: 'unregister_failed',
        detail: { error: (err as Error).message },
      });
    throw err;
  } finally {
    await db().delete(schema.poolerTenants).where(eq(schema.poolerTenants.externalId, ref));
  }
}
