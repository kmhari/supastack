/**
 * Pooler status endpoint — GET /api/v1/pooler/status (feature 008 US2).
 *
 * Aggregates supavisor health + per-project tenant state + recent events +
 * recent reconciler runs into one shape for the dashboard panel.
 */
import type { FastifyPluginAsync } from 'fastify';
import { desc } from 'drizzle-orm';
import { fetch } from 'undici';
import crypto from 'node:crypto';
import { db, schema } from '@selfbase/db';

const SUPAVISOR_URL = process.env.SUPAVISOR_URL ?? 'http://supavisor:4000';
const SUPAVISOR_JWT_SECRET = process.env.SUPAVISOR_API_JWT_SECRET ?? '';

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

async function supavisorHealth(): Promise<{ reachable: boolean; status?: number }> {
  try {
    const res = await fetch(`${SUPAVISOR_URL}/api/health`, {
      signal: AbortSignal.timeout(3000),
    });
    return { reachable: res.ok, status: res.status };
  } catch {
    return { reachable: false };
  }
}

async function supavisorHasTenant(externalId: string): Promise<boolean | null> {
  try {
    const res = await fetch(`${SUPAVISOR_URL}/api/tenants/${externalId}`, {
      headers: { authorization: `Bearer ${supavisorJwt()}` },
      signal: AbortSignal.timeout(3000),
    });
    if (res.status === 404) return false;
    if (res.ok) return true;
    return null;
  } catch {
    return null;
  }
}

export const poolerStatusRoutes: FastifyPluginAsync = async (app) => {
  app.get('/api/v1/pooler/status', async (req) => {
    app.authorize(req, 'pooler.read');

    const [orgRow] = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
    const apex = orgRow?.apex ?? null;
    const endpoint = apex ? `pooler.${apex}:6543` : null;

    const health = await supavisorHealth();

    const instances = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        name: schema.supabaseInstances.name,
        status: schema.supabaseInstances.status,
      })
      .from(schema.supabaseInstances);

    const tenants = await db()
      .select({
        externalId: schema.poolerTenants.externalId,
        status: schema.poolerTenants.status,
        lastError: schema.poolerTenants.lastError,
        registeredAt: schema.poolerTenants.registeredAt,
        lastReconciledAt: schema.poolerTenants.lastReconciledAt,
      })
      .from(schema.poolerTenants);

    const tenantByRef = new Map(tenants.map((t) => [t.externalId, t]));

    // Per-project rows include supavisor presence (parallel probes for
    // running instances only — paused/failed projects' supavisor state
    // is uninteresting until they resume).
    const projects = await Promise.all(
      instances.map(async (inst) => {
        const tenant = tenantByRef.get(inst.ref);
        const supavisorPresent =
          inst.status === 'running' && health.reachable ? await supavisorHasTenant(inst.ref) : null;
        return {
          ref: inst.ref,
          name: inst.name,
          instance_status: inst.status,
          tenant_status: tenant?.status ?? null,
          last_error: tenant?.lastError ?? null,
          last_reconciled_at: tenant?.lastReconciledAt?.toISOString() ?? null,
          registered_at: tenant?.registeredAt?.toISOString() ?? null,
          supavisor_present: supavisorPresent,
        };
      }),
    );

    const recentEvents = await db()
      .select({
        id: schema.poolerEvents.id,
        externalId: schema.poolerEvents.externalId,
        event: schema.poolerEvents.event,
        detail: schema.poolerEvents.detail,
        createdAt: schema.poolerEvents.createdAt,
      })
      .from(schema.poolerEvents)
      .orderBy(desc(schema.poolerEvents.createdAt))
      .limit(50);

    const recentRuns = await db()
      .select({
        id: schema.reconcilerRuns.id,
        startedAt: schema.reconcilerRuns.startedAt,
        completedAt: schema.reconcilerRuns.completedAt,
        status: schema.reconcilerRuns.status,
        instancesSeen: schema.reconcilerRuns.instancesSeen,
        actionsTaken: schema.reconcilerRuns.actionsTaken,
        triggerSource: schema.reconcilerRuns.triggerSource,
      })
      .from(schema.reconcilerRuns)
      .orderBy(desc(schema.reconcilerRuns.startedAt))
      .limit(30);

    void req;
    return {
      supavisor: { reachable: health.reachable, healthcheck_status: health.status ?? null },
      endpoint,
      projects,
      recent_events: recentEvents.map((e) => ({
        id: e.id,
        ref: e.externalId,
        event: e.event,
        detail: e.detail,
        created_at: e.createdAt.toISOString(),
      })),
      recent_runs: recentRuns.map((r) => ({
        id: r.id,
        started_at: r.startedAt.toISOString(),
        completed_at: r.completedAt?.toISOString() ?? null,
        status: r.status,
        instances_seen: r.instancesSeen,
        actions_taken: r.actionsTaken,
        trigger_source: r.triggerSource,
      })),
    };
  });
};
