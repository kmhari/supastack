/**
 * T026 — GET /v1/projects/:ref/api-keys contract test.
 *
 * Spec FR: cloud-compatible read of the per-instance anon + service_role
 * JWTs that selfbase minted during provisioning. The CLI uses this for
 * `supabase projects api-keys` and also internally during some link/info
 * paths. Per-instance secrets are decrypted via @supastack/crypto.
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
} from '../../helpers/mgmt-api.js';
import { ApiKeySchema } from '@supastack/shared';

const ref = `apik${randomBytes(8).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('GET /v1/projects/:ref/api-keys', () => {
  let app: FastifyInstance;
  let token: string;
  let knownAnonKey: string;
  let knownServiceRoleKey: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    const { secrets } = await withMockInstance(ref);
    knownAnonKey = secrets.anonKey;
    knownServiceRoleKey = secrets.serviceRoleKey;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('returns [{anon}, {service_role}] with the decrypted per-instance JWTs', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/api-keys`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => z.array(ApiKeySchema).parse(body)).not.toThrow();
    const arr = body as Array<{ name: string; api_key: string }>;
    expect(arr).toHaveLength(2);
    const anon = arr.find((k) => k.name === 'anon');
    const service = arr.find((k) => k.name === 'service_role');
    expect(anon?.api_key).toBe(knownAnonKey);
    expect(service?.api_key).toBe(knownServiceRoleKey);
  });

  it('returns 404 for an unknown ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects/zzzzzzzzzzzzzzzzzzzz/api-keys',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/api-keys`,
    });
    expect(res.statusCode).toBe(401);
  });
});
