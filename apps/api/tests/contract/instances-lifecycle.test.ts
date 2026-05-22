import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;
const REF = process.env.TEST_INSTANCE_REF;

describe.skipIf(!API || !TOKEN_ADMIN || !REF)('Lifecycle endpoints (admin)', () => {
  test('pause → 202', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/pause`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(202);
  });

  test('resume → 202', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/resume`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(202);
  });

  test('upgrade with backupFirst → 202', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ supabaseVersion: '2026.06.01', backupFirst: true }),
    });
    expect(res.status).toBe(202);
  });

  test('upgrade rejects empty version with 400', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}/upgrade`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
      body: JSON.stringify({ supabaseVersion: '' }),
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!API || !TOKEN_MEMBER || !REF)('Lifecycle endpoints — member forbidden', () => {
  for (const action of ['pause', 'resume', 'restart', 'upgrade']) {
    test(`${action} → 403`, async () => {
      const res = await fetch(`${API}/api/v1/instances/${REF}/${action}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_MEMBER}` },
        body: JSON.stringify(action === 'upgrade' ? { supabaseVersion: '2026.06.01' } : {}),
      });
      expect(res.status).toBe(403);
    });
  }

  test('DELETE → 403', async () => {
    const res = await fetch(`${API}/api/v1/instances/${REF}`, {
      method: 'DELETE',
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(res.status).toBe(403);
  });
});

describe('instances-lifecycle (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/instances.js');
    expect(typeof mod.instancesRoutes).toBe('function');
  });
});
