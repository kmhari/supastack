import type { FastifyPluginAsync } from 'fastify';
import { eq, desc } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import {
  initiateWildcardOrder,
  verifyAndFinalize,
  checkDns,
  loadRow,
  computeAllDnsReady,
} from '../services/acme.js';
import { reloadCaddy } from '../services/caddy-reload.js';
import { errors } from '@supastack/shared';

export const wildcardCertRoutes: FastifyPluginAsync = async (app) => {
  // POST /wildcard-certs/initiate — start (or restart) a DNS-01 ACME order
  app.post('/wildcard-certs/initiate', async (req, reply) => {
    app.authorize(req, 'org.update');
    const user = app.requireAuth(req);

    const [orgRow] = await db()
      .select({ apex: schema.installation.apexDomain })
      .from(schema.installation)
      .limit(1);
    if (!orgRow?.apex) {
      throw errors.conflict('Apex domain must be set before requesting a wildcard certificate');
    }

    // Get admin email from requesting user
    const [userRow] = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    const email = userRow?.email ?? 'admin@selfbase.local';

    const result = await initiateWildcardOrder(null, orgRow.apex, email);
    return reply.status(201).send(result);
  });

  // POST /wildcard-certs/verify — check DNS then complete ACME challenge
  app.post('/wildcard-certs/verify', async (req, reply) => {
    app.authorize(req, 'org.update');

    const [orgRow] = await db().select({ apex: schema.installation.apexDomain }).from(schema.installation).limit(1);
    if (!orgRow?.apex) throw errors.conflict('No apex domain configured');

    const row = await loadRow(orgRow.apex);
    if (!row) {
      throw errors.notFound('No pending wildcard cert order. Call /initiate first.');
    }
    if (row.status === 'disabled') {
      throw errors.conflict('Certificate is disabled. Call /initiate to start a new order.');
    }

    const result = await verifyAndFinalize(orgRow.apex);

    if (result.status === 'issued') {
      try {
        await reloadCaddy();
      } catch (err) {
        req.log.warn({ err }, 'caddy reload after cert issuance failed');
      }
    }

    return reply.send(result);
  });

  // GET /wildcard-certs/status — live status for wizard polling and dashboard
  app.get('/wildcard-certs/status', async (req, reply) => {
    app.authorize(req, 'org.read');

    const [orgRow] = await db()
      .select({ id: schema.installation.id, apex: schema.installation.apexDomain })
      .from(schema.installation)
      .limit(1);
    if (!orgRow?.apex) return reply.send({ cert: null });

    const row = await loadRow(orgRow.apex);
    if (!row) return reply.send({ cert: null });

    // For awaiting_dns: refresh DNS check live so the UI shows current propagation state
    let dnsChecks: { name: string; value: string; found: boolean }[] | undefined;
    let allDnsReady: boolean | undefined;
    if (row.status === 'awaiting_dns' || row.status === 'verifying') {
      const challengeRecords = row.challengeRecords as { name: string; value: string }[];
      dnsChecks = await checkDns(challengeRecords);
      allDnsReady = computeAllDnsReady(dnsChecks);
    }

    const history = await db()
      .select()
      .from(schema.certRenewalEvents)
      .where(eq(schema.certRenewalEvents.certId, row.id))
      .orderBy(desc(schema.certRenewalEvents.startedAt))
      .limit(10);

    return reply.send({
      cert: {
        apex: row.apex,
        status: row.status,
        challengeRecords: (row.challengeRecords as { name: string; value: string }[]) ?? [],
        dnsChecks,
        allDnsReady,
        notBefore: row.notBefore?.toISOString() ?? null,
        notAfter: row.notAfter?.toISOString() ?? null,
        renewalDue: row.renewalDue,
        issuedAt: row.issuedAt?.toISOString() ?? null,
        lastError: row.lastError ?? null,
        renewalHistory: history.map((h) => ({
          triggeredBy: h.triggeredBy,
          outcome: h.outcome,
          errorMessage: h.errorMessage ?? null,
          certNotAfter: h.certNotAfter?.toISOString() ?? null,
          startedAt: h.startedAt.toISOString(),
          finishedAt: h.finishedAt?.toISOString() ?? null,
        })),
      },
    });
  });

  // DELETE /wildcard-certs — disable wildcard and revert Caddy to on-demand TLS
  app.delete('/wildcard-certs', async (req, reply) => {
    app.authorize(req, 'org.update');
    const user = app.requireAuth(req);

    const [orgRow] = await db()
      .select({ id: schema.installation.id, apex: schema.installation.apexDomain })
      .from(schema.installation)
      .limit(1);
    if (!orgRow?.apex) return reply.status(204).send();

    const row = await loadRow(orgRow.apex);
    if (!row) throw errors.notFound('No wildcard certificate configured');

    await db()
      .update(schema.wildcardCerts)
      .set({ status: 'disabled', updatedAt: new Date(), updatedBy: user.id })
      .where(eq(schema.wildcardCerts.apex, orgRow.apex));

    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: user.id,
        action: 'tls.disabled',
        targetKind: 'wildcard_cert',
        targetId: row.id,
        payload: { apex: orgRow.apex },
      });

    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload after wildcard disable failed');
    }

    return reply.status(204).send();
  });
};
