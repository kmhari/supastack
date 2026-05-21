import { describe, expect, test } from 'vitest';

/**
 * Contract test for /internal/tls/ask. INTEGRATION-style: needs the API
 * stack running with a known DB state. Skipped unless `TEST_API_URL` is set
 * (CI provides this via the docker-compose-based integration suite).
 *
 * The skip-when-missing pattern keeps `pnpm test` green on dev machines
 * without infra.
 */
const API = process.env.TEST_API_URL;

describe.skipIf(!API)('GET /internal/tls/ask (integration)', () => {
  test('returns 200 for the configured apex domain', async () => {
    const apex = process.env.TEST_APEX ?? 'selfbase.test';
    const res = await fetch(`${API}/internal/tls/ask?domain=${apex}`);
    expect(res.status).toBe(200);
  });

  test('returns 200 for a known running instance subdomain', async () => {
    const ref = process.env.TEST_INSTANCE_REF;
    const apex = process.env.TEST_APEX ?? 'selfbase.test';
    if (!ref) return;
    const res = await fetch(`${API}/internal/tls/ask?domain=${ref}.${apex}`);
    expect(res.status).toBe(200);
  });

  test('returns 404 for an unrelated domain', async () => {
    const res = await fetch(`${API}/internal/tls/ask?domain=evil.example.com`);
    expect(res.status).toBe(404);
  });

  test('returns 404 when domain query param is missing', async () => {
    const res = await fetch(`${API}/internal/tls/ask`);
    expect(res.status).toBe(404);
  });

  test('returns 404 for a malformed ref pattern', async () => {
    const apex = process.env.TEST_APEX ?? 'selfbase.test';
    const res = await fetch(`${API}/internal/tls/ask?domain=NOTAREF.${apex}`);
    expect(res.status).toBe(404);
  });
});

describe('tls-ask (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/tls-ask.js');
    expect(typeof mod.tlsAskRoutes).toBe('function');
  });
});
