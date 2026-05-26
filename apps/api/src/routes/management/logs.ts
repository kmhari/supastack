/**
 * GET /v1/projects/:ref/analytics/endpoints/logs.all — feature 014 US4.
 *
 * Forwards SQL-over-logs queries to the per-project analytics (Logflare)
 * container. Wire-compatible with upstream Supabase Management API so the
 * unmodified upstream MCP server's `get_logs` tool works.
 *
 * Spec: 014-mcp-http-oauth — FR-025..028, contracts/logs-endpoint.md.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import {
  queryLogs,
  AnalyticsUnreachableError,
  AnalyticsBadGatewayError,
  InstanceNotFoundForLogsError,
  type LogService,
} from '../../services/logflare-client.js';
import { getProjectByRef } from '../../services/project-store.js';

const QuerySchema = z
  .object({
    service: z
      .enum(['api', 'postgres', 'edge-function', 'auth', 'storage', 'realtime'])
      .optional(),
    iso_timestamp_start: z.string().datetime().optional(),
    iso_timestamp_end: z.string().datetime().optional(),
    sql: z.string().max(4096).optional(),
  })
  .strict();

export const logsRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string }; Querystring: unknown }>(
    '/projects/:ref/analytics/endpoints/logs.all',
    async (req, _reply) => {
      const ref = req.params.ref;
      const user = app.requireAuth(req);
      app.authorize(req, 'audit.read');

      const parsed = QuerySchema.safeParse(req.query);
      if (!parsed.success) {
        throw new ManagementApiError(
          400,
          parsed.error.issues[0]?.message ?? 'invalid query params',
          'invalid_params',
          { issues: parsed.error.issues },
        );
      }

      const proj = await getProjectByRef(user.id, ref);
      if (!proj) throw new ManagementApiError(404, 'Project not found', 'not_found', { ref });

      try {
        const rows = await queryLogs(ref, {
          service: parsed.data.service as LogService | undefined,
          isoTimestampStart: parsed.data.iso_timestamp_start,
          isoTimestampEnd: parsed.data.iso_timestamp_end,
          sql: parsed.data.sql,
        });
        return { result: rows };
      } catch (err) {
        if (err instanceof InstanceNotFoundForLogsError) {
          throw new ManagementApiError(404, err.message, 'not_found', { ref });
        }
        if (err instanceof AnalyticsUnreachableError) {
          if (err.message.includes('project status')) {
            throw new ManagementApiError(409, err.message, 'project_not_runnable');
          }
          throw new ManagementApiError(503, err.message, 'analytics_unreachable');
        }
        if (err instanceof AnalyticsBadGatewayError) {
          throw new ManagementApiError(502, err.message, 'analytics_bad_gateway');
        }
        throw err;
      }
    },
  );
};
