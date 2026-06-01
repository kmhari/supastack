/**
 * vault-enable BullMQ job.
 *
 * Enables pgsodium + supabase_vault on a per-instance Postgres + sets
 * `supabase_instances.vault_enabled_at` + emits an audit_log entry.
 *
 * Triggered by the dashboard "Enable vault" button (POST /api/v1/projects/<ref>/vault/enable).
 * Provision-time enablement uses bootstrapVault() directly (see provision.ts);
 * this job exists for the dashboard re-enable path (FR-002).
 *
 * Idempotent (the underlying SQL is). Safe to run against a fully-enabled
 * instance — the smoke test exercises encrypt/decrypt either way.
 *
 * Spec: 010-secrets-management — T012.
 */

import pg from 'pg';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
import { logger } from '@supastack/shared';
import { bootstrapVault } from '../services/vault-bootstrap.js';

export type VaultEnableJobData = {
  ref: string;
  source: 'provision' | 'dashboard-button';
};

export type VaultEnableJobResult = {
  ref: string;
  durationMs: number;
};

export async function handleVaultEnable(data: VaultEnableJobData): Promise<VaultEnableJobResult> {
  const { ref, source } = data;
  const log = logger.child({ job: 'vault-enable', ref, source });
  const start = Date.now();

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
  if (!inst) throw new Error(`vault-enable: instance ${ref} not found`);

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as {
    postgresPassword: string;
  };
  const port = inst.portDbDirect ?? inst.portPostgres;

  const client = new pg.Client({
    host: 'host.docker.internal',
    port,
    user: 'supabase_admin',
    password: secrets.postgresPassword,
    database: 'postgres',
    ssl: false,
    connectionTimeoutMillis: 5000,
    statement_timeout: 30_000,
  });

  await client.connect();
  try {
    await bootstrapVault(client);
  } finally {
    await client.end().catch(() => {});
  }

  const enabledAt = new Date();
  await db()
    .update(schema.supabaseInstances)
    .set({ vaultEnabledAt: enabledAt, updatedAt: enabledAt })
    .where(eq(schema.supabaseInstances.ref, ref));

  await db()
    .insert(schema.auditLog)
    .values({
      actorUserId: null,
      action: 'instance.vault.enabled',
      targetKind: 'supabase_instance',
      targetId: ref,
      payload: { ref, source, enabledAt: enabledAt.toISOString() },
    });

  const durationMs = Date.now() - start;
  log.info({ durationMs }, 'vault-enable: ✓');
  return { ref, durationMs };
}
