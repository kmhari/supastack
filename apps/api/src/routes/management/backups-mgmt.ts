/**
 * Backup management endpoints — feature 019 (issue #14).
 *
 *   GET  /v1/projects/:ref/database/backups
 *   POST /v1/projects/:ref/database/backups/restore-pitr
 *   GET  /v1/projects/:ref/database/backups/restore-status
 *
 * Wire-compatible with upstream Supabase Management API shape.
 * Restore is admin-only (backup.restore action).
 */
import type { FastifyPluginAsync } from 'fastify';
import { Queue } from 'bullmq';
import { Redis } from 'ioredis';
import { logger } from '@selfbase/shared';
import { RestoreRequestSchema } from '@selfbase/shared';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import {
  listBackupsForCli,
  initiateRestore,
  getRestoreStatus,
  RestoreError,
} from '../../services/backups-mgmt-service.js';

let _restoreQueue: Queue | null = null;
function restoreQueue(): Queue {
  if (!_restoreQueue) {
    _restoreQueue = new Queue('selfbase.restore', {
      connection: new Redis(process.env.REDIS_URL ?? 'redis://redis:6379', {
        maxRetriesPerRequest: null,
      }),
    });
  }
  return _restoreQueue;
}

export const backupsMgmtRoutes: FastifyPluginAsync = async (app) => {
  // GET /v1/projects/:ref/database/backups
  app.get<{ Params: { ref: string } }>('/projects/:ref/database/backups', async (req, reply) => {
    const user = app.requireAuth(req);
    app.authorize(req, 'backup.list');

    const proj = await getProjectByRef(user.id, req.params.ref);
    if (!proj)
      throw new ManagementApiError(404, 'Project not found', 'not_found', { ref: req.params.ref });
    if (proj.status === 'provisioning' || proj.status === 'deleting') {
      throw new ManagementApiError(409, 'Project not running', 'project_not_running', {
        ref: req.params.ref,
      });
    }

    const result = await listBackupsForCli(req.params.ref);
    return reply.send(result);
  });

  // POST /v1/projects/:ref/database/backups/restore-pitr
  app.post<{ Params: { ref: string }; Body: unknown }>(
    '/projects/:ref/database/backups/restore-pitr',
    async (req, reply) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'backup.restore');

      const ref = req.params.ref;
      const proj = await getProjectByRef(user.id, ref);
      if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
      if (proj.status === 'paused') {
        throw new ManagementApiError(
          409,
          'Project is paused; resume before restoring',
          'project_paused',
          { ref },
        );
      }
      if (proj.status === 'restoring') {
        throw new ManagementApiError(
          409,
          'A restore is already in progress',
          'restore_in_progress',
          { ref },
        );
      }

      const parsed = RestoreRequestSchema.safeParse(req.body);
      if (!parsed.success) {
        throw new ManagementApiError(400, 'Invalid request', 'invalid_target', {
          issues: parsed.error.issues,
        });
      }

      let job: Awaited<ReturnType<typeof initiateRestore>>;
      try {
        job = await initiateRestore(ref, parsed.data);
      } catch (err) {
        if (err instanceof RestoreError) {
          const code = err.code;
          if (code === 'invalid_target') {
            throw new ManagementApiError(400, err.message, code, {});
          }
          if (code === 'backup_blob_missing') {
            throw new ManagementApiError(410, err.message, code, {});
          }
          if (
            code === 'backup_status_invalid' ||
            code === 'restore_in_progress' ||
            code === 'disk_space_insufficient'
          ) {
            const details =
              (err as { details?: Record<string, unknown> }).details ?? {};
            throw new ManagementApiError(409, err.message, code, details);
          }
          throw new ManagementApiError(400, err.message, code, {});
        }
        // Postgres unique-constraint violation = concurrent restore in progress
        const pgErr = err as { code?: string; constraint?: string };
        if (
          pgErr?.code === '23505' &&
          pgErr?.constraint?.includes('uq_restore_jobs_one_inflight')
        ) {
          throw new ManagementApiError(
            409,
            'A restore is already in progress',
            'restore_in_progress',
            { ref },
          );
        }
        throw err;
      }

      // Enqueue the restore worker job
      await restoreQueue().add('restore', { restore_job_id: job.restore_job_id });

      logger.info({ ref, restore_job_id: job.restore_job_id }, 'mgmt_api.backup.restore_started');

      return reply.status(202).send(job);
    },
  );

  // GET /v1/projects/:ref/database/backups/restore-status
  app.get<{ Params: { ref: string } }>(
    '/projects/:ref/database/backups/restore-status',
    async (req, reply) => {
      const user = app.requireAuth(req);
      app.authorize(req, 'backup.list');

      const proj = await getProjectByRef(user.id, req.params.ref);
      if (!proj)
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });

      const result = await getRestoreStatus(req.params.ref);
      return reply.send(result);
    },
  );
};
