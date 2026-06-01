/**
 * T035 — POST /v1/projects/:ref/functions (eszip body, default deploy path)
 *        PATCH /v1/projects/:ref/functions/:slug (eszip body, update)
 *
 * Spec: contracts/functions-deploy.md §2. The CLI default uses Docker to
 * pre-bundle locally, then ships raw eszip bytes with
 * `Content-Type: application/vnd.denoland.eszip`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';
import { DeployFunctionResponseSchema } from '@supastack/shared';

const ref = `ez${randomBytes(9).toString('hex')}`.slice(0, 20);

/**
 * Build a fake eszip body: starts with `ESZIP2.3` magic header followed by
 * random bytes. The runtime won't actually load this, but selfbase's
 * validation only checks the magic; the runtime restart is faked.
 */
function fakeEszip(): Buffer {
  const header = Buffer.from('ESZIP2.3', 'utf8');
  const rest = randomBytes(512);
  return Buffer.concat([header, rest]);
}

describe.skipIf(!hasTestEnv)('functions deploy via eszip path', () => {
  let app: FastifyInstance;
  let token: string;
  let volumePath: string;

  beforeAll(async () => {
    (globalThis as any).__supastackFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    const mock = await withMockInstance(ref);
    volumePath = mock.volumePath;
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  describe('POST /v1/projects/:ref/functions (create)', () => {
    it('persists the eszip + meta.json and returns DeployFunctionResponse', async () => {
      const body = fakeEszip();
      const sha = createHash('sha256').update(body).digest('hex');
      const qs = new URLSearchParams({
        slug: 'hello',
        name: 'hello',
        verify_jwt: 'true',
        import_map_path: '',
        entrypoint_path: 'file:///app/supabase/functions/hello/index.ts',
        ezbr_sha256: sha,
      }).toString();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/functions?${qs}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.denoland.eszip',
        },
        payload: body,
      });
      expect(res.statusCode).toBe(201);
      const json = res.json();
      expect(() => DeployFunctionResponseSchema.parse(json)).not.toThrow();
      expect(json).toMatchObject({ slug: 'hello', status: 'ACTIVE' });
      // Eszip lands at <slug>/bundle.eszip + meta.json with source_path.
      const onDisk = await readFile(path.join(volumePath, 'hello', 'bundle.eszip'));
      expect(onDisk.equals(body)).toBe(true);
      const meta = JSON.parse(await readFile(path.join(volumePath, 'hello', 'meta.json'), 'utf8'));
      expect(meta.source_path).toBe('bundle.eszip');
      expect(meta.ezbr_sha256).toBe(sha);
    });

    it('rejects a body with invalid magic bytes (422 code:invalid_eszip)', async () => {
      const body = Buffer.from('NOTAZIPHEADER, just text', 'utf8');
      const qs = new URLSearchParams({
        slug: 'bad',
        name: 'bad',
        ezbr_sha256: createHash('sha256').update(body).digest('hex'),
      }).toString();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/functions?${qs}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.denoland.eszip',
        },
        payload: body,
      });
      expect(res.statusCode).toBe(422);
      const err = res.json() as { code: string };
      expect(err.code).toBe('invalid_eszip');
    });

    it('rejects a sha256 mismatch (422 code:ezbr_mismatch)', async () => {
      const body = fakeEszip();
      const wrongSha = '0'.repeat(64);
      const qs = new URLSearchParams({
        slug: 'mismatch',
        name: 'mismatch',
        ezbr_sha256: wrongSha,
      }).toString();
      const res = await app.inject({
        method: 'POST',
        url: `/v1/projects/${ref}/functions?${qs}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.denoland.eszip',
        },
        payload: body,
      });
      expect(res.statusCode).toBe(422);
      const err = res.json() as { code: string };
      expect(err.code).toBe('ezbr_mismatch');
    });
  });

  describe('PATCH /v1/projects/:ref/functions/:slug (update)', () => {
    it('replaces the eszip and returns 200 with the updated record', async () => {
      // First create one to update.
      const initial = fakeEszip();
      const initialSha = createHash('sha256').update(initial).digest('hex');
      const createRes = await app.inject({
        method: 'POST',
        url:
          `/v1/projects/${ref}/functions?slug=updater&name=updater&` +
          `verify_jwt=true&import_map_path=&entrypoint_path=file:///app/index.ts&` +
          `ezbr_sha256=${initialSha}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.denoland.eszip',
        },
        payload: initial,
      });
      expect(createRes.statusCode).toBe(201);

      // Now PATCH with new bytes.
      const updated = fakeEszip();
      const updatedSha = createHash('sha256').update(updated).digest('hex');
      const patchRes = await app.inject({
        method: 'PATCH',
        url:
          `/v1/projects/${ref}/functions/updater?` +
          `verify_jwt=true&import_map_path=&entrypoint_path=file:///app/index.ts&` +
          `ezbr_sha256=${updatedSha}`,
        headers: {
          authorization: `Bearer ${token}`,
          'content-type': 'application/vnd.denoland.eszip',
        },
        payload: updated,
      });
      expect(patchRes.statusCode).toBe(200);
      const body = patchRes.json() as { slug: string; ezbr_sha256?: string };
      expect(body.slug).toBe('updater');
      expect(body.ezbr_sha256).toBe(updatedSha);
    });
  });
});
