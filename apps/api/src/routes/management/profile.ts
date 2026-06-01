/**
 * GET /v1/profile — the authenticated user's profile.
 *
 * Spec: contracts/management-api.yaml `operationId: getProfile`
 *
 * The CLI calls this once after `supabase login` to confirm the token works
 * and to populate the dashboard URL it shows in its banner.
 */
import { eq } from 'drizzle-orm';
import type { FastifyPluginAsync } from 'fastify';
import { db, schema } from '@supastack/db';
import type { Profile } from '@supastack/shared';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';

export const profileRoutes: FastifyPluginAsync = async (app) => {
  app.get('/profile', async (req): Promise<Profile> => {
    const user = app.requireAuth(req);
    const rows = await db()
      .select({ id: schema.users.id, email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, user.id))
      .limit(1);
    if (!rows[0]) {
      throw new ManagementApiError(404, 'User not found', 'not_found');
    }
    return { id: rows[0].id, primary_email: rows[0].email };
  });
};
