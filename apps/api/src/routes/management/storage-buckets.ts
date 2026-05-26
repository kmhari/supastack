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
import { db, schema } from '@selfbase/db';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import {
  listBuckets,
  StorageUnreachableError,
  StorageBadGatewayError,
} from '../../services/storage-buckets-proxy.js';
import { InstanceNotFoundForServiceRoleError } from '../../services/service-role-jwt.js';
import { getProjectByRef } from '../../services/project-store.js';

export const storageBucketsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>('/projects/:ref/storage/buckets', async (req, _reply) => {
    const ref = req.params.ref;
    const user = app.requireAuth(req);
    app.authorize(req, 'instance.read');

    const proj = await getProjectByRef(user.id, ref);
    if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });

    // Status check
    const [inst] = await db()
      .select({ status: schema.supabaseInstances.status })
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!inst || inst.status !== 'running') {
      throw new ManagementApiError(
        409,
        `Cannot list buckets — project status is '${inst?.status ?? 'unknown'}'`,
        'project_not_runnable',
        { status: inst?.status ?? null },
      );
    }

    try {
      return await listBuckets(ref);
    } catch (err) {
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
  });
};
