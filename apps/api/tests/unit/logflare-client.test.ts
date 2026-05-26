import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * T054 — logflare-client: SQL construction + forwarder behavior. fetch is
 * mocked; we don't need a live Logflare container in unit tests.
 */

const instanceStore = {
  row: null as null | {
    status: string;
    secrets: { logflarePrivateAccessToken: string };
    portKong: number;
  },
};

vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            if (!instanceStore.row) return [];
            return [
              {
                status: instanceStore.row.status,
                portKong: instanceStore.row.portKong,
                encryptedSecrets: Buffer.from('stub'),
              },
            ];
          },
        }),
      }),
    }),
  }),
  schema: {
    supabaseInstances: { ref: 'ref', status: 'status', portKong: 'pk', encryptedSecrets: 'es' },
  },
}));

vi.mock('@selfbase/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
  decryptJson: () => instanceStore.row?.secrets ?? {},
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

const { queryLogs, AnalyticsUnreachableError, _SERVICE_TABLE } =
  await import('../../src/services/logflare-client.js');

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  instanceStore.row = {
    status: 'running',
    portKong: 30006,
    secrets: { logflarePrivateAccessToken: 'tok-1' },
  };
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
    expect(url).toContain('host.docker.internal:30006');
    expect(url).toContain('/analytics/v1/');
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
    instanceStore.row = {
      status: 'paused',
      portKong: 30006,
      secrets: { logflarePrivateAccessToken: 'tok' },
    };
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

  it('default has no WHERE clause; supplied bounds use microsecond epochs', async () => {
    // Default: no time bounds (Logflare endpoint's internal time window applies)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });
    await queryLogs('ref-1', { service: 'api' });
    const urlDefault = decodeURIComponent(fetchMock.mock.calls[0]![0] as string);
    expect(urlDefault).not.toMatch(/WHERE/);

    // With explicit bounds: timestamps as microsecond epochs (BigQuery dialect)
    fetchMock.mockResolvedValueOnce({ ok: true, json: async () => ({ result: [] }) });
    await queryLogs('ref-1', {
      service: 'api',
      isoTimestampStart: '2026-05-26T12:00:00Z',
      isoTimestampEnd: '2026-05-26T13:00:00Z',
    });
    const urlBounded = decodeURIComponent(fetchMock.mock.calls[1]![0] as string);
    expect(urlBounded).toContain('WHERE');
    expect(urlBounded).toMatch(/timestamp >= \d{13,}/); // microsecond epoch
    expect(urlBounded).toMatch(/timestamp <= \d{13,}/);
  });
});
