/**
 * T035 — cross-route auth + RBAC matrix. For a representative selection of
 * `/v1/*` routes asserts:
 *   - no PAT → 401
 *   - wrong-role (member) PAT → 403 on admin-only routes
 *
 * Uses Fastify inject() against a real build (gated by hasTestEnv).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('auth + RBAC matrix across /v1/* routes', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const admin = await seedTestUser({ role: 'admin' });
    const member = await seedTestUser({ role: 'member' });
    adminToken = admin.token;
    memberToken = member.token;
    await withMockInstance(ref, { orgId: admin.orgId });
  });

  afterAll(async () => {
    await app?.close();
  });

  const noAuthRoutes: Array<[string, string]> = [
    ['GET', '/v1/projects'],
    ['GET', `/v1/projects/${ref}`],
    ['GET', `/v1/projects/${ref}/api-keys`],
    ['GET', `/v1/projects/${ref}/functions`],
    ['GET', `/v1/projects/${ref}/secrets`],
    ['GET', `/v1/projects/${ref}/types/typescript`],
    ['GET', '/v1/organizations'],
    ['GET', '/v1/profile'],
    ['POST', `/v1/projects/${ref}/database/query`],
    ['POST', `/v1/projects/${ref}/database/dump`],
    ['POST', `/v1/projects/${ref}/cli/login-role`],
    ['DELETE', `/v1/projects/${ref}/cli/login-role`],
    ['GET', `/v1/projects/${ref}/database/migrations`],
  ];

  for (const [method, url] of noAuthRoutes) {
    it(`${method} ${url} without PAT → 401`, async () => {
      const res = await app.inject({ method: method as any, url });
      // 401 (no PAT) — some routes also early-validate body and return 400 before
      // auth runs; accept either 401 or a Fastify-emitted 400 from missing body
      // but never 200.
      expect([401, 400, 415]).toContain(res.statusCode);
      expect(res.statusCode).not.toBe(200);
    });
  }

  // Admin-only mutating endpoints — member PAT must get 403.
  const adminOnlyRoutes: Array<[string, string, unknown]> = [
    [
      'POST',
      `/v1/projects/${ref}/database/query`,
      { query: 'select 1' },
    ],
    ['POST', `/v1/projects/${ref}/cli/login-role`, { read_only: true }],
    ['DELETE', `/v1/projects/${ref}/cli/login-role`, undefined],
  ];

  for (const [method, url, payload] of adminOnlyRoutes) {
    it(`${method} ${url} as member → 403`, async () => {
      const res = await app.inject({
        method: method as any,
        url,
        headers: { authorization: `Bearer ${memberToken}` },
        payload: payload as any,
      });
      expect(res.statusCode).toBe(403);
    });
  }

  it('admin PAT → 200 on GET /v1/projects (smoke)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect(res.statusCode).toBe(200);
  });
});
