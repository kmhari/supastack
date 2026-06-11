/**
 * T015 — Dashboard Connect-CLI helpers contract test.
 *
 * Spec FR-002: the dashboard surfaces a "Connect CLI" view that gives the
 * developer the exact profile content and a token in one place.
 *
 * Endpoints under test (both on the dashboard surface, NOT the /v1 mgmt API):
 *   GET  /api/v1/cli/profile.toml   → text/plain TOML pre-filled w/ deployment apex
 *   POST /api/v1/cli/mint-token     → { token, label, prefix, id }
 *
 * Both accept either session-cookie auth or bearer-token auth (the auth
 * plugin's preHandler runs globally and populates req.user from either).
 * We use the bearer path here for simpler test setup.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { buildAuthedApp, hasTestEnv, seedTestUser } from '../../helpers/mgmt-api.js';
import { PAT_FORMAT_REGEX } from '../../../src/services/api-tokens.js';

const TEST_APEX = 'cli-e2e.selfbase.test';

describe.skipIf(!hasTestEnv)('/api/v1/cli/* helpers', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    // Apex is env-sourced (feature 117) — set it so profile.toml renders concretely.
    process.env.SUPASTACK_APEX = TEST_APEX;
  });

  afterAll(async () => {
    delete process.env.SUPASTACK_APEX;
    await app?.close();
  });

  describe('GET /api/v1/cli/profile.toml', () => {
    it('returns text/plain TOML pre-filled with the deployment apex', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/cli/profile.toml',
        headers: { authorization: `Bearer ${token}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.headers['content-type']).toMatch(/text\/plain/);
      const body = res.body;
      expect(body).toMatch(/^name\s*=\s*"selfbase"/m);
      expect(body).toMatch(new RegExp(`api_url\\s*=\\s*"https://api\\.${TEST_APEX}"`));
      expect(body).toMatch(new RegExp(`project_host\\s*=\\s*"${TEST_APEX}"`));
    });

    it('returns 401 without a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/cli/profile.toml' });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('POST /api/v1/cli/mint-token', () => {
    it('returns { token, label, prefix, id } where token matches the upstream CLI regex', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cli/mint-token',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: { label: 'integration-test' },
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as {
        token: string;
        label: string;
        prefix: string;
        id: string;
      };
      expect(body.token).toMatch(PAT_FORMAT_REGEX);
      expect(body.label).toBe('integration-test');
      expect(body.prefix).toBe(body.token.slice(0, 12));
      expect(body.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('uses a default label when none is provided', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cli/mint-token',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        payload: {},
      });
      expect(res.statusCode).toBe(201);
      const body = res.json() as { label: string };
      expect(body.label).toMatch(/cli/i);
    });

    it('returns 401 without a token', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/cli/mint-token',
        payload: {},
      });
      expect(res.statusCode).toBe(401);
    });
  });
});
