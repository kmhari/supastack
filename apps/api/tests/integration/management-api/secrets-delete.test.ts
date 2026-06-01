/**
 * T047 — DELETE /v1/projects/:ref/secrets (FR-017).
 *
 * Body is a JSON array of names. Idempotent: deleting a non-existent
 * name is success, not 404. Triggers a container restart so the
 * functions container drops the unset var from its env on next boot.
 */
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { db, schema } from '@supastack/db';
import { eq } from 'drizzle-orm';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const ref = `sd${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('DELETE /v1/projects/:ref/secrets', () => {
  let app: FastifyInstance;
  let token: string;
  let fakeDocker: ReturnType<typeof createFakeDockerControl>;
  let envPath: string;

  beforeAll(async () => {
    fakeDocker = createFakeDockerControl();
    (globalThis as any).__supastackFakeDockerControl = fakeDocker;
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    const mock = await withMockInstance(ref);
    envPath = path.join(path.dirname(path.dirname(mock.volumePath)), '.env');

    // Seed two secrets to delete.
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([
        { name: 'STRIPE_KEY', value: 'sk_test_123' },
        { name: 'OPENAI_KEY', value: 'sk-456' },
      ]),
    });
  });

  beforeEach(() => {
    fakeDocker.restartCalls.length = 0;
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  it('removes the DB row and the .env line, restarts the functions container', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify(['STRIPE_KEY']),
    });
    expect(res.statusCode).toBe(200);

    const rows = await db()
      .select()
      .from(schema.projectSecrets)
      .where(eq(schema.projectSecrets.instanceRef, ref));
    expect(rows.find((r) => r.name === 'STRIPE_KEY')).toBeUndefined();
    expect(rows.find((r) => r.name === 'OPENAI_KEY')).toBeDefined();

    const env = await readFile(envPath, 'utf8');
    expect(env).not.toContain('STRIPE_KEY');
    expect(env).toContain('OPENAI_KEY=sk-456');

    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-functions-1`]);
  });

  it('deleting a non-existent name is idempotent (200, no error)', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify(['DOES_NOT_EXIST']),
    });
    expect(res.statusCode).toBe(200);
    // Restart still fires — the .env file may have changed (no-op deletes
    // are still wrapped in the standard write+restart cycle).
    expect(fakeDocker.restartCalls.length).toBe(1);
  });

  it('bulk delete removes multiple', async () => {
    // Seed a fresh secret to delete alongside.
    await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'EXTRA', value: 'x' }]),
    });
    fakeDocker.restartCalls.length = 0;

    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify(['OPENAI_KEY', 'EXTRA']),
    });
    expect(res.statusCode).toBe(200);
    const rows = await db()
      .select()
      .from(schema.projectSecrets)
      .where(eq(schema.projectSecrets.instanceRef, ref));
    expect(rows.find((r) => r.name === 'OPENAI_KEY')).toBeUndefined();
    expect(rows.find((r) => r.name === 'EXTRA')).toBeUndefined();
    // Single restart for the whole batch.
    expect(fakeDocker.restartCalls.length).toBe(1);
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'DELETE',
      url: `/v1/projects/${ref}/secrets`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify(['X']),
    });
    expect(res.statusCode).toBe(401);
  });
});
