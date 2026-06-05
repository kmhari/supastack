import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import { corsOptions, allowedOrigins } from '../../src/config/cors-config.js';

/**
 * Feature 107 — scoped CORS on the API host. US1: the dashboard apex origin gets
 * an exact-origin grant + preflight with the full header allow-list. US2: a foreign
 * origin gets no grant, never `*`. (contracts/cors-policy.md)
 */

const APEX = 'example.test';
const DASH = `https://${APEX}`;

async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify();
  await app.register(cors, corsOptions());
  app.get('/platform/profile', async () => ({ ok: true }));
  app.post('/platform/pg-meta/:ref/query', async () => []);
  return app;
}

let app: FastifyInstance;
beforeAll(async () => {
  process.env.SUPASTACK_APEX = APEX;
  process.env.NODE_ENV = 'test';
  app = await buildApp();
});
afterAll(async () => {
  await app.close();
});

describe('CORS — dashboard origin (US1: happy + preflight)', () => {
  it('GET from the dashboard apex origin → exact-origin echo (never *)', async () => {
    const res = await app.inject({ method: 'GET', url: '/platform/profile', headers: { origin: DASH } });
    expect(res.statusCode).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBe(DASH);
    expect(res.headers['access-control-allow-origin']).not.toBe('*');
  });

  it('preflight OPTIONS allows the methods + the full custom-header allow-list, no credentials', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/platform/pg-meta/r1/query',
      headers: {
        origin: DASH,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type,x-connection-encrypted,x-pg-application-name,x-request-id',
      },
    });
    expect(res.statusCode).toBeLessThan(300);
    expect(res.headers['access-control-allow-origin']).toBe(DASH);
    const methods = String(res.headers['access-control-allow-methods'] ?? '');
    for (const m of ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) expect(methods).toContain(m);
    const headers = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    for (const h of ['authorization', 'x-connection-encrypted', 'x-pg-application-name', 'x-request-id']) {
      expect(headers).toContain(h);
    }
    expect(res.headers['access-control-allow-credentials']).toBeUndefined();
  });

  it('reflects ANY requested header (not a fixed allow-list) — guards against the `version`-header break', async () => {
    const res = await app.inject({
      method: 'OPTIONS',
      url: '/platform/profile',
      headers: {
        origin: DASH,
        'access-control-request-method': 'GET',
        'access-control-request-headers': 'authorization,version,x-some-future-header',
      },
    });
    const headers = String(res.headers['access-control-allow-headers'] ?? '').toLowerCase();
    expect(headers).toContain('version');
    expect(headers).toContain('x-some-future-header');
  });
});

describe('CORS — origin lock (US2: foreign reject, never *)', () => {
  it('a foreign Origin gets NO access-control-allow-origin grant', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/platform/profile',
      headers: { origin: 'https://evil.example' },
    });
    // request still serves (CORS is browser-enforced), but no grant for that origin
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('never echoes a wildcard for any origin', async () => {
    for (const o of [DASH, 'https://evil.example']) {
      const res = await app.inject({ method: 'GET', url: '/platform/profile', headers: { origin: o } });
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
    }
  });
});

describe('allowedOrigins — env scoping', () => {
  it('includes the apex; includes dev origins only in non-production', () => {
    const save = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(allowedOrigins()).toContain(DASH);
    expect(allowedOrigins().some((o) => o.startsWith('http://localhost'))).toBe(true);
    process.env.NODE_ENV = 'production';
    expect(allowedOrigins()).toEqual([DASH]); // production: apex only, no localhost
    process.env.NODE_ENV = save;
  });
});
