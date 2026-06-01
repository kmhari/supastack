/**
 * Per-project Postgres client + vault.* helpers.
 *
 * Opens a short-lived `pg.Client` to host.docker.internal:<port_db_direct>
 * as supabase_admin, runs `fn(client)`, closes. Supastack pattern: never hold
 * long-lived connections per project in the api (operator-driven calls are
 * infrequent; per-request connect overhead ~10–30ms is acceptable).
 *
 * Spec: 010-secrets-management — research.md Decision 1 (vault-client),
 * Decision 2 (vault.* helpers).
 */

import { decryptJson, loadMasterKey } from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared/logger';
import { eq } from 'drizzle-orm';
import { Client } from 'pg';
import type { InstanceSecrets } from './instance-secrets.js';

const log = logger.child({ service: 'vault-client' });

export class InstanceNotFoundForVaultError extends Error {
  code = 'instance_not_found' as const;
}
export class VaultUnreachableError extends Error {
  code = 'vault_unreachable' as const;
}

const PG_HOST = process.env.PER_INSTANCE_PG_HOST ?? 'host.docker.internal';
const CONNECT_TIMEOUT_MS = 5000;
const QUERY_TIMEOUT_MS = 10_000;

/**
 * Open a short-lived pg.Client as `supabase_admin` against the per-instance
 * Postgres, run `fn`, close the client. Throws InstanceNotFoundForVaultError
 * if the ref is unknown; VaultUnreachableError on any connection/query error.
 */
export async function withVaultClient<T>(
  ref: string,
  fn: (client: Client) => Promise<T>,
): Promise<T> {
  const [inst] = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      portDbDirect: schema.supabaseInstances.portDbDirect,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) throw new InstanceNotFoundForVaultError(`instance ${ref} not found`);
  if (inst.portDbDirect === null) {
    throw new VaultUnreachableError(`instance ${ref} has no port_db_direct allocated`);
  }

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;
  const client = new Client({
    host: PG_HOST,
    port: inst.portDbDirect,
    user: 'supabase_admin',
    password: secrets.postgresPassword,
    database: 'postgres',
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    statement_timeout: QUERY_TIMEOUT_MS,
    query_timeout: QUERY_TIMEOUT_MS,
  });

  try {
    await client.connect();
  } catch (err) {
    throw new VaultUnreachableError(`vault-client connect ${ref}: ${(err as Error).message}`);
  }

  try {
    return await fn(client);
  } catch (err) {
    log.warn({ ref, err: (err as Error).message }, 'vault-client query failed');
    throw err;
  } finally {
    await client.end().catch(() => {
      /* swallow — connection cleanup */
    });
  }
}

// ─── vault.* helpers (research.md Decision 2) ──────────────────────────────

export type VaultSecretRow = {
  name: string;
  decryptedSecret: string;
  updatedAt: Date;
};

/** SELECT name, decrypted_secret, updated_at FROM vault.decrypted_secrets. */
export async function vaultListAll(client: Client): Promise<VaultSecretRow[]> {
  const res = await client.query<{
    name: string;
    decrypted_secret: string;
    updated_at: Date;
  }>(
    // NOTE: vault.create_secret() leaves key_id NULL by design (uses pgsodium's
    // default key + per-row nonce internally). Earlier drafts of this spec
    // filtered WHERE key_id IS NOT NULL — wrong, excludes everything.
    `SELECT name, decrypted_secret, updated_at
       FROM vault.decrypted_secrets
      WHERE name IS NOT NULL
      ORDER BY name`,
  );
  return res.rows.map((r) => ({
    name: r.name,
    decryptedSecret: r.decrypted_secret,
    updatedAt: r.updated_at,
  }));
}

/** SELECT id from vault.secrets WHERE name=$1 — returns null if missing. */
export async function vaultFindIdByName(client: Client, name: string): Promise<string | null> {
  const res = await client.query<{ id: string }>(
    'SELECT id FROM vault.secrets WHERE name = $1 LIMIT 1',
    [name],
  );
  return res.rows[0]?.id ?? null;
}

/** SELECT vault.create_secret(value, name). */
export async function vaultCreate(client: Client, name: string, value: string): Promise<void> {
  await client.query('SELECT vault.create_secret($1::text, $2::text)', [value, name]);
}

/** SELECT vault.update_secret(id, new_secret). */
export async function vaultUpdate(client: Client, id: string, value: string): Promise<void> {
  await client.query('SELECT vault.update_secret($1::uuid, $2::text)', [id, value]);
}

/** DELETE FROM vault.secrets WHERE name = ANY($1) RETURNING name. */
export async function vaultDeleteByNames(client: Client, names: string[]): Promise<string[]> {
  if (names.length === 0) return [];
  const res = await client.query<{ name: string }>(
    'DELETE FROM vault.secrets WHERE name = ANY($1::text[]) RETURNING name',
    [names],
  );
  return res.rows.map((r) => r.name);
}
