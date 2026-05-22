/**
 * T014 — GET /v1/organizations contract test.
 *
 * The CLI uses this to populate org pickers (mainly during `supabase
 * projects create`, which P0 doesn't implement, but `link` and `secrets
 * list` may also hit it depending on CLI version).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { buildAuthedApp, hasTestEnv, seedTestUser } from '../../helpers/mgmt-api.js';
import { OrganizationSchema } from '@selfbase/shared';

describe.skipIf(!hasTestEnv)('GET /v1/organizations', () => {
  let app: FastifyInstance;
  let token: string;
  let orgId: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    orgId = seeded.orgId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the orgs the authenticated user belongs to', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/organizations',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    // Array of Organization.
    expect(() => z.array(OrganizationSchema).parse(body)).not.toThrow();
    expect(body).toEqual(
      expect.arrayContaining([expect.objectContaining({ id: orgId })]),
    );
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/organizations' });
    expect(res.statusCode).toBe(401);
  });
});
