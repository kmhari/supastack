import { describe, expect, test, beforeAll } from 'vitest';

/**
 * Contract test for /setup endpoints. INTEGRATION-style — needs the API
 * stack running and a clean DB at the start. Set TEST_API_URL to enable;
 * SETUP_TEST_RESET_HOOK lets the integration suite reset between runs.
 */
const API = process.env.TEST_API_URL;
const TEST_APEX = process.env.TEST_APEX ?? 'selfbase.test';

let setupAlreadyComplete = false;

beforeAll(async () => {
  if (!API) return;
  const res = await fetch(`${API}/api/v1/setup/status`);
  const body = (await res.json()) as { open: boolean };
  setupAlreadyComplete = !body.open;
});

describe.skipIf(!API)('POST /api/v1/setup', () => {
  test('GET /setup/status returns { open: true } on fresh install', async () => {
    if (setupAlreadyComplete) return; // skip when DB already initialized
    const res = await fetch(`${API}/api/v1/setup/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { open: boolean };
    expect(body.open).toBe(true);
  });

  test('happy path: creates user + org + master token', async () => {
    if (setupAlreadyComplete) return;
    const res = await fetch(`${API}/api/v1/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'test@selfbase.test',
        password: 'test-password-with-12+',
        orgName: 'Test Org',
        apexDomain: TEST_APEX,
      }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { userId: string; orgId: string; apiToken: string };
    expect(body.userId).toBeTruthy();
    expect(body.orgId).toBeTruthy();
    expect(body.apiToken).toMatch(/^sb_[0-9a-f]{64}$/);
    setupAlreadyComplete = true;
  });

  test('second attempt is refused with 410 setup_complete', async () => {
    const res = await fetch(`${API}/api/v1/setup`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        email: 'attacker@evil.test',
        password: 'try-to-take-over-1234',
        orgName: 'Pwned',
      }),
    });
    expect(res.status).toBe(410);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('setup_complete');
  });

  test('after setup, GET /setup/status returns { open: false }', async () => {
    const res = await fetch(`${API}/api/v1/setup/status`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { open: boolean };
    expect(body.open).toBe(false);
  });
});

describe('setup (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/setup.js');
    expect(typeof mod.setupRoutes).toBe('function');
  });
});
