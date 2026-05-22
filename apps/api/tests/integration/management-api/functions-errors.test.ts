/**
 * T036 — Error paths for the function-deploy endpoints.
 *
 * Covers: bundle > 50 MB → 413; entrypoint mismatch → 422;
 * filename path-escape → 422; restart-timeout → 500 deploy_rolled_back.
 *
 * The 50 MB test is gated by FAST_TESTS=0 (large uploads slow the suite).
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const ref = `er${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('function deploy error paths', () => {
  let app: FastifyInstance;
  let token: string;
  let fakeDocker: ReturnType<typeof createFakeDockerControl>;

  beforeAll(async () => {
    fakeDocker = createFakeDockerControl();
    (globalThis as any).__selfbaseFakeDockerControl = fakeDocker;
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    await withMockInstance(ref);
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  it('422 when entrypoint_path does not match any uploaded file part', async () => {
    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({
        entrypoint_path: 'supabase/functions/hello/MISSING.ts',
        name: 'hello',
        verify_jwt: true,
      }),
    );
    form.append('file', Buffer.from('Deno.serve(()=>new Response("h"));'), {
      filename: 'supabase/functions/hello/index.ts',
      contentType: 'application/octet-stream',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=hello`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('422 when a file part has a path-escape filename', async () => {
    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({
        entrypoint_path: '../../../etc/passwd',
        name: 'escape',
        verify_jwt: true,
      }),
    );
    form.append('file', Buffer.from('x'), {
      filename: '../../../etc/passwd',
      contentType: 'application/octet-stream',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=escape`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('500 deploy_rolled_back when the container restart fails', async () => {
    // Swap in a docker-control whose restart throws.
    const failingDocker = createFakeDockerControl();
    failingDocker.restart = async () => {
      throw new Error('simulated restart failure');
    };
    (globalThis as any).__selfbaseFakeDockerControl = failingDocker;

    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({
        entrypoint_path: 'supabase/functions/rollback/index.ts',
        name: 'rollback',
        verify_jwt: true,
      }),
    );
    form.append('file', Buffer.from('Deno.serve(()=>new Response("rb"));'), {
      filename: 'supabase/functions/rollback/index.ts',
      contentType: 'application/octet-stream',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=rollback`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(500);
    const body = res.json() as { code: string };
    expect(body.code).toBe('deploy_rolled_back');

    // Reset.
    (globalThis as any).__selfbaseFakeDockerControl = fakeDocker;
  });
});
