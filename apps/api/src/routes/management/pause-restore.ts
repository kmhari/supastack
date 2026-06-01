/**
 * POST /v1/projects/:ref/pause + POST /v1/projects/:ref/restore — feature 014 US6.
 *
 * Wire-compatible with upstream Supabase Management API:
 *   - pause: 200 + project payload with status='INACTIVE' (transitions async)
 *   - restore: 200 + project payload with status='COMING_UP' (transitions async)
 *
 * Idempotent — already-paused/already-running returns success without error.
 * Refuses to pause when a backup is in-flight (returns 409 backup_in_progress).
 *
 * Spec: 014-mcp-http-oauth — FR-033..036, contracts/pause-restore-endpoints.md.
 */
import type { FastifyPluginAsync } from 'fastify';
import { and, eq } from 'drizzle-orm';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { db, schema } from '@supastack/db';
import { logger } from '@supastack/shared';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { instanceToProject } from '../../services/mgmt-api-mapping.js';

// Per-process BullMQ queue handle for lifecycle jobs (matches the pattern in
// `apps/api/src/routes/instances.ts`).
let _lifecycleQueue: Queue | null = null;
function lifecycleQueue(): Queue {
  if (!_lifecycleQueue) {
    _lifecycleQueue = new Queue('selfbase.lifecycle', {
      connection: new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
        maxRetriesPerRequest: null,
      }),
    });
  }
  return _lifecycleQueue;
}

export const pauseRestoreRoutes: FastifyPluginAsync = async (app) => {
  // POST /v1/projects/:ref/pause
  app.post<{ Params: { ref: string } }>('/projects/:ref/pause', async (req, reply) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'instance.pause');

    const ref = req.params.ref;
    const proj = await getProjectByRef(user.id, ref);
    if (!proj) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
    }

    // Refuse if a backup is currently running for this project (per spec edge case)
    const runningBackup = await db()
      .select({ id: schema.backups.id })
      .from(schema.backups)
      .where(and(eq(schema.backups.instanceRef, ref), eq(schema.backups.status, 'running')))
      .limit(1);
    if (runningBackup.length > 0) {
      throw new ManagementApiError(
        409,
        'Cannot pause — a backup is currently in progress for this project',
        'backup_in_progress',
        { backup_id: runningBackup[0]!.id },
      );
    }

    // Idempotent: already-paused → no-op return current state
    if (proj.status === 'paused' || proj.status === 'stopped') {
      return reply.status(200).send(instanceToProject(proj));
    }

    // Transition: running/failed → paused
    if (proj.status !== 'running' && proj.status !== 'failed') {
      throw new ManagementApiError(
        409,
        `Cannot pause from status '${proj.status}'`,
        'project_not_runnable',
        { status: proj.status },
      );
    }

    await db()
      .update(schema.supabaseInstances)
      .set({ status: 'paused', updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));

    // Enqueue lifecycle worker job (same pattern as dashboard pause)
    await lifecycleQueue().add('pause', { ref }, { removeOnComplete: 100 });

    // Audit
    try {
      await db()
        .insert(schema.auditLog)
        .values({
          actorUserId: user.id,
          action: 'instance.pause',
          targetKind: 'instance',
          targetId: ref,
          payload: { via: 'mgmt-api' },
        });
    } catch (err) {
      logger.warn({ err, ref }, 'instance.pause audit emit failed (continuing)');
    }

    // Return project with status='INACTIVE' (mapped from 'paused' by instanceToProject)
    return reply.status(200).send(instanceToProject({ ...proj, status: 'paused' }));
  });

  // POST /v1/projects/:ref/restore
  app.post<{ Params: { ref: string } }>('/projects/:ref/restore', async (req, reply) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'instance.resume');

    const ref = req.params.ref;
    const proj = await getProjectByRef(user.id, ref);
    if (!proj) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
    }

    // Idempotent: already-running/provisioning → no-op
    if (proj.status === 'running' || proj.status === 'provisioning') {
      return reply.status(200).send(instanceToProject(proj));
    }

    if (proj.status !== 'paused' && proj.status !== 'stopped') {
      throw new ManagementApiError(
        409,
        `Cannot restore from status '${proj.status}'`,
        'project_not_runnable',
        { status: proj.status },
      );
    }

    await db()
      .update(schema.supabaseInstances)
      .set({ status: 'provisioning', updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));

    await lifecycleQueue().add('resume', { ref }, { removeOnComplete: 100 });

    try {
      await db()
        .insert(schema.auditLog)
        .values({
          actorUserId: user.id,
          action: 'instance.resume',
          targetKind: 'instance',
          targetId: ref,
          payload: { via: 'mgmt-api' },
        });
    } catch (err) {
      logger.warn({ err, ref }, 'instance.resume audit emit failed (continuing)');
    }

    return reply.status(200).send(instanceToProject({ ...proj, status: 'provisioning' }));
  });
};
