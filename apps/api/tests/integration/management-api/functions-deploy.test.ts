/**
 * T032 — POST /v1/projects/:ref/functions/deploy (multipart, --use-api path).
 *
 * Spec: contracts/functions-deploy.md §1
 * The CLI's `--use-api` flow: one metadata JSON part + N raw `file` parts.
 * Server-side: stream-parse, write to per-instance volume, restart container.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
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
import { DeployFunctionResponseSchema } from '@selfbase/shared';

const ref = `fn${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('POST /v1/projects/:ref/functions/deploy (multipart)', () => {
  let app: FastifyInstance;
  let token: string;
  let volumePath: string;
  let fakeDocker: ReturnType<typeof createFakeDockerControl>;

  beforeAll(async () => {
    fakeDocker = createFakeDockerControl();
    // Wire the fake docker-control before buildAuthedApp imports the deploy
    // service. The service reads docker-control via a module-level injector
    // that buildAuthedApp will swap in (see function-deploy.ts).
    process.env.__TEST_FAKE_DOCKER_CONTROL = '1';
    (globalThis as any).__selfbaseFakeDockerControl = fakeDocker;
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    const mock = await withMockInstance(ref);
    volumePath = mock.volumePath;
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  it('writes source files, restarts the functions container, and returns DeployFunctionResponse', async () => {
    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({
        entrypoint_path: 'supabase/functions/hello/index.ts',
        import_map_path: '',
        name: 'hello',
        static_patterns: [],
        verify_jwt: true,
      }),
    );
    const source = `Deno.serve(() => new Response('hi'));\n`;
    form.append('file', Buffer.from(source), {
      filename: 'supabase/functions/hello/index.ts',
      contentType: 'application/octet-stream',
    });

    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=hello`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });

    expect(res.statusCode).toBe(201);
    const body = res.json();
    expect(() => DeployFunctionResponseSchema.parse(body)).not.toThrow();
    expect(body).toMatchObject({ slug: 'hello', status: 'ACTIVE', version: 1 });

    // Container restart was triggered exactly once.
    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-functions-1`]);

    // Source landed on disk.
    const onDisk = await readFile(path.join(volumePath, 'hello', 'index.ts'), 'utf8');
    expect(onDisk).toBe(source);

    // meta.json sidecar present and points at index.ts.
    const meta = JSON.parse(await readFile(path.join(volumePath, 'hello', 'meta.json'), 'utf8'));
    expect(meta.source_path).toBe('index.ts');
    expect(meta.entrypoint_path).toBe('supabase/functions/hello/index.ts');
    expect(meta.verify_jwt).toBe(true);
  });

  it('returns 422 for a slug that fails the regex', async () => {
    const form = new FormData();
    form.append(
      'metadata',
      JSON.stringify({ entrypoint_path: 'x', name: 'BadSlug', verify_jwt: true }),
    );
    form.append('file', Buffer.from(''), {
      filename: 'x',
      contentType: 'application/octet-stream',
    });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=BadSlug`,
      headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(422);
  });

  it('returns 401 without a token', async () => {
    const form = new FormData();
    form.append('metadata', '{}');
    form.append('file', Buffer.from(''), { filename: 'x' });
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/functions/deploy?slug=hello`,
      headers: form.getHeaders(),
      payload: form.getBuffer(),
    });
    expect(res.statusCode).toBe(401);
  });
});
