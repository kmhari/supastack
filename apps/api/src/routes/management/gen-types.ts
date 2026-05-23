/**
 * Gen Types endpoint — `GET /v1/projects/:ref/types/typescript`
 *
 * Powers `supabase gen types typescript --project-id <ref>` (feature 006 US1).
 *
 * Forwards to the per-instance `pg-meta` container via Kong, returning the
 * generated TypeScript wrapped in `{ types: <string> }` to match the
 * upstream Cloud Management API shape.
 */
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getProjectByRef } from '../../services/project-store.js';
import { generateTypes, GenTypesError } from '../../services/gen-types-service.js';

const QuerySchema = z.object({
  // Single string OR array (Fastify hands repeated query params as array).
  // Also accept comma-separated for forgiveness.
  included_schemas: z
    .union([z.string(), z.array(z.string())])
    .optional(),
  // Older CLI versions use `schemas` plural — accept both.
  schemas: z
    .union([z.string(), z.array(z.string())])
    .optional(),
});

function normalizeSchemas(q: z.infer<typeof QuerySchema>): string[] {
  const raw = q.included_schemas ?? q.schemas;
  if (!raw) return ['public'];
  const arr = Array.isArray(raw) ? raw : raw.split(',');
  const cleaned = arr.map((s) => s.trim()).filter(Boolean);
  return cleaned.length > 0 ? cleaned : ['public'];
}

export const genTypesRoutes: FastifyPluginAsync = async (app) => {
  app.get<{ Params: { ref: string } }>(
    '/projects/:ref/types/typescript',
    async (req) => {
      const user = app.requireAuth(req);
      const inst = await getProjectByRef(user.id, req.params.ref);
      if (!inst) {
        throw new ManagementApiError(404, 'Project not found', 'not_found', {
          ref: req.params.ref,
        });
      }
      const q = QuerySchema.parse(req.query ?? {});
      const schemas = normalizeSchemas(q);

      try {
        const types = await generateTypes(inst, schemas);
        return { types };
      } catch (err) {
        if (err instanceof GenTypesError) {
          switch (err.code) {
            case 'schema_not_found':
              throw new ManagementApiError(400, err.message, err.code, err.details);
            case 'instance_not_running':
              throw new ManagementApiError(409, err.message, 'project_not_running');
            case 'meta_upstream_error':
            case 'meta_unreachable':
              throw new ManagementApiError(502, err.message, 'pg_meta_unreachable');
          }
        }
        throw err;
      }
    },
  );
};
