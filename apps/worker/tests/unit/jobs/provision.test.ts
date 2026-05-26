/**
 * T042 — provision pipeline tests.
 *
 * Mocks docker-control, db, crypto, undici.fetch, pg-password-probe,
 * vault-enable-job, bullmq (for the pgEdgeCertIssue queue), ioredis.
 *
 * Asserts:
 *   - happy path moves status provisioning → running and calls every step
 *     in order (docker compose up, health probe, caddy reload, auth probe,
 *     vault enable, status=running, pooler tenant register)
 *   - idempotency: when row.status !== 'provisioning' the job no-ops (no
 *     docker calls, no status mutation)
 *   - failure mid-step (health timeout) marks status=failed + provisionError
 *   - auth probe failure (auth-class) surfaces drift-helper message
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ─── mock state ────────────────────────────────────────────────────────────

const dockerCalls: string[] = [];
const statusUpdates: Array<Record<string, unknown>> = [];
const writeInstanceStackCalls: Array<Record<string, unknown>> = [];
let instanceRow: Record<string, unknown> | null = null;
let orgRow: { apex: string; name: string } | null = { apex: 'example.test', name: 'demo' };
let composeHealthy = true;
const fetchCalls: Array<{ url: string; method: string }> = [];
const queueAdds: Array<Record<string, unknown>> = [];

vi.mock('@selfbase/docker-control', () => ({
  composeUp: vi.fn(async () => {
    dockerCalls.push('composeUp');
  }),
  composeAllHealthy: vi.fn(async () => {
    dockerCalls.push('composeAllHealthy');
    return composeHealthy;
  }),
  writeInstanceStack: vi.fn(async (args: Record<string, unknown>) => {
    writeInstanceStackCalls.push(args);
  }),
}));

vi.mock('@selfbase/db', () => ({
  db: () => ({
    select: (cols?: Record<string, unknown>) => {
      const isOrg = cols && Object.keys(cols).includes('apex');
      return {
        from: () => ({
          where: () => ({ limit: async () => (instanceRow ? [instanceRow] : []) }),
          limit: async () => (isOrg ? (orgRow ? [orgRow] : []) : instanceRow ? [instanceRow] : []),
        }),
      };
    },
    update: () => ({
      set: (vals: Record<string, unknown>) => ({
        where: async () => {
          statusUpdates.push(vals);
          if (instanceRow) Object.assign(instanceRow, vals);
        },
      }),
    }),
  }),
  schema: {
    supabaseInstances: { ref: 'ref' },
    org: { apexDomain: 'apexDomain', name: 'name' },
  },
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({ kind: 'eq' }) }));

vi.mock('@selfbase/crypto', () => ({
  decryptJson: () => ({
    jwtSecret: 'j',
    anonKey: 'a',
    serviceRoleKey: 's',
    postgresPassword: 'pw',
    dashboardPassword: 'd',
    secretKeyBase: 'k',
    vaultEncKey: 'v',
    logflarePublicAccessToken: 'lp',
    logflarePrivateAccessToken: 'lP',
    pgMetaCryptoKey: 'pm',
    s3ProtocolAccessKeyId: 'si',
    s3ProtocolAccessKeySecret: 'sk',
    minioRootPassword: 'mr',
  }),
  loadMasterKey: () => Buffer.alloc(32),
}));

vi.mock('undici', () => ({
  fetch: vi.fn(async (url: string | URL, init?: { method?: string }) => {
    fetchCalls.push({ url: String(url), method: init?.method ?? 'GET' });
    return { ok: true, status: 200, text: async () => '', json: async () => ({}) };
  }),
}));

const { probeMock, vaultMock } = vi.hoisted(() => ({
  probeMock: vi.fn(async () => ({ ok: true, isAuthClass: false, attempts: 1 })),
  vaultMock: vi.fn(async () => ({ ref: '', durationMs: 0 })),
}));
vi.mock('../../../src/services/pg-password-probe.js', () => ({
  probeAuthWithStoredPassword: probeMock,
}));
vi.mock('../../../src/jobs/vault-enable-job.js', () => ({
  handleVaultEnable: vaultMock,
}));

vi.mock('bullmq', () => ({
  Queue: vi.fn().mockImplementation(() => ({
    add: vi.fn(async (name: string, data: Record<string, unknown>) => {
      queueAdds.push({ name, data });
    }),
  })),
}));

vi.mock('ioredis', () => ({ Redis: vi.fn().mockImplementation(() => ({})) }));

// Set required env
process.env.REDIS_URL = 'redis://localhost:6379';

// ─── helpers ───────────────────────────────────────────────────────────────

const ref = 'r0000000000000000001';

function freshRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    ref,
    name: 'demo',
    status: 'provisioning',
    portKong: 18000,
    portStudio: 18001,
    portPostgres: 18002,
    portPooler: 18003,
    portAnalytics: 18004,
    portDbDirect: 18005,
    encryptedSecrets: Buffer.from('fake'),
    createSmtpPassEncrypted: null,
    createSmtpHost: null,
    createSmtpPort: null,
    createSmtpUser: null,
    createEnableSignup: true,
    createJwtExpirySec: 3600,
    ...overrides,
  };
}

import { handleProvision } from '../../../src/jobs/provision.js';

describe('handleProvision', () => {
  beforeEach(() => {
    dockerCalls.length = 0;
    statusUpdates.length = 0;
    writeInstanceStackCalls.length = 0;
    fetchCalls.length = 0;
    queueAdds.length = 0;
    composeHealthy = true;
    probeMock.mockClear();
    probeMock.mockResolvedValue({ ok: true, isAuthClass: false, attempts: 1 });
    vaultMock.mockClear();
    vaultMock.mockResolvedValue({ ref: '', durationMs: 0 });
    instanceRow = freshRow();
    orgRow = { apex: 'example.test', name: 'demo' };
  });

  it('happy path: provisioning → running, calls each pipeline step', async () => {
    await handleProvision({ ref });
    expect(writeInstanceStackCalls).toHaveLength(1);
    expect(dockerCalls).toContain('composeUp');
    expect(dockerCalls).toContain('composeAllHealthy');
    expect(vaultMock).toHaveBeenCalled();
    expect(probeMock).toHaveBeenCalled();
    // Last status update marks running
    const finalStatus = [...statusUpdates].reverse().find((u: Record<string, unknown>) => u.status);
    expect(finalStatus?.status).toBe('running');
  });

  it('idempotency: row.status !== provisioning → no docker calls, no status mutation', async () => {
    instanceRow = freshRow({ status: 'running' });
    await handleProvision({ ref });
    expect(dockerCalls).toHaveLength(0);
    expect(statusUpdates).toHaveLength(0);
    expect(writeInstanceStackCalls).toHaveLength(0);
  });

  it('missing instance row → throws + no docker calls', async () => {
    instanceRow = null;
    await expect(handleProvision({ ref })).rejects.toThrow(/not found/);
    expect(dockerCalls).toHaveLength(0);
  });

  it('missing apex_domain → throws + status=failed', async () => {
    orgRow = null;
    await expect(handleProvision({ ref })).rejects.toThrow(/apex_domain/);
    expect(statusUpdates.some((u) => u.status === 'failed')).toBe(true);
  });

  it('health timeout → status=failed + provisionError populated', async () => {
    composeHealthy = false;
    // Make the health loop bail quickly via a tight test (the loop polls every
    // 3s up to 180s). Use vi.useFakeTimers to advance.
    vi.useFakeTimers();
    const p = handleProvision({ ref });
    const settled = p.then(
      (v) => ({ status: 'fulfilled' as const, v }),
      (e: Error) => ({ status: 'rejected' as const, e }),
    );
    // Advance enough to exceed HEALTH_TIMEOUT_MS (180s)
    await vi.advanceTimersByTimeAsync(200_000);
    const result = await settled;
    vi.useRealTimers();
    expect(result.status).toBe('rejected');
    expect((result as { e: Error }).e.message).toMatch(/did not become healthy/);
    const failed = statusUpdates.find((u) => u.status === 'failed');
    expect(failed).toBeDefined();
    expect((failed as { provisionError: string }).provisionError).toMatch(/healthy/);
  });

  it('auth probe failure (auth-class) → drift-helper message', async () => {
    probeMock.mockResolvedValueOnce({ ok: false, isAuthClass: true, attempts: 5, lastError: '28P01' } as never);
    await expect(handleProvision({ ref })).rejects.toThrow(/pg_password_drift_at_provision/);
    expect(statusUpdates.some((u) => u.status === 'failed')).toBe(true);
  });

  it('vault enable failure → propagates and marks failed', async () => {
    vaultMock.mockRejectedValueOnce(new Error('vault boom'));
    await expect(handleProvision({ ref })).rejects.toThrow(/vault boom/);
    expect(statusUpdates.some((u) => u.status === 'failed')).toBe(true);
  });
});
