/**
 * GET /v1/organizations — orgs the authenticated user belongs to.
 *
 * Spec: contracts/management-api.yaml `operationId: listOrganizations`
 *
 * Supastack models a single org per deployment today (the `org` table is a
 * singleton-ish), but the CLI always sends a list-shaped GET; we comply by
 * returning all orgs the user has a membership in via `org_members`.
 */
import { db, schema } from '@supastack/db';
import type { Organization } from '@supastack/shared';
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { orgToOrganization } from '../../services/mgmt-api-mapping.js';

export const organizationsRoutes: FastifyPluginAsync = async (app) => {
  app.get('/organizations', async (req): Promise<Organization[]> => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({ id: schema.org.id, name: schema.org.name })
      .from(schema.org)
      .innerJoin(schema.orgMembers, eq(schema.orgMembers.orgId, schema.org.id))
      .where(eq(schema.orgMembers.userId, user.id));
    return rows.map(orgToOrganization);
  });
};
