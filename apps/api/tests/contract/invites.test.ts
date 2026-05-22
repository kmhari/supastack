import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;

describe.skipIf(!API || !TOKEN_ADMIN)('Invites (admin)', () => {
  test('create + list + revoke (happy path)', async () => {
    const adminH = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` };
    const created = await fetch(`${API}/api/v1/members/invites`, {
      method: 'POST',
      headers: adminH,
      body: JSON.stringify({ email: 'ephemeral+contract@selfbase.test', role: 'member' }),
    });
    expect(created.status).toBe(201);
    const body = (await created.json()) as { id: string; link: string; expiresAt: string };
    expect(body.id).toBeTruthy();
    expect(body.link).toMatch(/\?token=[a-f0-9]{64}$/);

    const list = await fetch(`${API}/api/v1/members/invites`, { headers: adminH });
    expect(list.status).toBe(200);

    const revoke = await fetch(`${API}/api/v1/members/invites/${body.id}`, {
      method: 'DELETE',
      headers: adminH,
    });
    expect(revoke.status).toBe(204);
  });

  test('duplicate open invite rejected with 409 conflict', async () => {
    const adminH = { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` };
    const body = JSON.stringify({ email: 'dup+contract@selfbase.test', role: 'member' });
    const a = await fetch(`${API}/api/v1/members/invites`, {
      method: 'POST',
      headers: adminH,
      body,
    });
    expect(a.status).toBe(201);
    const b = await fetch(`${API}/api/v1/members/invites`, {
      method: 'POST',
      headers: adminH,
      body,
    });
    expect(b.status).toBe(409);
    const created = (await a.json()) as { id: string };
    await fetch(`${API}/api/v1/members/invites/${created.id}`, {
      method: 'DELETE',
      headers: adminH,
    });
  });
});

describe.skipIf(!API || !TOKEN_MEMBER)('Invites — member forbidden', () => {
  test('POST /members/invites → 403', async () => {
    const res = await fetch(`${API}/api/v1/members/invites`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_MEMBER}` },
      body: JSON.stringify({ email: 'x+member-attempt@selfbase.test', role: 'member' }),
    });
    expect(res.status).toBe(403);
  });
});

describe.skipIf(!API)('Invites — accept (open route)', () => {
  test('accept with expired/used/bad token → 410', async () => {
    const res = await fetch(`${API}/api/v1/members/invites/accept`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: 'a'.repeat(64), password: 'long-enough-pw-12+' }),
    });
    expect(res.status).toBe(410);
  });
});

describe('invites (unit smoke)', () => {
  test('module imports cleanly', async () => {
    const mod = await import('../../src/routes/members.js');
    expect(typeof mod.membersRoutes).toBe('function');
  });
});
