/**
 * T032 — POST/DELETE /v1/projects/:ref/cli/login-role integration smoke.
 * The richer functional coverage lives in tests/integration/management-api/cli-login-role.test.ts.
 * This file asserts the auth/RBAC matrix at the requested path.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/v1/projects/:ref/cli/login-role auth surface', () => {
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

  it('POST 401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      payload: { read_only: true },
    });
    expect(res.statusCode).toBe(401);
  });

  it('POST 403 as member (database.create-login-role admin-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { read_only: false },
    });
    expect(res.statusCode).toBe(403);
  });

  it('DELETE 401 without auth', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('DELETE 403 as member', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/cli/login-role`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });
});
