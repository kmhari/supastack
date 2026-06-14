/**
 * VM-Backed Proxy Smoke Tests (US1 — feature 113)
 *
 * Verifies all five proxy surface groups return 2xx against the live VM.
 * Skipped automatically when env vars are absent — safe for CI.
 *
 * Required env vars:
 *   TEST_API_URL         — e.g. https://api.supaviser.dev
 *   TEST_TOKEN_ADMIN     — admin PAT (sbp_…)
 *   TEST_INSTANCE_REF    — healthy project ref (6-char alphanum)
 *
 * Optional:
 *   TEST_FAILED_INSTANCE_REF — project ref in failed/crashed state
 */
import { describe, it, expect } from 'vitest';

const ENABLED = !!(
  process.env.TEST_API_URL &&
  process.env.TEST_TOKEN_ADMIN &&
  process.env.TEST_INSTANCE_REF
);

const BASE = process.env.TEST_API_URL ?? '';
const TOKEN = process.env.TEST_TOKEN_ADMIN ?? '';
const REF = process.env.TEST_INSTANCE_REF ?? '';
const FAILED_REF = process.env.TEST_FAILED_INSTANCE_REF ?? '';

function headers(): Record<string, string> {
  return {
    Authorization: `Bearer ${TOKEN}`,
    'Content-Type': 'application/json',
  };
}

async function get(path: string): Promise<Response> {
  return fetch(`${BASE}${path}`, { headers: headers(), signal: AbortSignal.timeout(30_000) });
}

async function post(path: string, body: unknown): Promise<Response> {
  return fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30_000),
  });
}

describe.skipIf(!ENABLED)('Platform proxy smoke tests (live VM)', () => {
  it('pg-meta: GET /platform/pg-meta/:ref/tables returns 2xx array', async () => {
    const res = await get(`/platform/pg-meta/${REF}/tables`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('storage: GET /platform/storage/:ref/buckets returns 2xx array', async () => {
    const res = await get(`/platform/storage/${REF}/buckets`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('storage list: POST objects/list returns 2xx (not 400 from unnormalized body)', async () => {
    const bucketRes = await get(`/platform/storage/${REF}/buckets`);
    const buckets = (await bucketRes.json()) as Array<{ id: string }>;
    const bucketId = buckets[0]?.id ?? 'default';
    const res = await post(`/platform/storage/${REF}/buckets/${bucketId}/objects/list`, {
      path: '',
      options: { limit: 10, offset: 0, search: '', sortBy: { column: 'name', order: 'asc' } },
    });
    expect(res.status).not.toBe(400);
    expect(res.status).toBeLessThan(300);
    const body = await res.json();
    expect(Array.isArray(body)).toBe(true);
  });

  it('auth admin: GET /platform/auth/:ref/users returns 2xx', async () => {
    const res = await get(`/platform/auth/${REF}/users`);
    expect(res.status).toBeGreaterThanOrEqual(200);
    expect(res.status).toBeLessThan(300);
  });

  it('analytics: GET logs.all returns not-500 (guards path-doubling regression from feature 112)', async () => {
    const res = await get(`/platform/projects/${REF}/analytics/endpoints/logs.all`);
    expect(res.status).not.toBe(500);
  });

  it.skipIf(!FAILED_REF)(
    'failed project: pg-meta returns not-503 (guards UNAVAILABLE_STATUSES fix from feature 112)',
    async () => {
      const res = await get(`/platform/pg-meta/${FAILED_REF}/tables`);
      expect(res.status).not.toBe(503);
    },
  );
});
