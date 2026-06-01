/**
 * T046 — POST /v1/projects/:ref/secrets
 *
 * Spec FR-016 (create/replace), FR-019 (reserved-name guard),
 * FR-018 (no redeploy needed — relies on container restart),
 * FR-020 (encrypted at rest).
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

const ref = `ss${randomBytes(9).toString('hex')}`.slice(0, 20);

describe.skipIf(!hasTestEnv)('POST /v1/projects/:ref/secrets', () => {
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
    // .env file lives one level up from the functions volume:
    // <instancesDir>/<ref>/.env
    envPath = path.join(path.dirname(path.dirname(mock.volumePath)), '.env');
  });

  beforeEach(() => {
    fakeDocker.restartCalls.length = 0;
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  it('creates a secret, encrypts at rest, mirrors into .env, restarts the functions container', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'FOO', value: 'bar' }]),
    });
    expect(res.statusCode).toBe(201);

    // DB row exists; value is encrypted (bytea), NOT plaintext.
    const rows = await db()
      .select()
      .from(schema.projectSecrets)
      .where(eq(schema.projectSecrets.instanceRef, ref));
    const row = rows.find((r) => r.name === 'FOO');
    expect(row).toBeDefined();
    expect(row!.encryptedValue.toString('latin1')).not.toContain('bar');
    expect(row!.valueSha256).toMatch(/^[a-f0-9]{64}$/);

    // .env on disk contains the line.
    const env = await readFile(envPath, 'utf8').catch(() => '');
    expect(env).toContain('FOO=bar');

    // Container restart was triggered exactly once.
    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-functions-1`]);
  });

  it('replacing an existing secret updates DB + .env in place and restarts again', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'FOO', value: 'baz' }]),
    });
    expect(res.statusCode).toBe(201);

    const env = await readFile(envPath, 'utf8');
    expect(env).toContain('FOO=baz');
    expect(env).not.toContain('FOO=bar');
    expect(fakeDocker.restartCalls).toEqual([`selfbase-${ref}-functions-1`]);
  });

  it('rejects a reserved name with 409 code:reserved_name', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'JWT_SECRET', value: 'hacker' }]),
    });
    expect(res.statusCode).toBe(409);
    const body = res.json() as { code: string };
    expect(body.code).toBe('reserved_name');
    // No partial update: JWT_SECRET was not stored.
    const rows = await db()
      .select()
      .from(schema.projectSecrets)
      .where(eq(schema.projectSecrets.instanceRef, ref));
    expect(rows.find((r) => r.name === 'JWT_SECRET')).toBeUndefined();
  });

  it('rejects an invalid name with 422 code:validation', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'foo', value: 'x' }]), // lowercase
    });
    expect(res.statusCode).toBe(422);
  });

  it('atomic batch: rejects the whole batch if any entry is invalid', async () => {
    fakeDocker.restartCalls.length = 0;
    const before = await readFile(envPath, 'utf8').catch(() => '');
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify([
        { name: 'NEWLY_VALID', value: 'shouldNotPersist' },
        { name: 'JWT_SECRET', value: 'hacker' },
      ]),
    });
    expect(res.statusCode).toBe(409);
    // No restart triggered, .env unchanged.
    expect(fakeDocker.restartCalls).toEqual([]);
    const after = await readFile(envPath, 'utf8').catch(() => '');
    expect(after).toBe(before);
    expect(after).not.toContain('NEWLY_VALID');
  });

  it('returns 401 without a token', async () => {
    const res = await app.inject({
      method: 'POST',
      url: `/v1/projects/${ref}/secrets`,
      headers: { 'content-type': 'application/json' },
      payload: JSON.stringify([{ name: 'X', value: 'y' }]),
    });
    expect(res.statusCode).toBe(401);
  });
});
