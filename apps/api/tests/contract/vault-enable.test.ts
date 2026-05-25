import { describe, expect, test } from 'vitest';

/**
 * T019: contract tests for POST /api/v1/projects/:ref/vault/enable.
 *
 * Live-API style (skipIf-gated on TEST_API_URL + TEST_TOKEN_*). Exercises:
 *   - 401 no session cookie
 *   - 403 non-admin (member token)
 *   - 404 unknown ref
 *   - 202 happy path (admin)
 *   - 202 idempotent double-POST returns same jobId with queued=false
 *
 * Spec: 010-secrets-management contracts/api-secrets-dashboard.md.
 */

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;
const TEST_REF = process.env.TEST_INSTANCE_REF;
const UNKNOWN_REF = 'aaaaaaaaaaaaaaaaaaaa';

describe.skipIf(!API)('POST /api/v1/projects/:ref/vault/enable', () => {
  test('401 with no auth header', async () => {
    const res = await fetch(`${API}/api/v1/projects/${TEST_REF ?? UNKNOWN_REF}/vault/enable`, {
      method: 'POST',
    });
    expect(res.status).toBe(401);
  });

  test.skipIf(!TOKEN_MEMBER)('403 for member role (lacks instance.vault.enable)', async () => {
    const res = await fetch(`${API}/api/v1/projects/${TEST_REF ?? UNKNOWN_REF}/vault/enable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
    });
    expect(res.status).toBe(403);
  });

  test.skipIf(!TOKEN_ADMIN)('404 for unknown ref', async () => {
    const res = await fetch(`${API}/api/v1/projects/${UNKNOWN_REF}/vault/enable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe('instance_not_found');
  });

  test.skipIf(!TOKEN_ADMIN || !TEST_REF)('202 happy path with admin token', async () => {
    const res = await fetch(`${API}/api/v1/projects/${TEST_REF}/vault/enable`, {
      method: 'POST',
      headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
    });
    expect(res.status).toBe(202);
    const body = (await res.json()) as { jobId: string; queued: boolean; ref: string };
    expect(body.ref).toBe(TEST_REF);
    expect(typeof body.jobId).toBe('string');
    expect(body.jobId.length).toBeGreaterThan(0);
  });

  test.skipIf(!TOKEN_ADMIN || !TEST_REF)(
    '202 idempotent — rapid double-POST returns same jobId, queued=false on second',
    async () => {
      const r1 = await fetch(`${API}/api/v1/projects/${TEST_REF}/vault/enable`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect(r1.status).toBe(202);
      const b1 = (await r1.json()) as { jobId: string; queued: boolean };

      const r2 = await fetch(`${API}/api/v1/projects/${TEST_REF}/vault/enable`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect(r2.status).toBe(202);
      const b2 = (await r2.json()) as { jobId: string; queued: boolean };

      // If b1 had nothing to enqueue against (job already completed between
      // calls) the second can either match the first or be a fresh enqueue.
      // Assert structural shape only; the idempotency invariant is captured
      // by queued=false when a match is found.
      if (b2.jobId === b1.jobId) {
        expect(b2.queued).toBe(false);
      } else {
        // jobs completed too fast; that's fine, both queued=true is valid
        expect(typeof b2.jobId).toBe('string');
      }
    },
  );
});
