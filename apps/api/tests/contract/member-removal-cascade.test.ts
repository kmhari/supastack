import { describe, expect, test } from 'vitest';

/**
 * Cascade: deleting a member must invalidate their tokens AND their sessions
 * atomically. We assert by:
 *   1. Pre-seeded TOKEN_TO_REVOKE is associated with TARGET_USER_ID.
 *   2. DELETE /members/:TARGET_USER_ID (as admin)
 *   3. The previously valid TOKEN_TO_REVOKE now returns 401 on /auth/me.
 *
 * Skipped unless the harness pre-seeds: TEST_API_URL, TEST_TOKEN_ADMIN,
 * TEST_TARGET_USER_ID, TEST_TOKEN_TO_REVOKE.
 */
const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TARGET_USER_ID = process.env.TEST_TARGET_USER_ID;
const TOKEN_TO_REVOKE = process.env.TEST_TOKEN_TO_REVOKE;

describe.skipIf(!API || !TOKEN_ADMIN || !TARGET_USER_ID || !TOKEN_TO_REVOKE)(
  'Member removal cascade',
  () => {
    test('victim token is invalid after member-remove', async () => {
      // 1. (sanity) Victim token works before
      const before = await fetch(`${API}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${TOKEN_TO_REVOKE}` },
      });
      expect(before.status).toBe(200);

      // 2. Admin removes the victim
      const del = await fetch(`${API}/api/v1/members/${TARGET_USER_ID}`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect([204, 409]).toContain(del.status);

      if (del.status === 204) {
        // 3. Victim token must now fail
        const after = await fetch(`${API}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${TOKEN_TO_REVOKE}` },
        });
        expect(after.status).toBe(401);
      }
    });
  },
);
