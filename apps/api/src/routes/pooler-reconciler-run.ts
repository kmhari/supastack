/**
 * Manual reconciler trigger — POST /api/v1/pooler/reconciler/run (US1).
 *
 * Returns 202 with the new run id, or 409 if another run is already in flight.
 * Heavy lifting happens in the worker (apps/worker/src/services/pooler-reconciler.ts).
 */
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { db, schema } from '@selfbase/db';
import { enqueueReconcilerJob, findInFlightRun } from '../services/pooler-reconciler-client.js';

export const poolerReconcilerRunRoutes: FastifyPluginAsync = async (app) => {
  app.post('/api/v1/pooler/reconciler/run', async (req, reply) => {
    app.authorize(req, 'pooler.reconciler.run');
    const user = app.requireAuth(req);

    // Pre-check: 409 if a run is already in flight (the worker's INSERT also
    // enforces this via partial unique index, but checking here avoids a
    // pointless Redis round-trip + lets us return useful state in the 409).
    const inFlight = await findInFlightRun();
    if (inFlight) {
      return reply.status(409).send({
        error: {
          code: 'previous_run_still_active',
          message: 'Another reconciler run is already in progress.',
          details: { run_id: inFlight.id, started_at: inFlight.startedAt.toISOString() },
        },
      });
    }

    // Reserve a run id by INSERTing the row from the api side. The worker
    // updates it. If a concurrent run snuck in between findInFlightRun() and
    // here, the unique index throws — translate to 409.
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
        const inFlight2 = await findInFlightRun();
        return reply.status(409).send({
          error: {
            code: 'previous_run_still_active',
            message: 'Another reconciler run is already in progress.',
            details: {
              run_id: inFlight2?.id,
              started_at: inFlight2?.startedAt.toISOString(),
            },
          },
        });
      }
      throw err;
    }

    await enqueueReconcilerJob({
      mode: 'full',
      triggerSource: 'manual',
      actorId: user.id,
      runId,
    });

    // TODO(feature 008): emit audit_log entry `pooler.reconciler.manual_trigger`
    // once the audit-log service is in scope for this feature.

    return reply.status(202).send({
      run_id: runId,
      status: 'running',
      started_at: new Date().toISOString(),
      message: 'Reconciler run started. Poll /api/v1/pooler/status for live state.',
    });
  });
};
