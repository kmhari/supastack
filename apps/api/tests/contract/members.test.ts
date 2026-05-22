import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;
const ADMIN_USER_ID = process.env.TEST_ADMIN_USER_ID;
const TARGET_USER_ID = process.env.TEST_TARGET_USER_ID;

describe.skipIf(!API)('GET /members', () => {
  test.skipIf(!TOKEN_ADMIN)('admin → 200 with array', async () => {
    const r = await fetch(`${API}/api/v1/members`, {
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(r.status).toBe(200);
    const body = (await r.json()) as Array<{ userId: string; role: string }>;
    expect(Array.isArray(body)).toBe(true);
  });

  test.skipIf(!TOKEN_MEMBER)('member → 200 (members can list)', async () => {
    const r = await fetch(`${API}/api/v1/members`, {
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(r.status).toBe(200);
  });
});

describe.skipIf(!API || !TOKEN_ADMIN || !ADMIN_USER_ID)('DELETE /members/:userId', () => {
  test('refuses self-removal', async () => {
    const r = await fetch(`${API}/api/v1/members/${ADMIN_USER_ID}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(r.status).toBe(400);
  });

  test.skipIf(!TARGET_USER_ID)('admin → 204 on a removable target', async () => {
    const r = await fetch(`${API}/api/v1/members/${TARGET_USER_ID}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect([204, 409]).toContain(r.status); // 409 if last-admin guard fires
  });
});

describe.skipIf(!API || !TOKEN_MEMBER || !TARGET_USER_ID)('member forbidden', () => {
  test('DELETE /members/:userId → 403', async () => {
    const r = await fetch(`${API}/api/v1/members/${TARGET_USER_ID}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(r.status).toBe(403);
  });
});
