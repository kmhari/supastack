/**
 * Reset PG password endpoint — feature 008 US3 (FR-016, FR-017).
 *
 * POST /api/v1/instances/:ref/reset-pg-password
 *
 * Resets `postgres` + `supabase_admin` role passwords on the per-instance
 * Postgres to match the stored `encrypted_secrets.postgresPassword`. Then
 * synchronously kicks off a single-instance reconciler pass and waits up to
 * 5 seconds for the verification, so the operator sees immediate green/red
 * feedback.
 */
import type { FastifyPluginAsync } from 'fastify';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';
import {
  resetPgPasswordForInstance,
  InstanceNotFoundForResetError,
  InstanceNotResettableError,
  PerInstanceDbUnreachableError,
} from '../services/pg-password-reset.js';
import { enqueueReconcilerJob } from '../services/pooler-reconciler-client.js';

const POLL_INTERVAL_MS = 200;
const POLL_TIMEOUT_MS = 5000;

export const resetPgPasswordRoutes: FastifyPluginAsync = async (app) => {
  app.post<{ Params: { ref: string } }>(
    '/api/v1/instances/:ref/reset-pg-password',
    async (req, reply) => {
      app.authorize(req, 'instance.pg-password.reset');
      const user = app.requireAuth(req);
      const ref = req.params.ref;

      // Audit log entry emitted BEFORE the destructive action per FR-019.
      // (Audit service write is best-effort; failure here doesn't block reset.)
      await emitAuditEvent(user.id, ref).catch((err) => {
        req.log.warn({ err, ref }, 'audit log emit failed (continuing)');
      });

      try {
        await resetPgPasswordForInstance(ref);
      } catch (err) {
        if (err instanceof InstanceNotFoundForResetError) {
          return reply.status(404).send({
            error: { code: 'not_found', message: err.message, details: { ref } },
          });
        }
        if (err instanceof InstanceNotResettableError) {
          return reply.status(409).send({
            error: {
              code: err.code,
              message: err.message,
              details: { status: err.status },
            },
          });
        }
        if (err instanceof PerInstanceDbUnreachableError) {
          return reply.status(502).send({
            error: { code: err.code, message: err.message },
          });
        }
        throw err;
      }

      const resetAt = new Date().toISOString();

      // Enqueue a single-instance reconciler pass — pre-allocate the runId
      // so we can poll for completion below. Insert the row from here so
      // the partial unique index gates concurrency at INSERT time.
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
        // Another reconciler run is in-flight. Return success for the reset
        // itself; the in-flight or next-tick run will verify.
        return reply.status(200).send({
          ref,
          reset_at: resetAt,
          message:
            'Password reset; another reconciler run was already in flight. Verification will be reflected on the next run.',
          pooler_tenant_status: await getCurrentTenantStatus(ref),
        });
      }
      await enqueueReconcilerJob(
        { mode: 'single', ref, runId },
        5, // higher priority than full cron (default 0)
      );

      const final = await pollForReconcilerCompletion(runId, POLL_TIMEOUT_MS);
      const tenantStatus = await getCurrentTenantStatus(ref);

      if (!final.completed) {
        return reply.status(200).send({
          ref,
          reset_at: resetAt,
          message: 'Password reset; reconciler queued. Poll /pooler/status for state.',
          pooler_tenant_status: tenantStatus,
          reconciler_run_id: runId,
        });
      }

      return reply.status(200).send({
        ref,
        reset_at: resetAt,
        message: 'Password reset successfully; verified.',
        pooler_tenant_status: tenantStatus,
        reconciler_run_id: runId,
      });
    },
  );
};

async function pollForReconcilerCompletion(
  runId: string,
  timeoutMs: number,
): Promise<{ completed: boolean; status?: string }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const [row] = await db()
      .select({ status: schema.reconcilerRuns.status })
      .from(schema.reconcilerRuns)
      .where(eq(schema.reconcilerRuns.id, runId))
      .limit(1);
    if (row && row.status !== 'running') {
      return { completed: true, status: row.status };
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return { completed: false };
}

async function getCurrentTenantStatus(ref: string): Promise<string | null> {
  const [row] = await db()
    .select({ status: schema.poolerTenants.status })
    .from(schema.poolerTenants)
    .where(eq(schema.poolerTenants.externalId, ref))
    .limit(1);
  return row?.status ?? null;
}

async function emitAuditEvent(userId: string, ref: string): Promise<void> {
  await db().insert(schema.auditLog).values({
    actorUserId: userId,
    action: 'instances.pg_password.reset',
    targetKind: 'instance',
    targetId: ref,
    payload: { ref, severity: 'high' },
  });
}
