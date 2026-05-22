import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;

describe.skipIf(!API || !TOKEN_ADMIN)('GET /api/v1/instances and /:ref — field filtering', () => {
  test('admin sees full port set', async () => {
    const res = await fetch(`${API}/api/v1/instances`, {
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ ports?: Record<string, number> }>;
    if (rows.length > 0) {
      expect(rows[0]!.ports).toHaveProperty('postgres');
      expect(rows[0]!.ports).toHaveProperty('pooler');
    }
  });

  test('member sees only kong+studio ports (no postgres/pooler)', async () => {
    if (!TOKEN_MEMBER) return;
    const res = await fetch(`${API}/api/v1/instances`, {
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(res.status).toBe(200);
    const rows = (await res.json()) as Array<{ ports?: Record<string, number> }>;
    if (rows.length > 0) {
      expect(rows[0]!.ports).toHaveProperty('kong');
      expect(rows[0]!.ports).not.toHaveProperty('postgres');
      expect(rows[0]!.ports).not.toHaveProperty('pooler');
    }
  });
});
