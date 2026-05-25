import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import { issuePerProjectCert } from '../services/acme.js';

/**
 * Internal endpoint the worker hits to issue/renew a per-project ACME cert
 * for db.<ref>.<apex>. The acme client + the HTTP-01 challenge token map
 * MUST live in the api process (Fastify route at /.well-known/acme-challenge/:token
 * reads from the same map). Worker delegates here.
 *
 * Internal network only (sibling of /internal/caddy/reload). No auth.
 */
export const pgEdgeCertInternalRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Body: { ref: string } }>('/internal/pg-edge-cert/issue', async (req, reply) => {
    const ref = req.body?.ref;
    if (!ref || !/^[a-z]{20}$/.test(ref)) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'invalid ref' } });
    }

    const [orgRow] = await db().select({ apex: schema.org.apexDomain }).from(schema.org).limit(1);
    if (!orgRow?.apex) {
      return reply.status(409).send({
        error: { code: 'no_apex', message: 'apex domain not configured' },
      });
    }

    // Confirm the instance exists and isn't being deleted.
    const [instRow] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!instRow) {
      return reply
        .status(404)
        .send({ error: { code: 'not_found', message: 'instance not found' } });
    }
    if (instRow.status === 'deleting') {
      return reply
        .status(409)
        .send({ error: { code: 'deleting', message: 'instance is being deleted' } });
    }

    try {
      const result = await issuePerProjectCert(ref, orgRow.apex);
      return reply.send({ hostname: result.hostname, notAfter: result.notAfter.toISOString() });
    } catch (err) {
      app.log.error({ err, ref }, 'per-project cert issuance failed');
      return reply.status(503).send({
        error: { code: 'acme_failed', message: (err as Error).message.slice(0, 300) },
      });
    }
  });
};
