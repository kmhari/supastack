/**
 * T034 + T043 — PUT /v1/projects/:ref/functions (bulk-update finalize).
 *
 * The CLI calls this once after a multi-function deploy, sending a
 * BulkUpdateFunctionBody array. The server merges with what was already
 * persisted by the per-function POSTs and returns `{functions: [...]}`.
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

const ref = `bk${randomBytes(9).toString('hex')}`.slice(0, 20);

async function deploy(app: FastifyInstance, token: string, slug: string): Promise<void> {
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
  form.append('file', Buffer.from(`Deno.serve(()=>new Response('${slug}'));`), {
    filename: `supabase/functions/${slug}/index.ts`,
    contentType: 'application/octet-stream',
  });
  const res = await app.inject({
    method: 'POST',
    url: `/v1/projects/${ref}/functions/deploy?slug=${slug}&bundleOnly=true`,
    headers: { authorization: `Bearer ${token}`, ...form.getHeaders() },
    payload: form.getBuffer(),
  });
  if (res.statusCode !== 201) {
    throw new Error(`deploy ${slug} failed: ${res.statusCode} ${res.body}`);
  }
}

describe.skipIf(!hasTestEnv)('PUT /v1/projects/:ref/functions (bulk update)', () => {
  let app: FastifyInstance;
  let token: string;

  beforeAll(async () => {
    (globalThis as any).__supastackFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    await withMockInstance(ref);
    // Deploy two functions individually first — mirrors the CLI's
    // multi-function flow.
    await deploy(app, token, 'alpha');
    await deploy(app, token, 'beta');
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  it('returns {functions: [...]} reflecting the stored state, regardless of body', async () => {
    // The CLI sends a BulkUpdateFunctionBody — we accept and return what we
    // already have on disk (server is the source of truth post-POST).
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${ref}/functions`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([
        // Minimal valid entries — server overwrites with its own state.
        { id: 'irrelevant-1', slug: 'alpha', name: 'alpha', version: 1, status: 'ACTIVE' },
        { id: 'irrelevant-2', slug: 'beta', name: 'beta', version: 1, status: 'ACTIVE' },
      ]),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { functions: Array<{ slug: string }> };
    expect(body.functions).toBeInstanceOf(Array);
    const slugs = body.functions.map((f) => f.slug).sort();
    expect(slugs).toEqual(['alpha', 'beta']);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'PUT',
      url: `/v1/projects/${ref}/functions`,
      headers: { 'content-type': 'application/json' },
      payload: '[]',
    });
    expect(res.statusCode).toBe(401);
  });
});
