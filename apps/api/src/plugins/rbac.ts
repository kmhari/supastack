import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { can, errors, type Action, type Role } from '@supastack/shared';
import { db, schema } from '@supastack/db';
import { and, eq } from 'drizzle-orm';

export const rbacPlugin: FastifyPluginAsync = fp(async function rbacPlugin(app) {
  // Sync — uses the caller's transitional "primary" role (highest across their
  // orgs). Kept sync so existing call sites need no `await` (an un-awaited
  // async authorize would let a forbidden request through). Org-scoped checks
  // use `authorizeOrg` below.
  app.decorate('authorize', function authorize(req: FastifyRequest, action: Action): void {
    const user = app.requireAuth(req);
    if (!can(user.role, action)) {
      throw errors.forbidden(`role '${user.role}' is not allowed to '${action}'`);
    }
  });

  // Feature 084 — org-scoped authorization: resolve the caller's role IN `orgId`
  // and check the matrix. Throws if the caller isn't a member of that org.
  // Returns the resolved role for convenience.
  app.decorate(
    'authorizeOrg',
    async function authorizeOrg(req: FastifyRequest, action: Action, orgId: string): Promise<Role> {
      const user = app.requireAuth(req);
      const rows = await db()
        .select({ role: schema.organizationMembers.role })
        .from(schema.organizationMembers)
        .where(
          and(
            eq(schema.organizationMembers.organizationId, orgId),
            eq(schema.organizationMembers.userId, user.id),
          ),
        )
        .limit(1);
      if (!rows[0]) {
        throw errors.forbidden(`not a member of organization '${orgId}'`);
      }
      const role = rows[0].role as Role;
      if (!can(role, action)) {
        throw errors.forbidden(`role '${role}' is not allowed to '${action}' in '${orgId}'`);
      }
      return role;
    },
  );
});

declare module 'fastify' {
  interface FastifyInstance {
    authorize(req: FastifyRequest, action: Action): void;
    authorizeOrg(req: FastifyRequest, action: Action, orgId: string): Promise<Role>;
  }
}
