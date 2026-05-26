/**
 * T022 — mgmt-api error envelope plugin: maps ManagementApiError, AppError,
 * ZodError, fastify validation errors, body-too-large, and 500 fallback to
 * the cloud `{message, code?, details?}` shape (vs the dashboard `{error:{}}`).
 */
import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { errors, AppError } from '@selfbase/shared';
import { mgmtApiErrorsPlugin, ManagementApiError } from '../../../src/plugins/mgmt-api-errors.js';

async function buildApp() {
  const app = Fastify({ bodyLimit: 32 });
  await app.register(async (instance) => {
    await instance.register(mgmtApiErrorsPlugin);
    instance.get('/mgmt', async () => {
      throw new ManagementApiError(409, 'conflict here', 'duplicate', { foo: 'bar' });
    });
    instance.get('/mgmt-no-details', async () => {
      throw new ManagementApiError(404, 'gone', 'not_found');
    });
    instance.get('/app-err', async () => {
      throw errors.unauthenticated();
    });
    instance.get('/app-err-details', async () => {
      throw new AppError(403, 'forbidden' as any, 'denied', { reason: 'rbac' });
    });
    instance.get('/zod-err', async () => {
      throw new ZodError([{ code: 'custom', path: ['foo'], message: 'bad' }]);
    });
    instance.post(
      '/validated',
      {
        schema: {
          body: { type: 'object', required: ['n'], properties: { n: { type: 'number' } } },
        },
      },
      async () => ({ ok: true }),
    );
    instance.get('/boom', async () => {
      throw new Error('database exploded');
    });
    instance.post('/big', async (req) => ({ length: JSON.stringify(req.body).length }));
  });
  await app.ready();
  return app;
}

describe('mgmt-api error envelope plugin', () => {
  let app: FastifyInstance;
  beforeAll(async () => {
    app = await buildApp();
  });
  afterAll(async () => {
    await app.close();
  });

  it('ManagementApiError → exact envelope w/ details', async () => {
    const res = await app.inject({ method: 'GET', url: '/mgmt' });
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({
      message: 'conflict here',
      code: 'duplicate',
      details: { foo: 'bar' },
    });
  });

  it('ManagementApiError without details omits details key', async () => {
    const res = await app.inject({ method: 'GET', url: '/mgmt-no-details' });
    expect(res.statusCode).toBe(404);
    const body = res.json();
    expect(body).toEqual({ message: 'gone', code: 'not_found' });
    expect('details' in body).toBe(false);
  });

  it('AppError (unauthenticated) → 401 cloud-shape', async () => {
    const res = await app.inject({ method: 'GET', url: '/app-err' });
    expect(res.statusCode).toBe(401);
    const body = res.json();
    expect(body.code).toBeDefined();
    expect(body.message).toBeDefined();
    expect((body as any).error).toBeUndefined();
  });

  it('AppError with details passes through', async () => {
    const res = await app.inject({ method: 'GET', url: '/app-err-details' });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toMatchObject({ code: 'forbidden', details: { reason: 'rbac' } });
  });

  it('ZodError → 422 with issues in details', async () => {
    const res = await app.inject({ method: 'GET', url: '/zod-err' });
    expect(res.statusCode).toBe(422);
    const body = res.json();
    expect(body.code).toBe('validation');
    expect(body.details.issues).toBeDefined();
  });

  it('Fastify route-validation error → 400 bad_request', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/validated',
      headers: { 'content-type': 'application/json' },
      payload: '{"n":"not-a-number"}',
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().code).toBe('bad_request');
  });

  it('Body too large → 413 payload_too_large', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/big',
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify({ x: 'y'.repeat(1024) }),
    });
    expect(res.statusCode).toBe(413);
    expect(res.json().code).toBe('payload_too_large');
  });

  it('Unhandled error → 500 generic (no leak of err.message)', async () => {
    const res = await app.inject({ method: 'GET', url: '/boom' });
    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ message: 'Internal server error', code: 'internal' });
  });
});
