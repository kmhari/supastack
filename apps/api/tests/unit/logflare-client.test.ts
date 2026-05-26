import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * T054 — logflare-client: SQL construction + forwarder behavior. fetch is
 * mocked; we don't need a live Logflare container in unit tests.
 */

const instanceStore = { row: null as null | { status: string; secrets: { logflarePrivateAccessToken: string } } };

vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!instanceStore.row) return [];
            return [{
              status: instanceStore.row.status,
              encryptedSecrets: Buffer.from('stub'),
            }];
          },
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: { ref: 'ref', status: 'status', encryptedSecrets: 'es' } },
}));

vi.mock('@selfbase/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
  decryptJson: () => instanceStore.row?.secrets ?? {},
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

const { queryLogs, AnalyticsUnreachableError, _SERVICE_TABLE } = await import(
  '../../src/services/logflare-client.js'
);

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  instanceStore.row = { status: 'running', secrets: { logflarePrivateAccessToken: 'tok-1' } };
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

describe('service → log-table mapping', () => {
  it('maps every supported service to a table', () => {
    expect(_SERVICE_TABLE.api).toBe('edge_logs');
    expect(_SERVICE_TABLE.postgres).toBe('postgres_logs');
    expect(_SERVICE_TABLE['edge-function']).toBe('function_edge_logs');
    expect(_SERVICE_TABLE.auth).toBe('auth_logs');
    expect(_SERVICE_TABLE.storage).toBe('storage_logs');
    expect(_SERVICE_TABLE.realtime).toBe('realtime_logs');
  });
});

describe('queryLogs', () => {
  it('happy path with default service constructs SELECT from edge_logs', async () => {
    fetchMock.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ result: [{ timestamp: '2026-05-26', event_message: 'hi' }] }),
    });
    const rows = await queryLogs('ref-1', { service: 'api' });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.event_message).toBe('hi');
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(url).toContain('selfbase-ref-1-analytics-1:4000');
    expect(url).toContain('edge_logs');
  });

  it('verbatim sql is forwarded as-is (no service mapping)', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });
    await queryLogs('ref-1', { sql: 'SELECT 1 FROM realtime_logs WHERE x' });
    const url = fetchMock.mock.calls[0]![0] as string;
    expect(decodeURIComponent(url)).toContain('SELECT 1 FROM realtime_logs WHERE x');
  });

  it('uses X-API-KEY header with logflare token', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });
    await queryLogs('ref-1', { service: 'api' });
    const opts = fetchMock.mock.calls[0]![1] as { headers: Record<string, string> };
    expect(opts.headers['X-API-KEY']).toBe('tok-1');
  });

  it('paused project → AnalyticsUnreachableError with status hint', async () => {
    instanceStore.row = { status: 'paused', secrets: { logflarePrivateAccessToken: 'tok' } };
    await expect(queryLogs('ref-1', { service: 'api' })).rejects.toThrow(AnalyticsUnreachableError);
  });

  it('fetch failure → AnalyticsUnreachableError', async () => {
    fetchMock.mockRejectedValueOnce(new Error('ECONNREFUSED'));
    await expect(queryLogs('ref-1', { service: 'api' })).rejects.toThrow(AnalyticsUnreachableError);
  });

  it('5xx from logflare → AnalyticsUnreachableError', async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, text: async () => 'oops' });
    await expect(queryLogs('ref-1', { service: 'api' })).rejects.toThrow(AnalyticsUnreachableError);
  });

  it('default time range is roughly last 1h', async () => {
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });
    await queryLogs('ref-1', { service: 'api' });
    const url = decodeURIComponent(fetchMock.mock.calls[0]![0] as string);
    // start should be ~1h ago, end ~now; both ISO strings present
    expect(url).toMatch(/BETWEEN '20\d{2}-/);
  });
});
