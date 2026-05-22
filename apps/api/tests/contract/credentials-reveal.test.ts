import { describe, expect, test } from 'vitest';

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TEST_REF = process.env.TEST_INSTANCE_REF;
const TEST_PASSWORD = process.env.TEST_PASSWORD ?? 'test-password-with-12+';

describe.skipIf(!API || !TOKEN_ADMIN || !TEST_REF)(
  'POST /api/v1/instances/:ref/credentials/reveal',
  () => {
    test('rejects wrong password with 401 reauth_required', async () => {
      const res = await fetch(`${API}/api/v1/instances/${TEST_REF}/credentials/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
        body: JSON.stringify({ password: 'definitely-wrong' }),
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code).toBe('reauth_required');
    });

    test('accepts correct password, returns real anon + service_role keys', async () => {
      const res = await fetch(`${API}/api/v1/instances/${TEST_REF}/credentials/reveal`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN_ADMIN}` },
        body: JSON.stringify({ password: TEST_PASSWORD }),
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        anonKey: string;
        serviceRoleKey: string;
        jwtSecret: string;
      };
      // Anti-SupaConsole: these must be real HS256 tokens (3 segments separated by .)
      expect(body.anonKey.split('.')).toHaveLength(3);
      expect(body.serviceRoleKey.split('.')).toHaveLength(3);
      expect(body.jwtSecret).toBeTruthy();
    });
  },
);
