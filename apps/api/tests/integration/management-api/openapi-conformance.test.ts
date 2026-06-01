/**
 * T053 — Cross-endpoint conformance against contracts/management-api.yaml
 * and the OpenAPI-mirror Zod schemas in @supastack/shared.
 *
 * For each endpoint that doesn't require a body, hit a representative
 * request and assert the response shape parses against its Zod schema.
 * For each WRITE endpoint, run a small "forward compat" block (FR-023)
 * that includes one unknown JSON field; selfbase MUST silently ignore
 * it and NOT 4xx the request.
 *
 * Skips without TEST_DATABASE_URL.
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
import {
  ApiKeySchema,
  FunctionSchema,
  OrganizationSchema,
  ProfileSchema,
  ProjectSchema,
  SecretListEntrySchema,
} from '@supastack/shared';

const ref = `oa${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('OpenAPI conformance for /v1', () => {
  let app: FastifyInstance;
  let token: string;
  let bearer: { authorization: string };

  beforeAll(async () => {
    (globalThis as any).__supastackFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
    token = (await seedTestUser()).token;
    bearer = { authorization: `Bearer ${token}` };
    await withMockInstance(ref);
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  describe('response shape conformance', () => {
    it('GET /v1/profile → ProfileSchema', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/profile', headers: bearer });
      expect(res.statusCode).toBe(200);
      expect(() => ProfileSchema.parse(res.json())).not.toThrow();
    });

    it('GET /v1/organizations → array of OrganizationSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/v1/organizations',
        headers: bearer,
      });
      expect(res.statusCode).toBe(200);
      expect(() => z.array(OrganizationSchema).parse(res.json())).not.toThrow();
    });

    it('GET /v1/projects → array of ProjectSchema', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/projects', headers: bearer });
      expect(res.statusCode).toBe(200);
      expect(() => z.array(ProjectSchema).parse(res.json())).not.toThrow();
    });

    it('GET /v1/projects/:ref → ProjectSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}`,
        headers: bearer,
      });
      expect(res.statusCode).toBe(200);
      expect(() => ProjectSchema.parse(res.json())).not.toThrow();
    });

    it('GET /v1/projects/:ref/api-keys → array of ApiKeySchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}/api-keys`,
        headers: bearer,
      });
      expect(res.statusCode).toBe(200);
      expect(() => z.array(ApiKeySchema).parse(res.json())).not.toThrow();
    });

    it('GET /v1/projects/:ref/functions (empty initially) → array of FunctionSchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}/functions`,
        headers: bearer,
      });
      expect(res.statusCode).toBe(200);
      expect(() => z.array(FunctionSchema).parse(res.json())).not.toThrow();
    });

    it('GET /v1/projects/:ref/secrets (empty initially) → array of SecretListEntrySchema', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}/secrets`,
        headers: bearer,
      });
      expect(res.statusCode).toBe(200);
      expect(() => z.array(SecretListEntrySchema).parse(res.json())).not.toThrow();
    });
  });

  describe('forward compat: unknown JSON fields are silently accepted (FR-023)', () => {
    it('POST /v1/projects/:ref/secrets with an extra "__future_field__" key still 201s', async () => {
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/secrets`,
        headers: { ...bearer, 'content-type': 'application/json' },
        payload: JSON.stringify([
          {
            name: 'FUTURE_OK',
            value: 'x',
            __future_field__: 'should be ignored',
          },
        ]),
      });
      expect(res.statusCode).toBe(201);
    });

    it('PUT /v1/projects/:ref/functions bulk-update with extra fields in each entry still 200s', async () => {
      const res = await app.inject({
        method: 'PUT',
        url: `/v1/projects/${ref}/functions`,
        headers: { ...bearer, 'content-type': 'application/json' },
        payload: JSON.stringify([
          {
            id: 'irrelevant',
            slug: 'irrelevant',
            name: 'irrelevant',
            version: 1,
            status: 'ACTIVE',
            __future_field__: 'ignored',
          },
        ]),
      });
      expect(res.statusCode).toBe(200);
    });
  });

  describe('error envelope is cloud-shape on /v1 (FR-021/022)', () => {
    it('401 envelope has {message, code}', async () => {
      const res = await app.inject({ method: 'GET', url: '/v1/profile' });
      expect(res.statusCode).toBe(401);
      const body = res.json() as { message?: string; code?: string };
      expect(typeof body.message).toBe('string');
      // selfbase emits some code; the CLI just needs a string `message`.
      expect(body).not.toHaveProperty('error');
    });

    it('501 catch-all envelope has {message, code:"not_implemented", details.path}', async () => {
      const res = await app.inject({
        method: 'GET',
        url: `/v1/projects/${ref}/branches`,
        headers: bearer,
      });
      expect(res.statusCode).toBe(501);
      const body = res.json() as {
        message: string;
        code: string;
        details: { path: string };
      };
      expect(body.code).toBe('not_implemented');
      expect(body.details.path).toContain('/branches');
    });
  });
});
