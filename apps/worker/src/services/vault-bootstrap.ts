/**
 * Per-project supabase_vault bootstrap.
 *
 * Runs the idempotent SQL sequence that enables pgsodium + supabase_vault on a
 * per-instance Postgres and smoke-tests the encrypt/decrypt path. Called from:
 *   1. provision.ts — synchronously between auth-probe + status='running'
 *   2. vault-enable-job.ts — BullMQ handler for the dashboard "Enable vault"
 *      button (used after backup restores or for manual re-runs)
 *
 * Spec: 010-secrets-management — research.md Decision 6 + FR-001 + FR-002.
 *
 * The smoke test (final DO block) catches partial-install pathologies
 * (e.g., libsodium missing) at bootstrap time rather than on the first
 * operator-driven write.
 */

import type { Client } from 'pg';

export class VaultBootstrapError extends Error {
  code = 'vault_bootstrap_failed' as const;
  constructor(stage: string, cause: Error) {
    super(`vault bootstrap failed at stage "${stage}": ${cause.message}`);
  }
}

/**
 * Idempotent — re-running on a fully-enabled instance is a no-op + cheap
 * smoke test (single create/select/delete cycle on a sentinel row).
 *
 * Throws VaultBootstrapError with the failing stage on any error.
 */
export async function bootstrapVault(client: Client): Promise<void> {
  // 1. pgsodium first — supabase_vault depends on it.
  await runStage(client, 'create-pgsodium', `CREATE EXTENSION IF NOT EXISTS pgsodium`);

  // 2. Ensure pgsodium has a default root key. The DO block makes this
  //    idempotent — older project images may have shipped without one.
  await runStage(
    client,
    'ensure-pgsodium-root-key',
    `DO $$
     BEGIN
       IF NOT EXISTS (SELECT 1 FROM pgsodium.key WHERE name = 'default') THEN
         PERFORM pgsodium.create_key(name => 'default');
       END IF;
     END $$`,
  );

  // 3. supabase_vault — CASCADE pulls pgsodium if for any reason step 1
  //    didn't run (defensive; should be a no-op given step 1).
  await runStage(
    client,
    'create-supabase-vault',
    `CREATE EXTENSION IF NOT EXISTS supabase_vault CASCADE`,
  );

  // 4. Verify both ended up installed.
  const verify = await client.query<{ extname: string }>(
    `SELECT extname FROM pg_extension WHERE extname IN ('pgsodium','supabase_vault')`,
  );
  const present = new Set(verify.rows.map((r) => r.extname));
  if (!present.has('pgsodium') || !present.has('supabase_vault')) {
    throw new VaultBootstrapError(
      'verify-extensions',
      new Error(`extensions missing after install: ${JSON.stringify([...present])}`),
    );
  }

  // 5. Smoke test the encrypt/decrypt round-trip on a sentinel row.
  //    Wrapped in DO so it doesn't leave state if it succeeds.
  await runStage(
    client,
    'smoke-test',
    `DO $$
     DECLARE sentinel_id uuid;
     BEGIN
       sentinel_id := vault.create_secret(
         'supastack-bootstrap-sentinel',
         '_supastack_bootstrap_check_' || extract(epoch from now())::bigint::text
       );
       PERFORM decrypted_secret FROM vault.decrypted_secrets WHERE id = sentinel_id;
       DELETE FROM vault.secrets WHERE id = sentinel_id;
     END $$`,
  );
}

async function runStage(client: Client, stage: string, sql: string): Promise<void> {
  try {
    await client.query(sql);
  } catch (err) {
    throw new VaultBootstrapError(stage, err as Error);
  }
}
