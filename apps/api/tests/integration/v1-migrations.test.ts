/**
 * T033 — /v1/projects/:ref/database/migrations/{list,fetch,repair} auth surface.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/v1/projects/:ref/database/migrations', () => {
  let app: FastifyInstance;
  let adminToken: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const admin = await seedTestUser({ role: 'admin' });
    adminToken = admin.token;
    await withMockInstance(ref, { orgId: admin.orgId });
  });

  afterAll(async () => {
    await app?.close();
  });

  it('GET list 401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/database/migrations`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('GET list reachable as admin (any non-401 — handler executed)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/database/migrations`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('GET fetch a specific version reachable as admin', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/database/migrations/20240101000001`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('PATCH repair reachable as admin', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/database/migrations`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { version: '20240101000001', status: 'reverted' },
    });
    expect(res.statusCode).not.toBe(401);
  });
});
