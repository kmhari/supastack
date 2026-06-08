/**
 * GET /v1/projects/:ref/storage/buckets — feature 014 US5.
 *
 * Reverse-proxies to the per-project storage container with a freshly-minted
 * service-role JWT. Returns bare-array of bucket objects (matches storage
 * container's native shape).
 *
 * Spec: 014-mcp-http-oauth — FR-029..032, contracts/storage-buckets-endpoint.md.
 */
import type { FastifyPluginAsync } from 'fastify';
import { eq } from 'drizzle-orm';
import { db, schema } from '@supastack/db';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import {
  listBuckets,
  createBucket,
  getBucket,
  updateBucket,
  deleteBucket,
  emptyBucket,
  StorageUnreachableError,
  StorageBadGatewayError,
} from '../../services/storage-buckets-proxy.js';
import { InstanceNotFoundForServiceRoleError } from '../../services/service-role-jwt.js';
import { getProjectByRef } from '../../services/project-store.js';

function storageErrorHandler(err: unknown, ref: string): never {
  if (err instanceof InstanceNotFoundForServiceRoleError) {
    throw new ManagementApiError(404, err.message, 'not_found', { ref });
  }
  if (err instanceof StorageUnreachableError) {
    throw new ManagementApiError(503, err.message, 'storage_unreachable');
  }
  if (err instanceof StorageBadGatewayError) {
    throw new ManagementApiError(502, err.message, 'storage_bad_gateway');
  }
  throw err;
}

async function requireRunning(ref: string): Promise<void> {
  const [inst] = await db()
    .select({ status: schema.supabaseInstances.status })
    .from(schema.supabaseInstances)
    .where(eq(schema.supabaseInstances.ref, ref))
    .limit(1);
  if (!inst || inst.status !== 'running') {
    throw new ManagementApiError(
      409,
      `Project status is '${inst?.status ?? 'unknown'}'`,
      'project_not_running',
      { status: inst?.status ?? null },
    );
  }
}

export const storageBucketsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/storage/buckets', async (req, _reply) => {
    const ref = req.params.ref;
    const user = app.requireAuth(req);
    app.authorize(req, 'instance.read');

    const proj = await getProjectByRef(user.id, ref);
    if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });
    await requireRunning(ref);
    try {
      return await listBuckets(ref);
    } catch (err) {
      storageErrorHandler(err, ref);
    }
  });

  app.post<{ Params: { ref: string }; Body: Record<string, unknown> }>(
    '/projects/:ref/storage/buckets',
    async (req, reply) => {
      const ref = req.params.ref;
      app.requireAuth(req);
      app.authorize(req, 'instance.read');
      await requireRunning(ref);
      try {
        const result = await createBucket(ref, req.body ?? {});
        return reply.status(200).send(result);
      } catch (err) {
        storageErrorHandler(err, ref);
      }
    },
  );

  app.get<{ Params: { ref: string; id: string } }>(
    '/projects/:ref/storage/buckets/:id',
    async (req, _reply) => {
      const { ref, id } = req.params;
      app.requireAuth(req);
      app.authorize(req, 'instance.read');
      await requireRunning(ref);
      try {
        return await getBucket(ref, id);
      } catch (err) {
        storageErrorHandler(err, ref);
      }
    },
  );

  app.patch<{ Params: { ref: string; id: string }; Body: Record<string, unknown> }>(
    '/projects/:ref/storage/buckets/:id',
    async (req, reply) => {
      const { ref, id } = req.params;
      app.requireAuth(req);
      app.authorize(req, 'instance.read');
      await requireRunning(ref);
      try {
        const result = await updateBucket(ref, id, req.body ?? {});
        return reply.status(200).send(result);
      } catch (err) {
        storageErrorHandler(err, ref);
      }
    },
  );

  app.delete<{ Params: { ref: string; id: string } }>(
    '/projects/:ref/storage/buckets/:id',
    async (req, reply) => {
      const { ref, id } = req.params;
      app.requireAuth(req);
      app.authorize(req, 'instance.read');
      await requireRunning(ref);
      try {
        // Storage requires bucket to be empty before deletion.
        await emptyBucket(ref, id).catch(() => {});
        const result = await deleteBucket(ref, id);
        return reply.status(200).send(result);
      } catch (err) {
        storageErrorHandler(err, ref);
      }
    },
  );
};
