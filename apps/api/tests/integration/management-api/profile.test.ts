/**
 * T013 — GET /v1/profile contract test.
 *
 * Spec FR mapping: FR-005 (project listing), FR-003 (PAT validation).
 * The endpoint is the CLI's `supabase login` follow-up call to confirm
 * who the token belongs to before any per-project operation.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser } from '../../helpers/mgmt-api.js';
import { ProfileSchema } from '@selfbase/shared';

describe.skipIf(!hasTestEnv)('GET /v1/profile', () => {
  let app: FastifyInstance;
  let token: string;
  let email: string;
  let userId: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    email = seeded.email;
    userId = seeded.userId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns the authenticated user profile in the cloud-Profile shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => ProfileSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({
      id: userId,
      primary_email: email,
    });
  });

  it('returns 401 with no Authorization header', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/profile' });
    expect(res.statusCode).toBe(401);
  });

  it('returns 401 with an invalid (unregistered) PAT', async () => {
    const fake = 'sbp_0000000000000000000000000000000000000000';
    const res = await app.inject({
      method: 'GET',
      url: '/v1/profile',
      headers: { authorization: `Bearer ${fake}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
