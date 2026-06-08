/**
 * T021 — RBAC plugin: authorize() allows when matrix says yes, returns 403 otherwise,
 * never invokes the handler on deny.
 */
import { describe, expect, it, afterAll, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { rbacPlugin } from '../../../src/plugins/rbac.js';
import { errors } from '@supastack/shared';

function buildApp(role: 'owner' | 'administrator' | 'developer' | 'read_only' | null) {
  const app = Fastify();
  // Provide a tiny fake auth contract before rbacPlugin's decorate runs.
  app.decorate('requireAuth', (_req: any) => {
    if (!role) throw errors.unauthenticated();
    return { id: 'u1', email: 'x@y.z', role };
  });
  return app.register(rbacPlugin).then(() => app);
}

describe('rbac plugin', () => {
  let app: FastifyInstance;

  afterAll(async () => {
    await app?.close();
  });

  it('admin → org.read allowed (handler runs)', async () => {
    app = await buildApp('owner');
    const spy = vi.fn(async () => ({ ok: true }));
    app.get('/x', async (req, _reply) => {
      app.authorize(req as any, 'org.read');
      return spy();
    });
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(200);
    expect(spy).toHaveBeenCalled();
    await app.close();
  });

  it('member → org.update forbidden, handler body after authorize() not reached', async () => {
    app = await buildApp('read_only');
    let reached = false;
    app.get('/x', async (req, _reply) => {
      app.authorize(req as any, 'org.update');
      reached = true;
      return { ok: true };
    });
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(403);
    expect(reached).toBe(false);
    await app.close();
  });

  it('no auth → unauthenticated bubbles out of authorize()', async () => {
    app = await buildApp(null);
    app.get('/x', async (req, _reply) => {
      app.authorize(req as any, 'org.read');
      return { ok: true };
    });
    const res = await app.inject({ method: 'GET', url: '/x' });
    expect(res.statusCode).toBe(401);
    await app.close();
  });
});
