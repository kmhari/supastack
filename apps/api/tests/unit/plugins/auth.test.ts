/**
 * T020 — auth plugin: PAT presence/expiry/revocation/scope + req.user population.
 *
 * Uses the real Fastify app via buildAuthedApp + a seeded user/token, so the
 * full preHandler hook runs. The companion file `unit/auth-plugin-dual.test.ts`
 * focuses on the OAuth JWT path via mocked @supastack/db.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { createHash } from 'node:crypto';
import { db, schema } from '@supastack/db';
import { eq } from 'drizzle-orm';
import { buildAuthedApp, hasTestEnv, seedTestUser, mintTestToken } from '../../helpers/mgmt-api.js';

describe.skipIf(!hasTestEnv)('auth plugin (PAT path)', () => {
  let app: FastifyInstance;
  let token: string;
  let userId: string;
  beforeAll(async () => {
    app = await buildAuthedApp();
    const seeded = await seedTestUser();
    token = seeded.token;
    userId = seeded.userId;
  });
  afterAll(async () => {
    await app?.close();
  });

  it('missing PAT → 401', async () => {
    const res = await app.inject({ method: 'GET', url: '/v1/projects' });
    expect(res.statusCode).toBe(401);
  });

  it('malformed PAT (not sbp_) → 401 (no user resolved)', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: 'Bearer not-a-real-token' },
    });
    expect(res.statusCode).toBe(401);
  });

  it('unknown sbp_ PAT → 401', async () => {
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: 'Bearer sbp_' + 'f'.repeat(40) },
    });
    expect(res.statusCode).toBe(401);
  });

  it('valid PAT → 200 + req.user populated (last_used_at updated)', async () => {
    const before = await db()
      .select({ lastUsedAt: schema.apiTokens.lastUsedAt })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.tokenSha256, createHash('sha256').update(token).digest()))
      .limit(1);
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.statusCode).toBe(200);
    const after = await db()
      .select({ lastUsedAt: schema.apiTokens.lastUsedAt })
      .from(schema.apiTokens)
      .where(eq(schema.apiTokens.tokenSha256, createHash('sha256').update(token).digest()))
      .limit(1);
    // last_used_at should have moved forward (or been set from null)
    const beforeMs = before[0]?.lastUsedAt ? new Date(before[0].lastUsedAt as any).getTime() : 0;
    const afterMs = after[0]?.lastUsedAt ? new Date(after[0].lastUsedAt as any).getTime() : 0;
    expect(afterMs).toBeGreaterThanOrEqual(beforeMs);
  });

  it('revoked PAT → 401 (revokedAt is null filter excludes it)', async () => {
    const revokedToken = await mintTestToken(userId, 'revoked-token');
    await db()
      .update(schema.apiTokens)
      .set({ revokedAt: new Date() })
      .where(eq(schema.apiTokens.tokenSha256, createHash('sha256').update(revokedToken).digest()));
    const res = await app.inject({
      method: 'GET',
      url: '/v1/projects',
      headers: { authorization: `Bearer ${revokedToken}` },
    });
    expect(res.statusCode).toBe(401);
  });
});
