/**
 * T034 — GET /v1/projects/:ref/types/typescript auth surface.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/v1/projects/:ref/types/typescript', () => {
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

  it('401 without auth', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/types/typescript`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('reachable as admin (mock instance unreachable → 5xx/4xx, but past auth)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/types/typescript`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).not.toBe(401);
  });

  it('404-shaped error for unknown ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/zzzzzzzzzzzzzzzzzzzz/types/typescript`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
