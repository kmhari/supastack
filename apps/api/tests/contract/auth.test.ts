import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TEST_EMAIL = process.env.TEST_EMAIL ?? 'test@selfbase.test';
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test-password-with-12+';

describe.skipIf(!API)('POST /api/v1/auth/*', () => {
  test('login succeeds with the seeded admin', async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: TEST_PASSWORD }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { role: string };
    expect(body.role).toBe('admin');
  });

  test('login rejects bad credentials with 401', async () => {
    const res = await fetch(`${API}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email: TEST_EMAIL, password: 'wrong-password!!' }),
    });
    expect(res.status).toBe(401);
  });

  test('GET /auth/me requires authentication', async () => {
    const res = await fetch(`${API}/api/v1/auth/me`);
    expect(res.status).toBe(401);
  });
});

describe('auth (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/auth.js');
    expect(typeof mod.authRoutes).toBe('function');
  });
});
