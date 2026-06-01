/**
 * POST /api/v1/projects/<ref>/vault/enable — dashboard button (FR-002).
 *
 * Enqueues the worker's vault-enable job for `ref`. Idempotent: if a job is
 * already in flight for this ref, returns its id with queued=false instead
 * of double-enqueueing.
 *
 * Spec: 010-secrets-management — contracts/api-secrets-dashboard.md, T017.
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { enqueueVaultEnable, findInFlightVaultEnable } from '../services/vault-enable-client.js';

export const vaultEnableRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string } }>(
    '/api/v1/projects/:ref/vault/enable',
    async (req, reply) => {
      app.authorize(req, 'instance.vault.enable');
      app.requireAuth(req);

      const { ref } = req.params;

      const [inst] = await db()
        .select({
          ref: schema.supabaseInstances.ref,
          status: schema.supabaseInstances.status,
        })
        .from(schema.supabaseInstances)
        .where(eq(schema.supabaseInstances.ref, ref))
        .limit(1);

      if (!inst) {
        return reply.status(404).send({
          error: { code: 'instance_not_found', message: `Instance ${ref} not found.` },
        });
      }

      if (inst.status === 'paused' || inst.status === 'stopped' || inst.status === 'deleting') {
        return reply.status(409).send({
          error: {
            code: 'instance_not_runnable',
            message: `Cannot enable vault on instance in status '${inst.status}'. Resume the project first.`,
            details: { status: inst.status },
          },
        });
      }

      const inFlight = await findInFlightVaultEnable(ref);
      if (inFlight) {
        return reply.status(202).send({
          jobId: inFlight,
          queued: false,
          ref,
        });
      }

      const jobId = await enqueueVaultEnable({ ref, source: 'dashboard-button' });
      return reply.status(202).send({
        jobId,
        queued: true,
        ref,
      });
    },
  );
};
