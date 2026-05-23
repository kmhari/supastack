import pg from 'pg';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import type { InstanceSecrets } from './instance-secrets.js';

/**
 * Shared helper for opening an ephemeral pg connection to a per-instance
 * Postgres, used by US2 (migrations), and later US3 (snippets) + US4
 * (restore smoke probes).
 *
 * Connection model (research.md Decision 8): ephemeral per request. The
 * helper resolves the instance row, decrypts secrets, opens a pg.Client to
 * `host.docker.internal:<port_db_direct>` as postgres, runs the callback,
 * then closes the client in a finally block.
 *
 * Uses the `pg` package symlinked into @selfbase/db's node_modules (same
 * pattern as the Phase-5 backfill script; the api package itself doesn't
 * depend on pg directly).
 */

export class InstanceNotFoundError extends Error {
  code = 'instance_not_found' as const;
}
export class InstanceNotRunningError extends Error {
  code = 'instance_not_running' as const;
  constructor(public readonly status: string) {
    super(`Project is in state '${status}'`);
  }
}
export class PerInstancePgConnectError extends Error {
  code = 'per_instance_pg_connect_error' as const;
  constructor(message: string) {
    super(message);
  }
}

export interface PerInstancePgOpts {
  /** Override which DB to connect to (default 'postgres'). */
  database?: string;
  /** Override timeout in ms (default 30000). */
  timeoutMs?: number;
}

export async function withPerInstancePg<T>(
  ref: string,
  fn: (client: pg.Client) => Promise<T>,
  opts: PerInstancePgOpts = {},
): Promise<T> {
  const [inst] = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      status: schema.supabaseInstances.status,
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
      portDbDirect: schema.supabaseInstances.portDbDirect,
      portPostgres: schema.supabaseInstances.portPostgres,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);

  if (!inst) throw new InstanceNotFoundError(`instance ${ref} not found`);
  if (inst.status !== 'running') throw new InstanceNotRunningError(inst.status);

  const port = inst.portDbDirect ?? inst.portPostgres;
  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as InstanceSecrets;

  const client = new pg.Client({
    host: 'host.docker.internal',
    port,
    user: 'postgres',
    password: secrets.postgresPassword,
    database: opts.database ?? 'postgres',
    ssl: false,
    statement_timeout: opts.timeoutMs ?? 30_000,
    connectionTimeoutMillis: 10_000,
  });

  try {
    try {
      await client.connect();
    } catch (err) {
      throw new PerInstancePgConnectError((err as Error).message);
    }
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
