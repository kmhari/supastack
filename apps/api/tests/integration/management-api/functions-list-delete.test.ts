/**
 * T033 — GET /v1/projects/:ref/functions (list)
 *        GET /v1/projects/:ref/functions/:slug (single)
 *        GET /v1/projects/:ref/functions/:slug/body (download)
 *        DELETE /v1/projects/:ref/functions/:slug
 */
import { randomBytes } from 'node:crypto';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import FormData from 'form-data';
import { z } from 'zod';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';
import { FunctionSchema } from '@selfbase/shared';

const ref = `ld${randomBytes(9).toString('hex')}`.slice(0, 20);

async function deployHello(
  app: FastifyInstance,
  token: string,
  slug: string,
  source: string = `Deno.serve(() => new Response('${slug}'));`,
): Promise<void> {
  const form = new FormData();
  form.append(
    'metadata',
    JSON.stringify({
      entrypoint_path: `supabase/functions/${slug}/index.ts`,
      import_map_path: '',
      name: slug,
      verify_jwt: true,
    }),
  );
  form.append('file', Buffer.from(source), {
    filename: `supabase/functions/${slug}/index.ts`,
    contentType: 'application/octet-stream',
  });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/projects/${ref}/functions/deploy?slug=${slug}`,
    headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
    payload: form.getBuffer(),
  });
  if (res.statusCode !== 201) {
    throw new Error(`deploy ${slug} failed: ${res.statusCode} ${res.body}`);
  }
}

describe.skipIf(!hasTestEnv)('functions list / get / body / delete', () => {
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
    await deployHello(app, token, 'hello');
    await deployHello(app, token, 'world');
  });

  afterAll(async () => {
    delete (globalThis as any).__selfbaseFakeDockerControl;
    await app?.close();
  });

  it('GET /functions returns an array of Function shape', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/functions`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => z.array(FunctionSchema).parse(body)).not.toThrow();
    const slugs = (body as Array<{ slug: string }>).map((f) => f.slug);
    expect(slugs).toEqual(expect.arrayContaining(['hello', 'world']));
  });

  it('GET /functions/:slug returns the single record (covers C1 from analyze)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/functions/hello`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(() => FunctionSchema.parse(body)).not.toThrow();
    expect((body as { slug: string }).slug).toBe('hello');
  });

  it('GET /functions/:slug/body returns the source bundle as multipart', async () => {
    const res = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/functions/hello/body`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/multipart\/form-data/);
    // Body should contain the original source bytes and at least one filename.
    expect(res.body).toContain('hello');
    expect(res.body).toContain('Deno.serve');
  });

  it('DELETE /functions/:slug removes the function; subsequent list excludes it and single-GET 404s', async () => {
    const del = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/functions/world`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.statusCode).toBe(200);

    const list = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/functions`,
      headers: { authorization: `Bearer ${token}` },
    });
    const slugs = (list.json() as Array<{ slug: string }>).map((f) => f.slug);
    expect(slugs).not.toContain('world');
    expect(slugs).toContain('hello');

    const single = await app.inject({
      method: 'GET',
      url: `/v1/projects/${ref}/functions/world`,
      headers: { authorization: `Bearer ${token}` },
    });
    expect(single.statusCode).toBe(404);
  });
});
