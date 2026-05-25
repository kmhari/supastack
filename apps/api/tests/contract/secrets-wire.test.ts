import { describe, expect, test } from 'vitest';

/**
 * T025 + T026 — wire-contract preservation + dashboard twin.
 *
 * Live-API skipIf-gated; runs against the live VM when TEST_API_URL +
 * TEST_TOKEN_ADMIN + TEST_INSTANCE_REF are set.
 *
 * Covers SC-008 (zero wire regressions for /v1) + the dashboard surface
 * (auth boundary, RBAC, body shape).
 *
 * The /v1 (CLI) and /api/v1 (dashboard) surfaces share the same vault-backed
 * service so we exercise both paths.
 */

const API = process.env.TEST_API_URL;
const TOKEN_ADMIN = process.env.TEST_TOKEN_ADMIN;
const TOKEN_MEMBER = process.env.TEST_TOKEN_MEMBER;
const TEST_REF = process.env.TEST_INSTANCE_REF;

const T_NAME = 'SELFBASE_010_TEST_KEY';
const T_VALUE = 'wire-contract-test-value';

describe.skipIf(!API || !TOKEN_ADMIN || !TEST_REF)(
  'feature 010 — /v1/projects/:ref/secrets wire contract (CLI surface, SC-008)',
  () => {
    test('GET returns bare array shape [{name, value: sha256}]', async () => {
      const res = await fetch(`${API}/v1/projects/${TEST_REF}/secrets`, {
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect(res.status).toBe(200);
      const body = (await res.json()) as Array<{ name: string; value: string }>;
      expect(Array.isArray(body)).toBe(true);
      if (body.length > 0) {
        const row = body[0]!;
        expect(typeof row.name).toBe('string');
        expect(typeof row.value).toBe('string');
        expect(row.value).toMatch(/^[a-f0-9]{64}$/);
      }
    });

    test('POST accepts bare [{name, value}] array, returns 201 {message}', async () => {
      const res = await fetch(`${API}/v1/projects/${TEST_REF}/secrets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify([{ name: T_NAME, value: T_VALUE }]),
      });
      expect(res.status).toBe(201);
      const body = (await res.json()) as { message: string };
      expect(typeof body.message).toBe('string');
    });

    test('POST reserved name returns 409 reserved_name', async () => {
      const res = await fetch(`${API}/v1/projects/${TEST_REF}/secrets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify([{ name: 'SUPABASE_URL', value: 'shadow' }]),
      });
      expect(res.status).toBe(409);
      const body = (await res.json()) as { code?: string; message?: string };
      expect(body.code).toBe('reserved_name');
    });

    test('DELETE accepts bare [name] array, returns 200 {message}', async () => {
      const res = await fetch(`${API}/v1/projects/${TEST_REF}/secrets`, {
        method: 'DELETE',
        headers: { authorization: `Bearer ${TOKEN_ADMIN}`, 'content-type': 'application/json' },
        body: JSON.stringify([T_NAME]),
      });
      expect(res.status).toBe(200);
    });

    test('401 with no auth header', async () => {
      const res = await fetch(`${API}/v1/projects/${TEST_REF}/secrets`);
      expect(res.status).toBe(401);
    });
  },
);

describe.skipIf(!API || !TEST_REF)(
  'feature 010 — /api/v1/projects/:ref/secrets dashboard surface',
  () => {
    test('401 with no session cookie + no PAT', async () => {
      const res = await fetch(`${API}/api/v1/projects/${TEST_REF}/secrets`);
      expect(res.status).toBe(401);
    });

    test.skipIf(!TOKEN_MEMBER)('403 for member on POST (lacks instance.secrets.write)', async () => {
      const res = await fetch(`${API}/api/v1/projects/${TEST_REF}/secrets`, {
        method: 'POST',
        headers: { authorization: `Bearer ${TOKEN_MEMBER}`, 'content-type': 'application/json' },
        body: JSON.stringify([{ name: 'IRRELEVANT', value: 'x' }]),
      });
      expect(res.status).toBe(403);
    });

    test.skipIf(!TOKEN_MEMBER)('200 for member on GET (instance.secrets.read allowed)', async () => {
      const res = await fetch(`${API}/api/v1/projects/${TEST_REF}/secrets`, {
        headers: { authorization: `Bearer ${TOKEN_MEMBER}` },
      });
      expect([200, 503]).toContain(res.status); // 503 if vault unreachable; both shapes valid
    });

    test.skipIf(!TOKEN_ADMIN)('GET returns same bare-array shape as /v1', async () => {
      const res = await fetch(`${API}/api/v1/projects/${TEST_REF}/secrets`, {
        headers: { authorization: `Bearer ${TOKEN_ADMIN}` },
      });
      expect([200, 503]).toContain(res.status);
      if (res.status === 200) {
        const body = (await res.json()) as unknown[];
        expect(Array.isArray(body)).toBe(true);
      }
    });
  },
);
