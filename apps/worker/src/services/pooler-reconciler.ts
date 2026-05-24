/**
 * Pooler reconciler — feature 008 US1.
 *
 * Reconciles three sources of truth:
 *   1. `supabase_instances` (control plane) — what projects should exist
 *   2. `pooler_tenants`     (control plane) — what we think is registered
 *   3. supavisor's `/api/tenants`           — what's actually registered
 *
 * Per research.md Decision 3: when supavisor registration fails with an
 * auth-class error, we run an active probe via per-instance PG to
 * disambiguate `pg_password_drift` from generic `failed`.
 *
 * Per Decision 9: emits pooler_events ONLY for actions taken (no events
 * for the consistent no-op path).
 *
 * Self-contained — does not depend on apps/api. Inlines a minimal
 * supavisor HTTP client + uses `pg` directly for the active probe.
 */
import { and, eq, lt, sql } from 'drizzle-orm';
import crypto from 'node:crypto';
import { fetch } from 'undici';
import pg from 'pg';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import { logger } from '@selfbase/shared';

type Classification =
  | 'consistent'
  | 'missing_pooler_row'
  | 'failed_stale'
  | 'missing_in_supavisor'
  | 'instance_gone'
  | 'orphan_in_supavisor'
  | 'pg_password_drift';

interface PerInstanceResult {
  ref: string;
  classification: Classification;
  remediated: boolean;
  error?: string;
}

const RECONCILER_RUNS = schema.reconcilerRuns;
const POOLER_TENANTS = schema.poolerTenants;
const POOLER_EVENTS = schema.poolerEvents;
const SUPABASE_INSTANCES = schema.supabaseInstances;
const ORG = schema.org;
const STALE_RUNNING_MS = 60 * 60 * 1000; // 1h
const STALE_FAILED_MS = 60 * 60 * 1000; // 1h
const RETAIN_RUNS = 30;

const SUPAVISOR_URL = process.env.SUPAVISOR_URL ?? 'http://supavisor:4000';
const SUPAVISOR_JWT_SECRET = process.env.SUPAVISOR_API_JWT_SECRET ?? '';

// ─── supavisor admin client (inlined for worker self-containment) ─────────

function b64url(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function supavisorJwt(): string {
  if (!SUPAVISOR_JWT_SECRET) throw new Error('SUPAVISOR_API_JWT_SECRET not set');
  const header = b64url(Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })));
  const payload = b64url(
    Buffer.from(
      JSON.stringify({
        role: 'admin',
        iss: 'selfbase',
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(Date.now() / 1000) + 300,
      }),
    ),
  );
  const sig = b64url(
    crypto.createHmac('sha256', SUPAVISOR_JWT_SECRET).update(`${header}.${payload}`).digest(),
  );
  return `${header}.${payload}.${sig}`;
}

interface SupavisorTenant {
  external_id: string;
}

/**
 * Supavisor exposes no list-all endpoint; only GET /api/tenants/:external_id.
 * The reconciler asks per-instance whether each one is registered, parallel-
 * limited. With ≤50 projects this is ~1s on a healthy supavisor.
 */
