import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;
const REF = process.env.TEST_INSTANCE_REF;

describe.skipIf(!API || !TOKEN_ADMIN || !REF)('Backups (admin)', () => {
  test('POST /backups → 202', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(202);
  });

  test('GET /backups → 200 with array', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/backups`, {
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Array<{ id: string; status: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  test('completed backup has a downloadUrl with signed token', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/backups`, {
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    const body = (await res.json()) as Array<{
      id: string;
      status: string;
      downloadUrl: string | null;
    }>;
    const completed = body.find((r) => r.status === 'completed');
    if (completed) {
      expect(completed.downloadUrl).toMatch(/\/download\?t=[A-Za-z0-9.-]+/);
    }
  });
});

describe.skipIf(!API || !TOKEN_MEMBER || !REF)('Backups — member', () => {
  test('GET /backups → 200 (members can list)', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/backups`, {
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(res.status).toBe(200);
  });

  test('POST /backups → 403 (members cannot create)', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/backups`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('backups (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/backups.js');
    expect(typeof mod.backupsRoutes).toBe('function');
  });

  test('download-tokens module imports + signs', async () => {
    process.env.SESSION_SECRET = 'a'.repeat(64);
    const mod = await import('../../src/services/download-tokens.js');
    const t = mod.signDownloadToken('test-id');
    expect(mod.verifyDownloadToken(t, 'test-id')).toBe(true);
    expect(mod.verifyDownloadToken(t, 'other-id')).toBe(false);
  });
});
