import { describe, expect, test } from 'vitest';

/**
 * Feature 122 US3 / FR-007 (D7) — contract: removing a member must revoke the
 * credentials that reached the org. Repointed from the deleted
 * `DELETE /api/v1/members/:id` route to the live one (feature 084 moved member
 * removal to `DELETE /platform/organizations/:slug/members/:gotrue_id`).
 *
 * Asserts:
 *   1. (sanity) TOKEN_TO_REVOKE works before removal.
 *   2. Admin removes TARGET_USER_ID from ORG_SLUG.
 *   3. If the removal left the user with zero orgs, TOKEN_TO_REVOKE is now
 *      revoked (401). A multi-org user keeps their PAT (FR-009) — set
 *      TEST_EXPECT_TOKEN_REVOKED=false to assert that path instead.
 *
 * Skipped unless the harness pre-seeds a live api + fixtures.
 */
const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const ORG_SLUG = process.env.TEST_ORG_SLUG;
const TARGET_USER_ID = process.env.TEST_TARGET_USER_ID;
const TOKEN_TO_REVOKE = process.env.TEST_TOKEN_TO_REVOKE;
// Default: the removed user is left with zero orgs, so their PAT is revoked.
const EXPECT_REVOKED = process.env.TEST_EXPECT_TOKEN_REVOKED !== 'false';

describe.skipIf(!API || !TOKEN_ADMIN || !ORG_SLUG || !TARGET_USER_ID || !TOKEN_TO_REVOKE)(
  'Member removal cascade',
  () => {
    test('victim credential state matches removal outcome', async () => {
      // 1. Victim token works before.
      const before = await fetch(`${API}/api/v1/auth/me`, {
        headers: { authorization: `Bearer ${TOKEN_TO_REVOKE}` },
      });
      expect(before.status).toBe(200);

      // 2. Admin removes the victim from the org.
      const del = await fetch(
        `${API}/platform/organizations/${ORG_SLUG}/members/${TARGET_USER_ID}`,
        {
          method: 'DELETE',
          headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
        },
      );
      expect([204, 409]).toContain(del.status);

      if (del.status === 204) {
        // 3. Zero-org → PAT revoked (401); multi-org → PAT still valid (200).
        const after = await fetch(`${API}/api/v1/auth/me`, {
          headers: { authorization: `Bearer ${TOKEN_TO_REVOKE}` },
        });
        expect(after.status).toBe(EXPECT_REVOKED ? 401 : 200);
      }
    });
  },
);