async function supavisorGetTenant(externalId: string): Promise<SupavisorTenant | null> {
  const res = await fetch(`${SUPAVISOR_URL}/api/tenants/${externalId}`, {
    headers: { authorization: `Bearer ${supavisorJwt()}` },
    signal: AbortSignal.timeout(5000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`supavisor get tenant ${externalId}: ${res.status}`);
  return { external_id: externalId };
}

async function supavisorListExisting(externalIds: string[]): Promise<SupavisorTenant[]> {
  if (externalIds.length === 0) return [];
  const results = await Promise.allSettled(externalIds.map((id) => supavisorGetTenant(id)));
  const out: SupavisorTenant[] = [];
  let fulfilled = 0;
  for (let i = 0; i < results.length; i++) {
    const r = results[i]!;
    if (r.status === 'fulfilled') {
      fulfilled++;
      if (r.value) out.push(r.value);
    } else {
      logger.warn(
        { externalId: externalIds[i], err: (r.reason as Error).message },
        'reconciler: supavisor probe failed',
      );
    }
  }
  if (fulfilled === 0) throw new Error('all supavisor probes failed');
  return out;
}

async function supavisorRegister(
  externalId: string,
  body: { dbHost: string; dbPort: number; dbPassword: string; sniHostname: string },
): Promise<void> {
  const payload = {
    tenant: {
      db_host: body.dbHost,
      db_port: body.dbPort,
      db_database: 'postgres',
      default_pool_size: 20,
      default_max_clients: 100,
      require_user: false,
      auth_query: 'SELECT rolname, rolpassword FROM pg_authid WHERE rolname=$1',
      sni_hostname: body.sniHostname,
      users: [
        {
          db_user: 'postgres',
          db_password: body.dbPassword,
          mode_type: 'transaction',
          pool_size: 20,
          is_manager: true,
        },
      ],
    },
  };
  const res = await fetch(`${SUPAVISOR_URL}/api/tenants/${externalId}`, {
    method: 'PUT',
    headers: { authorization: `Bearer ${supavisorJwt()}`, 'content-type': 'application/json' },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok && res.status !== 201 && res.status !== 409) {
    const text = await res.text().catch(() => '');
    throw new Error(`supavisor register ${res.status}: ${text.slice(0, 300)}`);
  }
}

async function supavisorUnregisterTenant(externalId: string): Promise<void> {
  const res = await fetch(`${SUPAVISOR_URL}/api/tenants/${externalId}`, {
    method: 'DELETE',
    headers: { authorization: `Bearer ${supavisorJwt()}` },
    signal: AbortSignal.timeout(5000),
  });
  if (!res.ok && res.status !== 404) {
    const text = await res.text().catch(() => '');
    throw new Error(`supavisor unregister ${res.status}: ${text.slice(0, 300)}`);
  }
}

// ─── Active probe (per-instance PG) ────────────────────────────────────────

async function probeAuthForInstance(
  ref: string,
): Promise<{ ok: boolean; isAuthClass: boolean; error?: string }> {
  const [inst] = await db()
    .select({
      encryptedSecrets: SUPABASE_INSTANCES.encryptedSecrets,
      portDbDirect: SUPABASE_INSTANCES.portDbDirect,
      portPostgres: SUPABASE_INSTANCES.portPostgres,
    })
    .from(SUPABASE_INSTANCES)
    .where(eq(SUPABASE_INSTANCES.ref, ref))
    .limit(1);
  if (!inst) return { ok: false, isAuthClass: false, error: 'instance_not_found' };
  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as { postgresPassword: string };
  const port = inst.portDbDirect ?? inst.portPostgres;
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
    return { ok: true, isAuthClass: false };
  } catch (err) {
    const e = err as Error & { code?: string };
    const isAuthClass = e.code === '28P01' || /password authentication failed/i.test(e.message);
    return { ok: false, isAuthClass, error: e.message };
  } finally {
    await client.end().catch(() => {});
  }
}

// ─── Tenant registration (inlined from api/pooler-tenants.ts) ──────────────

async function registerTenantForInstance(ref: string): Promise<void> {
  const [inst] = await db()
    .select({
      ref: SUPABASE_INSTANCES.ref,
      encryptedSecrets: SUPABASE_INSTANCES.encryptedSecrets,
      portDbDirect: SUPABASE_INSTANCES.portDbDirect,
      portPostgres: SUPABASE_INSTANCES.portPostgres,
    })
    .from(SUPABASE_INSTANCES)
    .where(eq(SUPABASE_INSTANCES.ref, ref))
    .limit(1);
  if (!inst) throw new Error(`instance ${ref} not found`);

  const [orgRow] = await db().select({ apex: ORG.apexDomain }).from(ORG).limit(1);
  if (!orgRow?.apex) throw new Error('apex domain not configured');
  const apex = orgRow.apex;

  const dbHostPort = inst.portDbDirect ?? inst.portPostgres;
  const secrets = decryptJson(inst.encryptedSecrets, loadMasterKey()) as { postgresPassword: string };
  const sniHostname = `pooler.${apex}`;

  await db()
    .insert(POOLER_TENANTS)
    .values({ instanceRef: ref, externalId: ref, sniHostname, status: 'registering' })
    .onConflictDoUpdate({
      target: POOLER_TENANTS.externalId,
      set: { status: 'registering', lastError: null, updatedAt: new Date() },
    });

  try {
    await supavisorRegister(ref, {
      dbHost: 'host.docker.internal',
      dbPort: dbHostPort,
      dbPassword: secrets.postgresPassword,
      sniHostname,
    });
    await db()
      .update(POOLER_TENANTS)
      .set({ status: 'active', lastError: null, updatedAt: new Date() })
      .where(eq(POOLER_TENANTS.externalId, ref));
  } catch (err) {
    const msg = (err as Error).message;
    await db()
      .update(POOLER_TENANTS)
      .set({ status: 'failed', lastError: msg, updatedAt: new Date() })
      .where(eq(POOLER_TENANTS.externalId, ref));
    throw err;
  }
}

async function unregisterTenantForInstance(ref: string): Promise<void> {
  try {
    await supavisorUnregisterTenant(ref);
  } catch (err) {
    logger.warn({ ref, err: (err as Error).message }, 'reconciler: supavisor unregister failed');
  } finally {
    await db().delete(POOLER_TENANTS).where(eq(POOLER_TENANTS.externalId, ref));
  }
}

// ─── Public surface ────────────────────────────────────────────────────────

export class ReconcilerInFlightError extends Error {
  code = 'previous_run_still_active' as const;
  constructor(public readonly inFlightRunId: string, public readonly inFlightStartedAt: Date) {
    super(
      `Reconciler run ${inFlightRunId} is already in progress (started ${inFlightStartedAt.toISOString()})`,
    );
  }
}

async function preflight(): Promise<void> {
  const cutoff = new Date(Date.now() - STALE_RUNNING_MS);
  await db()
    .update(RECONCILER_RUNS)
    .set({ status: 'failed', completedAt: new Date(), errorMessage: 'worker_crash_detected' })
    .where(and(eq(RECONCILER_RUNS.status, 'running'), lt(RECONCILER_RUNS.startedAt, cutoff)));
  await db().execute(sql`
    DELETE FROM reconciler_runs
     WHERE id NOT IN (
       SELECT id FROM reconciler_runs ORDER BY started_at DESC LIMIT ${RETAIN_RUNS}
     )
  `);
}

export async function startRun(
  triggerSource: 'cron' | 'manual',
  actorId?: string,
): Promise<{ runId: string }> {
  await preflight();
  try {
    const [row] = await db()
      .insert(RECONCILER_RUNS)
      .values({ status: 'running', triggerSource, actorId: actorId ?? null })
      .returning({ id: RECONCILER_RUNS.id });
    return { runId: row!.id };
  } catch (err) {
    const msg = (err as Error).message;
    if (/uq_reconciler_runs_one_running/.test(msg) || /unique constraint/i.test(msg)) {
      const [existing] = await db()
        .select({ id: RECONCILER_RUNS.id, startedAt: RECONCILER_RUNS.startedAt })
        .from(RECONCILER_RUNS)
        .where(eq(RECONCILER_RUNS.status, 'running'))
        .limit(1);
      throw new ReconcilerInFlightError(existing?.id ?? '?', existing?.startedAt ?? new Date());
    }
    throw err;
  }
}

export async function runFullReconcile(runId: string): Promise<void> {
  const startedAt = Date.now();

  const instances = await db()
    .select({ ref: SUPABASE_INSTANCES.ref, status: SUPABASE_INSTANCES.status })
    .from(SUPABASE_INSTANCES);

  const poolerRows = await db()
    .select({
      ref: POOLER_TENANTS.instanceRef,
      externalId: POOLER_TENANTS.externalId,
      status: POOLER_TENANTS.status,
      updatedAt: POOLER_TENANTS.updatedAt,
    })
    .from(POOLER_TENANTS);

  // Supavisor has no list endpoint; probe per-instance + per-orphan-candidate.
  // We need to check every ref we know about (from supabase_instances OR
  // pooler_tenants) since pooler_tenants might have stale rows.
  const allExternalIds = Array.from(
    new Set([
      ...instances.filter((i) => i.status !== 'deleting').map((i) => i.ref),
      ...poolerRows.map((p) => p.externalId),
    ]),
  );
  let supavisorTenants: SupavisorTenant[];
  try {
    supavisorTenants = await supavisorListExisting(allExternalIds);
  } catch (err) {
    await finishRun(runId, {
      status: 'failed',
      errorMessage: `supavisor_unreachable: ${(err as Error).message}`,
    });
    return;
  }

  type PoolerRow = { ref: string; externalId: string; status: string; updatedAt: Date };
  const instanceByRef = new Map<string, { ref: string; status: string }>(
    instances.map((i) => [i.ref, i]),
  );
  const poolerByExternalId = new Map<string, PoolerRow>(
    poolerRows.map((p) => [p.externalId, p as PoolerRow]),
  );
  const supavisorByExternalId = new Map<string, SupavisorTenant>(
    supavisorTenants.map((t) => [t.external_id, t]),
  );

  const results: PerInstanceResult[] = [];

  for (const inst of instances) {
    if (inst.status === 'deleting') continue;
    const cls = classifyInstance(
      inst,
      poolerByExternalId.get(inst.ref),
      supavisorByExternalId.get(inst.ref),
    );
    const result = await remediate(inst.ref, cls);
    results.push(result);
    if (poolerByExternalId.has(inst.ref)) {
      await db()
        .update(POOLER_TENANTS)
        .set({ lastReconciledAt: new Date() })
        .where(eq(POOLER_TENANTS.externalId, inst.ref));
    }
  }

  for (const svTenant of supavisorTenants) {
    if (instanceByRef.has(svTenant.external_id)) continue;
    const result = await remediate(svTenant.external_id, 'orphan_in_supavisor');
    results.push(result);
  }

  const counts = aggregate(results);
  const anyFailures = results.some((r) => r.error);
  const status: 'success' | 'partial_failure' = anyFailures ? 'partial_failure' : 'success';

  await finishRun(runId, {
    status,
    errorMessage: null,
    instancesSeen: instances.filter((i: { status: string }) => i.status !== 'deleting').length,
    actionsTaken: counts,
  });

  logger.info(
    { runId, ms: Date.now() - startedAt, instances: instances.length, ...counts },
    'pooler-reconciler: run complete',
  );
}

export async function runSingleInstanceReconcile(
  runId: string,
  ref: string,
): Promise<PerInstanceResult> {
  const [inst] = await db()
    .select({ ref: SUPABASE_INSTANCES.ref, status: SUPABASE_INSTANCES.status })
    .from(SUPABASE_INSTANCES)
    .where(eq(SUPABASE_INSTANCES.ref, ref))
    .limit(1);
  if (!inst) {
    await finishRun(runId, { status: 'failed', errorMessage: `instance_not_found: ${ref}` });
    return { ref, classification: 'instance_gone', remediated: false, error: 'not_found' };
  }
  const [poolerRow] = await db()
    .select({
      ref: POOLER_TENANTS.instanceRef,
      externalId: POOLER_TENANTS.externalId,
      status: POOLER_TENANTS.status,
      updatedAt: POOLER_TENANTS.updatedAt,
    })
    .from(POOLER_TENANTS)
    .where(eq(POOLER_TENANTS.externalId, ref))
    .limit(1);
  let svTenant: SupavisorTenant | undefined;
  try {
    const result = await supavisorGetTenant(ref);
    svTenant = result ?? undefined;
  } catch (err) {
    await finishRun(runId, {
      status: 'failed',
      errorMessage: `supavisor_unreachable: ${(err as Error).message}`,
    });
    return { ref, classification: 'consistent', remediated: false, error: 'supavisor_unreachable' };
  }
  const cls = classifyInstance(inst, poolerRow, svTenant);
  const result = await remediate(ref, cls);
  if (poolerRow) {
    await db()
      .update(POOLER_TENANTS)
      .set({ lastReconciledAt: new Date() })
      .where(eq(POOLER_TENANTS.externalId, ref));
  }
  await finishRun(runId, {
    status: result.error ? 'partial_failure' : 'success',
    errorMessage: null,
    instancesSeen: 1,
    actionsTaken: aggregate([result]),
  });
  return result;
}

function classifyInstance(
  inst: { ref: string; status: string },
  poolerRow:
    | { ref: string; externalId: string; status: string; updatedAt: Date }
    | undefined,
  svTenant: SupavisorTenant | undefined,
): Classification {
  if (inst.status === 'deleting') return 'instance_gone';
  if (!poolerRow) return 'missing_pooler_row';
  if (poolerRow.status === 'pg_password_drift') return 'pg_password_drift';
  if (poolerRow.status === 'failed') {
    const ageMs = Date.now() - poolerRow.updatedAt.getTime();
    if (ageMs > STALE_FAILED_MS) return 'failed_stale';
    return 'consistent';
  }
  if (poolerRow.status === 'active' && !svTenant) return 'missing_in_supavisor';
  return 'consistent';
}

async function remediate(ref: string, classification: Classification): Promise<PerInstanceResult> {
  try {
    switch (classification) {
      case 'consistent':
        return { ref, classification, remediated: false };
      case 'missing_pooler_row':
      case 'missing_in_supavisor':
        await registerTenantForInstance(ref);
        await emitEvent(ref, 'reconciler.registered_missing', { classification });
        return { ref, classification, remediated: true };
      case 'failed_stale': {
        try {
          await registerTenantForInstance(ref);
          await emitEvent(ref, 'reconciler.retry_succeeded', {});
          return { ref, classification, remediated: true };
        } catch (err) {
          await emitEvent(ref, 'reconciler.retry_failed', { error: (err as Error).message });
          await maybePromoteToDrift(ref, (err as Error).message);
          return {
            ref,
            classification,
            remediated: false,
            error: (err as Error).message,
          };
        }
      }
      case 'pg_password_drift': {
        try {
          await registerTenantForInstance(ref);
          await emitEvent(ref, 'password_reset_then_registered', {});
          return { ref, classification, remediated: true };
        } catch (err) {
          return {
            ref,
            classification,
            remediated: false,
            error: (err as Error).message,
          };
        }
      }
      case 'instance_gone':
        await unregisterTenantForInstance(ref);
        await emitEvent(ref, 'reconciler.unregistered_deleting', {});
        return { ref, classification, remediated: true };
      case 'orphan_in_supavisor':
        await supavisorUnregisterTenant(ref);
        await emitEvent(ref, 'reconciler.unregistered_orphan', {});
        return { ref, classification, remediated: true };
    }
  } catch (err) {
    return { ref, classification, remediated: false, error: (err as Error).message };
  }
}

async function maybePromoteToDrift(ref: string, errMsg: string): Promise<void> {
  const looksAuth = /28P01|password authentication failed|auth failed/i.test(errMsg);
  if (!looksAuth) return;
  const probe = await probeAuthForInstance(ref);
  if (!probe.ok && probe.isAuthClass) {
    await db()
      .update(POOLER_TENANTS)
      .set({
        status: 'pg_password_drift',
        lastError: probe.error ?? errMsg,
        updatedAt: new Date(),
      })
      .where(eq(POOLER_TENANTS.externalId, ref));
    await emitEvent(ref, 'reconciler.password_drift_detected', { error: probe.error });
  }
}

async function emitEvent(
  externalId: string,
  event: string,
  detail: Record<string, unknown>,
): Promise<void> {
  await db().insert(POOLER_EVENTS).values({ externalId, event, detail });
}

function aggregate(results: PerInstanceResult[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const r of results) {
    if (!r.remediated && !r.error) continue;
    const key = r.classification;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

async function finishRun(
  runId: string,
  opts: {
    status: 'success' | 'partial_failure' | 'failed';
    errorMessage?: string | null;
    instancesSeen?: number;
    actionsTaken?: Record<string, number>;
  },
): Promise<void> {
  await db()
    .update(RECONCILER_RUNS)
    .set({
      status: opts.status,
      completedAt: new Date(),
      errorMessage: opts.errorMessage ?? null,
      instancesSeen: opts.instancesSeen ?? 0,
      actionsTaken: opts.actionsTaken ?? {},
    })
    .where(eq(RECONCILER_RUNS.id, runId));
}
