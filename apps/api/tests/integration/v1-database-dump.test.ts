/**
 * T031 — POST /v1/projects/:ref/database/dump integration smoke.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/v1/projects/:ref/database/dump', () => {
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

  it('401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/dump`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 as member', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/dump`,
      headers: { authorization: `Bearer ${memberToken}` },
    });
    expect(res.statusCode).toBe(403);
  });

  it('admin can call (may 500 because pg_dump CLI / docker not available, but reaches handler)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/dump`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    // The mock instance can't actually be dumped; we just confirm we
    // reached the handler past auth/RBAC (any status >= 400 is fine here
    // because the goal is route coverage, not pg_dump correctness).
    expect(res.statusCode).not.toBe(401);
    expect(res.statusCode).not.toBe(403);
  });
});
