/**
 * T053 — assert /v1/projects/<ref>/postgrest and /v1/projects/<ref>/config/auth
 * (both verbs) no longer fall through to the `notImplementedRoutes` catch-all
 * (FR-011 + SC-007).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const newRef = () => `n5${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('runtime config endpoints replaced the 501 catch-all', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    (globalThis as any).__supastackFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  it.each([
    ['GET', '/postgrest'],
    ['PATCH', '/postgrest'],
    ['GET', '/config/auth'],
    ['PATCH', '/config/auth'],
  ])('%s /v1/projects/:ref%s does not return 501', async (method, suffix) => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);

    const res = await app.inject({
      method: method as 'GET' | 'PATCH',
      url: `/v1/projects/${ref}${suffix}`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: method === 'PATCH' ? '{}' : undefined,
    });
    // Anything except 501 is acceptable for this gate — real success / 4xx
    // are fine, we only forbid the not_implemented fallthrough.
    expect(res.statusCode).not.toBe(501);
    if (res.statusCode === 501) {
      throw new Error(
        `${method} /v1/projects/<ref>${suffix} returned 501 — route registration regression`,
      );
    }
    const body = res.json() as { code?: string };
    expect(body.code).not.toBe('not_implemented');
  });
});
