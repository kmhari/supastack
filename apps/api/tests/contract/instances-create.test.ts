import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;

const adminH = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${TOKEN_ADMIN}`,
});
const memberH = () => ({
  'content-type': 'application/json',
  authorization: `Bearer ${TOKEN_MEMBER}`,
});

describe.skipIf(!API || !TOKEN_ADMIN)('POST /api/v1/instances', () => {
  test('admin can create; returns 202 + ref', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      method: 'POST',
      headers: adminH(),
      body: JSON.stringify({ name: 'contract-test' }),
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { ref: string; status: string };
    expect(body.ref).toMatch(/^[a-z0-9]{20}$/);
    expect(body.status).toBe('provisioning');
  });

  test('rejects 256-char name with 400 invalid_input', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      method: 'POST',
      headers: adminH(),
      body: JSON.stringify({ name: 'x'.repeat(256) }),
    });
    expect(res.status).toBe(400);
  });
});

describe.skipIf(!API || !TOKEN_MEMBER)('member is forbidden to create', () => {
  test('returns 403 forbidden', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      method: 'POST',
      headers: memberH(),
      body: JSON.stringify({ name: 'member-attempted' }),
    });
    expect(res.status).toBe(403);
  });
});

describe('instances-create (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/instances.js');
    expect(typeof mod.instancesRoutes).toBe('function');
  });
});
