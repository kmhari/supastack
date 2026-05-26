/**
 * T046 — caddy-reload debounce + error tolerance.
 *
 * Mocks undici.fetch. Verifies:
 *   - Two rapid calls only hit Caddy admin once (debounce 200ms)
 *   - Caddy admin error → silent skip (no throw)
 *   - API internal endpoint non-2xx → warn, no throw
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const fetchMock = vi.fn();
vi.mock('undici', () => ({
  fetch: (...args: unknown[]) => fetchMock(...args),
}));

describe('caddy-reload', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.resetModules();
  });

  it('happy path: probes caddy then calls api internal reload', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { handleCaddyReload } = await import('../../../src/jobs/caddy-reload.js');
    await handleCaddyReload();
    // First call: caddy admin probe; second: api internal reload
    expect(fetchMock).toHaveBeenCalled();
    const urls = fetchMock.mock.calls.map((c) => String(c[0]));
    expect(urls.some((u) => u.includes('/config/'))).toBe(true);
    expect(urls.some((u) => u.includes('/internal/caddy/reload'))).toBe(true);
  });

  it('debounce: second call within 200ms is skipped', async () => {
    fetchMock.mockResolvedValue({ ok: true, status: 200 });
    const { handleCaddyReload } = await import('../../../src/jobs/caddy-reload.js');
    await handleCaddyReload();
    const initialCalls = fetchMock.mock.calls.length;
    await handleCaddyReload(); // immediate second
    expect(fetchMock.mock.calls.length).toBe(initialCalls); // unchanged
  });

  it('caddy admin unreachable → silent skip, no throw', async () => {
    fetchMock.mockRejectedValueOnce(new Error('econnrefused'));
    const { handleCaddyReload } = await import('../../../src/jobs/caddy-reload.js');
    await expect(handleCaddyReload()).resolves.toBeUndefined();
  });

  it('api internal reload non-2xx → warn but no throw', async () => {
    fetchMock
      .mockResolvedValueOnce({ ok: true, status: 200 }) // caddy probe
      .mockResolvedValueOnce({ ok: false, status: 502 }); // api reload
    const { handleCaddyReload } = await import('../../../src/jobs/caddy-reload.js');
    await expect(handleCaddyReload()).resolves.toBeUndefined();
  });
});
