/**
 * Manual single-tenant re-register — POST /api/v1/pooler/tenants/:ref/re-register
 * (feature 008 US2).
 *
 * Synchronous: enqueues a single-instance reconciler pass with forceRetry
 * semantics, waits up to 5s for completion, returns final state. Operator
 * UX expectation is immediate green/red feedback.
 */
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { enqueueReconcilerJob } from '../services/pooler-reconciler-client.js';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5000;

export const poolerReregisterRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string } }>(
    '/api/v1/pooler/tenants/:ref/re-register',
    async (req, reply) => {
      app.authorize(req, 'pooler.reregister');
      const user = app.requireAuth(req);
      const ref = req.params.ref;

      const [inst] = await db()
        .select({ ref: schema.supabaseInstances.ref, status: schema.supabaseInstances.status })
        .from(schema.supabaseInstances)
        .where(eq(schema.supabaseInstances.ref, ref))
        .limit(1);
      if (!inst) {
        return reply.status(404).send({
          error: { code: 'not_found', message: 'Project not found', details: { ref } },
        });
      }
      if (inst.status !== 'running' && inst.status !== 'failed') {
        return reply.status(409).send({
          error: {
            code: 'project_not_running',
            message: `Cannot re-register tenant — project status is '${inst.status}'`,
            details: { status: inst.status },
          },
        });
      }

      // Pre-allocate runId so partial unique index handles concurrent triggers.
      let runId: string;
      try {
        const [row] = await db()
          .insert(schema.reconcilerRuns)
          .values({
            id: randomUUID(),
            status: 'running',
            triggerSource: 'manual',
            actorId: user.id,
          })
          .returning({ id: schema.reconcilerRuns.id });
        runId = row!.id;
      } catch (err) {
        const msg = (err as Error).message;
        if (/uq_reconciler_runs_one_running/.test(msg) || /unique constraint/i.test(msg)) {
          return reply.status(409).send({
            error: {
              code: 'previous_run_still_active',
              message: 'Another reconciler run is already in progress.',
            },
          });
        }
        throw err;
      }

      await enqueueReconcilerJob({ mode: 'single', ref, runId }, 5);

      // Poll for completion.
      const deadline = Date.now() + POLL_TIMEOUT_MS;
      let completed = false;
      while (Date.now() < deadline) {
        const [r] = await db()
          .select({ status: schema.reconcilerRuns.status })
          .from(schema.reconcilerRuns)
          .where(eq(schema.reconcilerRuns.id, runId))
          .limit(1);
        if (r && r.status !== 'running') {
          completed = true;
          break;
        }
        await new Promise((res) => setTimeout(res, POLL_INTERVAL_MS));
      }

      const [tenant] = await db()
        .select({
          status: schema.poolerTenants.status,
          lastError: schema.poolerTenants.lastError,
        })
        .from(schema.poolerTenants)
        .where(eq(schema.poolerTenants.externalId, ref))
        .limit(1);

      return reply.status(200).send({
        ref,
        tenant_status: tenant?.status ?? null,
        last_error: tenant?.lastError ?? null,
        reconciler_run_id: runId,
        completed_within_window: completed,
      });
    },
  );
};
