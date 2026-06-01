import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import {
  registerTenantForInstance,
  unregisterTenantForInstance,
} from '../services/pooler-tenants.js';

/**
 * Internal endpoints for supavisor tenant lifecycle (feature 005 Phase 5).
 * Called by the worker after instance provision/destroy. No auth — Docker
 * internal network only.
 */
export const poolerInternalRoutes: FastifyPluginAsync = async (app) => {
  // POST /internal/pooler/tenants {ref}
  app.post<{ Body: { ref: string } }>('/internal/pooler/tenants', async (req, reply) => {
    const ref = req.body?.ref;
    if (!ref || !/^[a-z]{20}$/.test(ref)) {
      return reply.status(400).send({ error: { code: 'bad_request', message: 'invalid ref' } });
    }
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!inst) return reply.status(404).send({ error: { code: 'not_found' } });
    if (inst.status === 'deleting') return reply.status(409).send({ error: { code: 'deleting' } });
    try {
      await registerTenantForInstance(ref);
      return reply.send({ ref, status: 'registered' });
    } catch (err) {
      app.log.error({ err, ref }, 'pooler tenant registration failed');
      return reply.status(503).send({
        error: { code: 'pooler_register_failed', message: (err as Error).message.slice(0, 300) },
      });
    }
  });

  // DELETE /internal/pooler/tenants/:ref
  app.delete<{ Params: { ref: string } }>('/internal/pooler/tenants/:ref', async (req, reply) => {
    if (!/^[a-z]{20}$/.test(req.params.ref)) {
      return reply.status(400).send({ error: { code: 'bad_request' } });
    }
    try {
      await unregisterTenantForInstance(req.params.ref);
      return reply.status(204).send();
    } catch (err) {
      app.log.warn({ err, ref: req.params.ref }, 'pooler tenant unregister failed');
      return reply.status(503).send({
        error: { code: 'pooler_unregister_failed', message: (err as Error).message.slice(0, 300) },
      });
    }
  });
};
