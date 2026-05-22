/**
 * T045 — GET /v1/projects/:ref/secrets
 *
 * Spec FR-015: returns `[{name, value: <sha256>}]`. Plaintext values
 * MUST NOT appear in the response anywhere.
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
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';
import { SecretListEntrySchema } from '@selfbase/shared';

const ref = `sl${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('GET /v1/projects/:ref/secrets', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    (globalThis as any).__selfbaseFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    await withMockInstance(ref);
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  it('returns an empty array when no secrets are set', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual([]);
  });

  it('returns [{name, value: <sha256>}] after secrets are set; plaintext NEVER appears', async () => {
    // Set two secrets via the POST endpoint.
    const set = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([
        { name: 'STRIPE_KEY', value: 'sk_test_distinctive_marker_001' },
        { name: 'OPENAI_KEY', value: 'sk-distinctive_marker_002' },
      ]),
    });
    expect(set.statusCode).toBe(201);

    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => z.array(SecretListEntrySchema).parse(body)).not.toThrow();
    const names = (body as Array<{ name: string }>).map((s) => s.name).sort();
    expect(names).toEqual(['OPENAI_KEY', 'STRIPE_KEY']);
    // The redacted indicator must be a sha256 hex digest (64 chars), not the plaintext.
    for (const entry of body as Array<{ name: string; value: string }>) {
      expect(entry.value).toMatch(/^[a-f0-9]{64}$/);
    }
    // FR-015: plaintext MUST NOT appear in list responses.
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('sk_test_distinctive_marker_001');
    expect(raw).not.toContain('sk-distinctive_marker_002');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/secrets`,
    });
    expect(res.statusCode).toBe(401);
  });

  it('returns 404 for an unknown ref', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/zzzzzzzzzzzzzzzzzzzz/secrets`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(404);
  });
});
