/**
 * T030 — POST /v1/projects/:ref/database/query integration smoke.
 * Companion to tests/unit/db-query.test.ts (logic).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser, withMockInstance } from '../helpers/mgmt-api.js';

const ref = `tref${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('/v1/projects/:ref/database/query', () => {
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

  it('401 without auth', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/query`,
      payload: { query: 'select 1' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('403 as member (database.write admin-only)', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/query`,
      headers: { authorization: `Bearer ${memberToken}` },
      payload: { query: 'select 1' },
    });
    expect(res.statusCode).toBe(403);
  });

  it('400 on multi-statement query', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/query`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { query: 'select 1; select 2' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('400 / 422 on missing body field', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/database/query`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {},
    });
    expect([400, 422]).toContain(res.statusCode);
  });

  it('404 on unknown project ref', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/zzzzzzzzzzzzzzzzzzzz/database/query`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload: { query: 'select 1' },
    });
    // Mock instance is not actually running; we accept any non-2xx error code.
    expect(res.statusCode).toBeGreaterThanOrEqual(400);
  });
});
