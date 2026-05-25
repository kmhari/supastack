/**
 * Active auth probe — feature 008 US3 prevention (FR-014).
 *
 * Connects to the per-instance Postgres with the stored encrypted_secrets
 * password. Returns whether auth succeeded; on failure, distinguishes
 * auth-class errors (28P01, "password authentication failed") from other
 * errors (network, timeout) so the caller can tell a real drift from a
 * not-yet-ready healthcheck race.
 *
 * Retries 3× with 2s delay per research.md Decision 5 — Postgres healthcheck
 * sometimes reports "ready" via pg_isready before the auth layer is fully
 * initialized.
 */
import pg from 'pg';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import { logger } from '@selfbase/shared';

export interface ProbeResult {
  ok: boolean;
  isAuthClass: boolean;
  attempts: number;
  lastError?: string;
}

export interface ProbeOpts {
  /** Total attempts. Default 3. */
  retries?: number;
  /** Delay between attempts in ms. Default 2000. */
  delayMs?: number;
}

export async function probeAuthWithStoredPassword(
  ref: string,
  opts: ProbeOpts = {},
): Promise<ProbeResult> {
  const retries = opts.retries ?? 3;
  const delayMs = opts.delayMs ?? 2000;

  const [inst] = await db()
    .select({
      encryptedSecrets: schema.supabaseInstances.encryptedSecrets,
      portDbDirect: schema.supabaseInstances.portDbDirect,
      portPostgres: schema.supabaseInstances.portPostgres,
    })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst) {
    return { ok: false, isAuthClass: false, attempts: 0, lastError: 'instance_not_found' };
  }

  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as {
    postgresPassword: string;
  };
  const port = inst.portDbDirect ?? inst.portPostgres;

  let attempts = 0;
  let lastError: string | undefined;
  let lastIsAuthClass = false;

  while (attempts < retries) {
    attempts++;
    const client = new pg.Client({
      host: 'host.docker.internal',
      port,
      user: 'postgres',
      password: secrets.postgresPassword,
      database: 'postgres',
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    try {
      await client.connect();
      await client.query('SELECT 1');
      await client.end();
      return { ok: true, isAuthClass: false, attempts };
    } catch (err) {
      await client.end().catch(() => {});
      const e = err as Error & { code?: string };
      lastError = e.message;
      lastIsAuthClass = e.code === '28P01' || /password authentication failed/i.test(e.message);
      logger.debug(
        { ref, attempt: attempts, isAuthClass: lastIsAuthClass, err: e.message },
        'pg-password-probe: attempt failed',
      );
      if (attempts < retries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  return { ok: false, isAuthClass: lastIsAuthClass, attempts, lastError };
}
