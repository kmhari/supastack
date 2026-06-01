/**
 * T052 — audit-log shape assertion for feature 009 PATCHes.
 *
 * Covers FR-010 + SC-004: every successful PATCH emits exactly one audit
 * row with the field-level diff; secret-typed fields show `***` for both
 * old and new (no plaintext leak per data-model.md).
 */
import { randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { FastifyInstance } from 'fastify';
import { and, eq, desc } from 'drizzle-orm';
import { db, schema } from '@supastack/db';
import { REDACTED_SECRET } from '@supastack/shared';
import {
  buildAuthedApp,
  hasTestEnv,
  seedTestUser,
  withMockInstance,
  createFakeDockerControl,
} from '../../helpers/mgmt-api.js';

const newRef = () => `au${randomBytes(9).toString('hex')}`.slice(0, 20);

async function seedEnv(ref: string): Promise<void> {
  const instancesDir = process.env.INSTANCES_DIR ?? '/tmp/selfbase-test-instances';
  const envPath = path.join(instancesDir, ref, '.env');
  await mkdir(path.dirname(envPath), { recursive: true });
  await writeFile(envPath, 'JWT_EXPIRY=3600\nPGRST_DB_MAX_ROWS=1000\n', {
    mode: 0o600,
  });
}

describe.skipIf(!hasTestEnv)('audit log emission for runtime config PATCHes', () => {
  let app: FastifyInstance;

  beforeAll(async () => {
    (globalThis as any).__supastackFakeDockerControl = createFakeDockerControl();
    app = await buildAuthedApp();
  });

  afterAll(async () => {
    delete (globalThis as any).__supastackFakeDockerControl;
    await app?.close();
  });

  it('auth-config: 2 fields incl. a secret → 1 audit row; secret diff is ***→***', async () => {
    const ref = newRef();
    const { userId, token } = await seedTestUser();
    await withMockInstance(ref);
    await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/config/auth`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({
        jwt_exp: 86400,
        external_google_enabled: true,
        external_google_client_id: 'abc.apps.googleusercontent.com',
        external_google_secret: 'plaintext-should-NOT-appear-in-audit',
      }),
    });
    expect(res.statusCode).toBe(200);

    const rows = await db()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'mgmt_api.auth_config.update'),
          eq(schema.auditLog.targetId, ref),
        ),
      )
      .orderBy(desc(schema.auditLog.createdAt))
      .limit(1);
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.actorUserId).toBe(userId);
    expect(row.targetKind).toBe('instance');

    const payload = row.payload as {
      ref: string;
      surface: string;
      changed_fields: string[];
      diff: Record<string, { old: unknown; new: unknown }>;
    };
    expect(payload.ref).toBe(ref);
    expect(payload.surface).toBe('auth');
    expect(payload.changed_fields).toEqual(
      expect.arrayContaining([
        'jwt_exp',
        'external_google_enabled',
        'external_google_client_id',
        'external_google_secret',
      ]),
    );
    // Non-secret fields have real before/after.
    expect(payload.diff.jwt_exp).toEqual({ old: 3600, new: 86400 });
    // Secret-typed field: both sides redacted. Plaintext MUST NOT appear.
    expect(payload.diff.external_google_secret).toEqual({
      old: REDACTED_SECRET,
      new: REDACTED_SECRET,
    });
    expect(JSON.stringify(payload)).not.toContain('plaintext-should-NOT-appear-in-audit');
  });

  it('postgrest-config: PATCH max_rows → 1 audit row with diff', async () => {
    const ref = newRef();
    const { token } = await seedTestUser();
    await withMockInstance(ref);
    await seedEnv(ref);

    const res = await app.inject({
      method: 'PATCH',
      url: `/v1/projects/${ref}/postgrest`,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      payload: JSON.stringify({ max_rows: 5000 }),
    });
    expect(res.statusCode).toBe(200);

    const rows = await db()
      .select()
      .from(schema.auditLog)
      .where(
        and(
          eq(schema.auditLog.action, 'mgmt_api.postgrest.update'),
          eq(schema.auditLog.targetId, ref),
        ),
      );
    expect(rows).toHaveLength(1);
    const payload = rows[0]!.payload as {
      changed_fields: string[];
      diff: Record<string, { old: unknown; new: unknown }>;
    };
    expect(payload.changed_fields).toContain('max_rows');
    expect(payload.diff.max_rows).toEqual({ old: 1000, new: 5000 });
  });
});
