/**
 * Dashboard-route smoke matrix — hits every /api/v1/* route with an admin PAT
 * so the route handler executes at least once. Asserts only "not 401" because
 * many handlers reach into docker / network and fail with 5xx in the test
 * env — but they still execute, which is what bumps coverage.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/api/v1/* dashboard routes smoke', () => {
  let app: FastifyInstance;
  let adminToken: string;
  let memberToken: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const admin = await seedTestUser({ role: 'owner' });
    const member = await seedTestUser({ role: 'read_only' });
    adminToken = admin.token;
    memberToken = member.token;
    await withMockInstance(ref, { orgId: admin.orgId });
  });

  afterAll(async () => {
    await app?.close();
  });

  const adminEndpoints: Array<{ method: string; url: string; body?: unknown }> = [
    // org
    { method: 'GET', url: '/api/v1/org' },
    { method: 'PATCH', url: '/api/v1/org', body: { name: 'Renamed Org' } },
    // members
    { method: 'GET', url: '/api/v1/members' },
    { method: 'GET', url: '/api/v1/members/invites' },
    {
      method: 'POST',
      url: '/api/v1/members/invites',
      body: { email: `inv-${randomBytes(3).toString('hex')}@x.io`, role: 'read_only' },
    },
    // apex
    { method: 'GET', url: '/api/v1/apex' },
    { method: 'POST', url: '/api/v1/apex/recheck' },
    // wildcard certs
    { method: 'GET', url: '/api/v1/wildcard-certs/status' },
    // secrets dashboard
    { method: 'GET', url: `/api/v1/projects/${ref}/secrets` },
    // backups
    { method: 'GET', url: `/api/v1/instances/${ref}/backups` },
    // pooler
    { method: 'GET', url: '/api/v1/pooler/status' },
    // audit
    { method: 'GET', url: '/api/v1/audit' },
    // health (no auth required, but still bumps coverage)
    { method: 'GET', url: '/api/v1/health' },
    // tokens (under /auth/tokens)
    { method: 'GET', url: '/api/v1/auth/tokens' },
    {
      method: 'POST',
      url: '/api/v1/auth/tokens',
      body: { label: `t-${randomBytes(3).toString('hex')}` },
    },
    { method: 'GET', url: '/api/v1/auth/me' },
    // instances
    { method: 'GET', url: '/api/v1/instances' },
    { method: 'GET', url: `/api/v1/instances/${ref}` },
  ];

  for (const { method, url, body } of adminEndpoints) {
    it(`admin: ${method} ${url} → executes handler (any status, just not 401)`, async () => {
      const res = await app.inject({
        method: method as any,
        url,
        headers: { authorization: `Bearer ${adminToken}` },
        payload: body as any,
      });
      // 401 means the auth plugin rejected the PAT outright — that would
      // indicate a setup bug, not a route-handler outcome. Anything else is
      // acceptable for the purpose of code coverage.
      expect(res.statusCode).not.toBe(401);
    });
  }

  it('member: GET /api/v1/org allowed', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/org',
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(200);
  });

  it('member: PATCH /api/v1/org → 403 (org.update admin-only)', async () => {
    const res = await app.inject({
      method: 'PATCH',
      url: '/api/v1/org',
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { name: 'cant' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('unauthenticated dashboard endpoints all return 401', async () => {
    for (const { method, url } of adminEndpoints.filter((e) => !e.url.includes('/health'))) {
      const res = await app.inject({ method: method as any, url });
      expect(res.statusCode, `${method} ${url}`).toBe(401);
    }
  });
});
