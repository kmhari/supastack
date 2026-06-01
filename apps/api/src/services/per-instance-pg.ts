import pg from 'pg';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { decryptJson, loadMasterKey } from '@supastack/crypto';
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
 * Uses the `pg` package symlinked into @supastack/db's node_modules (same
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
  /**
   * Client-side statement_timeout, in ms. Default 30000.
   *
   * Pass `null` to NOT set client-side statement_timeout — the per-project
   * Postgres `statement_timeout` GUC (settable via `supabase postgres-config
   * update --statement-timeout=…`, feature 009) becomes the source of truth.
   * Used by the db-query endpoint per FR-007 (feature 013).
   */
  timeoutMs?: number | null;
  /**
   * When true, issues `SET default_transaction_read_only = on` after connect.
   * Postgres rejects any write (DML/DDL) with SQLSTATE 25006 — surfaced as
   * `read_only_violation` by the db-query route (feature 013).
   */
  readOnly?: boolean;
}

/**
 * Per-Client `types` override that casts INT8 (oid 20) + NUMERIC (oid 1700)
 * to JS number. Falls back to pg's default parser for every other oid.
 */
function numericReturningParserOverride(): { getTypeParser: typeof pg.types.getTypeParser } {
  const INT8 = 20;
  const NUMERIC = 1700;
  return {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    getTypeParser(oid: number, format?: any) {
      if (oid === INT8) return (val: string) => Number(val);
      if (oid === NUMERIC) return (val: string) => Number(val);
      return pg.types.getTypeParser(oid, format);
    },
  };
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

  const clientCfg: pg.ClientConfig = {
    host: 'host.docker.internal',
    port,
    user: 'postgres',
    password: secrets.postgresPassword,
    database: opts.database ?? 'postgres',
    ssl: false,
    connectionTimeoutMillis: 10_000,
    // Cast int8 (bigint) → JS number and numeric → JS number on the way out.
    // Default pg behavior is to stringify these (because JS numbers can't
    // represent the full int64 range); but every downstream consumer here —
    // upstream Supabase MCP server's Zod schemas (e.g. `list_tables`), MCP
    // `execute_sql` typed responses, dashboard JSON renderer — expects JS
    // numbers. Matches what upstream Cloud's `database/query` emits.
    // Scoped per-Client so it doesn't leak into other pg consumers globally.
    types: numericReturningParserOverride(),
  };
  // `timeoutMs: null` → don't set; let the project's PG GUC decide (FR-007).
  if (opts.timeoutMs !== null) {
    clientCfg.statement_timeout = opts.timeoutMs ?? 30_000;
  }
  const client = new pg.Client(clientCfg);

  try {
    try {
      await client.connect();
    } catch (err) {
      throw new PerInstancePgConnectError((err as Error).message);
    }
    if (opts.readOnly) {
      await client.query('SET default_transaction_read_only = on');
    }
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}
