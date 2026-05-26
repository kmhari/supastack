/**
 * T043 — pg-edge-cert-issue: happy path, api error path.
 *
 * The job is a thin shim — it POSTs to the api's internal endpoint and
 * throws on non-2xx so BullMQ retries (exponential backoff in queue cfg).
 * We mock the global fetch (the job uses the platform global, not undici).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { handlePgEdgeCertIssue } from '../../../src/jobs/pg-edge-cert-issue.js';

describe('pg-edge-cert-issue', () => {
  const ref = 'r0000000000000000001';
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('happy path: parses hostname + notAfter', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ hostname: `db.${ref}.example.test`, notAfter: '2099-01-01' }),
        text: async () => '',
      }),
    );
    await expect(handlePgEdgeCertIssue({ ref })).resolves.toBeUndefined();
  });

  it('api 500 → throws so BullMQ retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        json: async () => ({}),
        text: async () => 'acme dns timeout',
      }),
    );
    await expect(handlePgEdgeCertIssue({ ref })).rejects.toThrow(/pg-edge-cert-issue api 500/);
  });

  it('api 429 (rate-limit) → throws so BullMQ retries', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({}),
        text: async () => 'rate limited',
      }),
    );
    await expect(handlePgEdgeCertIssue({ ref })).rejects.toThrow(/429/);
  });
});
