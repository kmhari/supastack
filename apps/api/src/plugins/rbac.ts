import fp from 'fastify-plugin';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { can, errors, type Action } from '@selfbase/shared';

export const rbacPlugin: FastifyPluginAsync = fp(async function rbacPlugin(app) {
  app.decorate('authorize', function authorize(req: FastifyRequest, action: Action): void {
    const user = app.requireAuth(req);
    if (!can(user.role, action)) {
      throw errors.forbidden(`role '${user.role}' is not allowed to '${action}'`);
    }
  });
});

declare module 'fastify' {
  interface FastifyInstance {
    authorize(req: FastifyRequest, action: Action): void;
  }
}
