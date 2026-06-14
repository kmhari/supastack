/**
 * Feature 116 — admin ops console read-only endpoints (/api/v1/admin/*).
 * Installation-wide, admin-only (owner/administrator) via app.authorize. The api
 * is a pure reader: DB tables + Redis (BullMQ) + the existing per-instance log
 * proxy + delegation to platform endpoints. No docker/host access here (that is
 * the worker observer's job). Every handler degrades to an empty shape on a
 * missing/empty source rather than 500 (FR-030).
 */
import type { FastifyPluginAsync } from 'fastify';
import { desc, eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { getApex } from '@supastack/shared';
import { queryLogs, type LogService } from '../services/logflare-client.js';
import { inspectQueues } from '../services/queue-inspector.js';

const VERSION = process.env.SUPASTACK_VERSION ?? 'dev';

function apexOf(): string | null {
  return getApex();
}

function daysLeft(notAfter: Date | null): number | null {
  if (!notAfter) return null;
  return Math.floor((notAfter.getTime() - Date.now()) / 86_400_000);
}

export const adminRoutes: FastifyPluginAsync = async (app) => {
  // ── US2: fleet ────────────────────────────────────────────────────────────
  app.get('/admin/fleet', async (req, reply) => {
    app.authorize(req, 'admin.console.read');
    const apex = await apexOf();
    const rows = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        name: schema.supabaseInstances.name,
        orgId: schema.supabaseInstances.orgId,
        status: schema.supabaseInstances.status,
        createdAt: schema.supabaseInstances.createdAt,
      })
      .from(schema.supabaseInstances)
      .orderBy(desc(schema.supabaseInstances.createdAt));
    const orgs = await db()
      .select({ id: schema.organizations.id, name: schema.organizations.name })
      .from(schema.organizations);
    const orgName = new Map(orgs.map((o) => [o.id, o.name]));
    return reply.send({
      projects: rows.map((r) => ({
        ref: r.ref,
        name: r.name,
        org: orgName.get(r.orgId) ?? r.orgId,
        status: r.status,
        createdAt: r.createdAt,
        endpoints: { api: apex ? `https://${r.ref}.${apex}` : '' },
      })),
    });
  });

  // ── US2: per-project detail (delegates service health to the platform API) ──
  app.get<{ Params: { ref: string } }>('/admin/projects/:ref', async (req, reply) => {
    app.authorize(req, 'admin.console.read');
    const { ref } = req.params;
    const [inst] = await db()
      .select({
        ref: schema.supabaseInstances.ref,
        status: schema.supabaseInstances.status,
        version: schema.supabaseInstances.supabaseVersion,
      })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: 'Project not found' });

    // Per-service health is derived from the instance status (installation-wide;
    // not org-scoped). The platform /services endpoint synthesizes the same thing
    // (all services = instance status) but requires org membership, so we compute
    // it directly here for the installation-admin view.
    const running = inst.status === 'running';
    const SERVICES = [
      'kong',
      'auth',
      'rest',
      'storage',
      'realtime',
      'meta',
      'functions',
      'analytics',
      'imgproxy',
      'studio',
    ];
    return reply.send({
      ref: inst.ref,
      status: inst.status,
      version: inst.version,
      services: SERVICES.map((name) => ({ name, healthy: running })),
      database: { status: running ? 'ACTIVE_HEALTHY' : 'UNAVAILABLE' },
    });
  });

  // ── US2: control-plane system status ───────────────────────────────────────
  app.get('/admin/system', async (req, reply) => {
    app.authorize(req, 'admin.console.read');
    const snaps = await db()
      .select()
      .from(schema.controlPlaneSnapshots)
      .orderBy(schema.controlPlaneSnapshots.container);
    const capturedAt = snaps.reduce<string | null>(
      (max, s) =>
        s.capturedAt && (!max || s.capturedAt.toISOString() > max)
          ? s.capturedAt.toISOString()
          : max,
      null,
    );
    return reply.send({
      deployedCommit: VERSION,
      capturedAt,
      components: snaps.map((s) => ({
        container: s.container,
        health: s.health,
        status: s.status,
        image: s.image,
      })),
    });
  });

  // ── US2: logs (project via proxy / control-plane via snapshot) ─────────────
  app.get<{ Querystring: { source?: string; tail?: string } }>(
    '/admin/logs',
    async (req, reply) => {
      app.authorize(req, 'admin.console.read');
      const source = req.query.source ?? '';
      const tail = Math.min(500, Number(req.query.tail ?? 200) || 200);

      if (source.startsWith('control-plane:')) {
        const container = source.slice('control-plane:'.length);
        const [snap] = await db()
          .select()
          .from(schema.controlPlaneSnapshots)
          .where(eq(schema.controlPlaneSnapshots.container, container))
          .limit(1);
        const lines = (snap?.logTail ?? '').split('\n').filter(Boolean).slice(-tail);
        return reply.send({
          source,
          capturedAt: snap?.capturedAt?.toISOString() ?? null,
          fresh: false,
          lines,
        });
      }

      // project:<ref>:<service>
      const m = source.match(/^project:([a-z0-9]{20}):([a-z-]+)$/);
      if (m) {
        const [, ref, service] = m;
        try {
          const rows = await queryLogs(ref!, { service: service as LogService });
          return reply.send({
            source,
            capturedAt: new Date().toISOString(),
            fresh: true,
            lines: rows
              .map((r) => `${r.timestamp ?? ''} ${r.event_message ?? ''}`.trim())
              .slice(-tail),
          });
        } catch {
          return reply.send({ source, capturedAt: null, fresh: true, lines: [] });
        }
      }

      return reply.send({ source, capturedAt: null, fresh: true, lines: [] });
    },
  );

  // ── US3: resources ─────────────────────────────────────────────────────────
  app.get('/admin/resources', async (req, reply) => {
    app.authorize(req, 'admin.resources.read');
    const [latest] = await db()
      .select({ capturedAt: schema.resourceSamples.capturedAt })
      .from(schema.resourceSamples)
      .orderBy(desc(schema.resourceSamples.capturedAt))
      .limit(1);
    if (!latest) return reply.send({ capturedAt: null, collecting: true });

    const rows = await db()
      .select()
      .from(schema.resourceSamples)
      .where(eq(schema.resourceSamples.capturedAt, latest.capturedAt));
    const host = rows.find((r) => r.scope === 'host');
    const projects = rows.filter((r) => r.scope === 'project');
    const avg = projects.length
      ? {
          memUsedBytes: Math.round(
            projects.reduce((a, p) => a + (p.memUsedBytes ?? 0), 0) / projects.length,
          ),
          diskUsedBytes: Math.round(
            projects.reduce((a, p) => a + (p.diskUsedBytes ?? 0), 0) / projects.length,
          ),
        }
      : { memUsedBytes: 0, diskUsedBytes: 0 };

    return reply.send({
      capturedAt: latest.capturedAt.toISOString(),
      host: {
        cpuPct: host ? Number(host.cpuPct) : null,
        memUsedBytes: host?.memUsedBytes ?? null,
        memLimitBytes: host?.memLimitBytes ?? null,
        disk: host?.diskBreakdown ?? null,
      },
      projects: projects.map((p) => ({
        ref: p.ref,
        cpuPct: p.cpuPct ? Number(p.cpuPct) : null,
        memUsedBytes: p.memUsedBytes,
        diskUsedBytes: p.diskUsedBytes,
      })),
      avgProjectFootprint: avg,
    });
  });

  app.get<{ Params: { ref: string }; Querystring: { window?: string } }>(
    '/admin/resources/:ref/trend',
    async (req, reply) => {
      app.authorize(req, 'admin.resources.read');
      const hours = req.query.window === '1h' ? 1 : req.query.window === '7d' ? 168 : 24;
      const since = new Date(Date.now() - hours * 3_600_000);
      const rows = await db()
        .select()
        .from(schema.resourceSamples)
        .where(eq(schema.resourceSamples.ref, req.params.ref))
        .orderBy(schema.resourceSamples.capturedAt);
      return reply.send({
        ref: req.params.ref,
        samples: rows
          .filter((r) => r.capturedAt >= since)
          .map((r) => ({
            t: r.capturedAt.toISOString(),
            cpuPct: r.cpuPct ? Number(r.cpuPct) : null,
            memUsedBytes: r.memUsedBytes,
            diskUsedBytes: r.diskUsedBytes,
          })),
      });
    },
  );

  // ── US4: queues ─────────────────────────────────────────────────────────────
  app.get('/admin/queues', async (req, reply) => {
    app.authorize(req, 'admin.queues.read');
    try {
      const queues = await inspectQueues(10);
      return reply.send({ queues });
    } catch {
      return reply.send({ queues: [] });
    }
  });

  // ── US5: certs / dns / backups ──────────────────────────────────────────────
  app.get('/admin/certs', async (req, reply) => {
    app.authorize(req, 'admin.certs.read');
    const apex = await apexOf();
    const [wc] = await db().select().from(schema.wildcardCerts).limit(1);
    const perProjectCerts = await db().select().from(schema.pgEdgeCerts);
    const backups = await db()
      .select()
      .from(schema.backups)
      .orderBy(desc(schema.backups.completedAt));

    const latestBackup = new Map<string, (typeof backups)[number]>();
    let totalStorage = 0;
    for (const b of backups) {
      totalStorage += b.sizeBytes ?? 0;
      if (!latestBackup.has(b.instanceRef)) latestBackup.set(b.instanceRef, b);
    }

    const wildcardReady = (wc?.status ?? '') === 'issued';
    return reply.send({
      wildcard: wc
        ? {
            apex: wc.apex,
            notAfter: wc.notAfter?.toISOString() ?? null,
            daysLeft: daysLeft(wc.notAfter ?? null),
            renewalWarning: wc.renewalDue ?? (daysLeft(wc.notAfter ?? null) ?? 99) < 30,
          }
        : apex
          ? { apex, notAfter: null, daysLeft: null, renewalWarning: false }
          : null,
      perProject: perProjectCerts.map((c) => ({
        ref: c.instanceRef,
        notAfter: c.notAfter?.toISOString() ?? null,
        daysLeft: daysLeft(c.notAfter ?? null),
        status: c.status,
      })),
      // DNS record readiness is derived from wildcard issuance (cert issuance
      // requires DNS-01 validation to have passed for apex + wildcard).
      dns: { apexReady: wildcardReady, wildcardReady },
      backups: {
        totalStorageBytes: totalStorage,
        perProject: [...latestBackup.values()].map((b) => ({
          ref: b.instanceRef,
          lastBackupAt: b.completedAt?.toISOString() ?? b.startedAt?.toISOString() ?? null,
          sizeBytes: b.sizeBytes,
          outcome: b.status,
        })),
      },
    });
  });
};
