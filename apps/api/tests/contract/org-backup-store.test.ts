import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;

describe.skipIf(!API || !TOKEN_ADMIN)('PUT /api/v1/org/backup-store (admin)', () => {
  test('accepts kind=local', async () => {
    const res = await fetch(`${API}/api/v1/org/backup-store`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ kind: 'local' }),
    });
    expect(res.status).toBe(200);
  });

  test('accepts kind=s3 with full config', async () => {
    const res = await fetch(`${API}/api/v1/org/backup-store`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({
        kind: 's3',
        bucket: 'test-bucket',
        region: 'us-east-1',
        accessKeyId: 'TESTKEY',
        secretAccessKey: 'TESTSECRET',
      }),
    });
    expect(res.status).toBe(200);
    // Reset to local for subsequent tests.
    await fetch(`${API}/api/v1/org/backup-store`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ kind: 'local' }),
    });
  });

  test('rejects invalid input (missing bucket on s3)', async () => {
    const res = await fetch(`${API}/api/v1/org/backup-store`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ kind: 's3', region: 'us-east-1' }),
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!API || !TOKEN_MEMBER)('PUT /api/v1/org/backup-store — member', () => {
  test('returns 403', async () => {
    const res = await fetch(`${API}/api/v1/org/backup-store`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_MEMBER}` },
      body: JSON.stringify({ kind: 'local' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('org-backup-store (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/org.js');
    expect(typeof mod.orgRoutes).toBe('function');
  });
});
