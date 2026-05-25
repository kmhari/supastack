/**
 * T030: unit tests for pg-password-probe (feature 008 US3 prevention).
 *
 * Mocks pg.Client so we don't need a real Postgres for retry semantics +
 * auth-class discrimination. Mocks @selfbase/db / @selfbase/crypto so the
 * probe sees a known instance row.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const connectMock = vi.fn();
const queryMock = vi.fn();
const endMock = vi.fn();

vi.mock('pg', () => ({
  default: {
    Client: vi.fn(function ClientCtor() {
      return {
        connect: connectMock,
        query: queryMock,
        end: endMock,
      };
    }),
  },
}));

vi.mock('@selfbase/db', () => {
  const limit = vi.fn(() => [
    {
      encryptedSecrets: Buffer.from('not-real-bytes'),
      portDbDirect: 30000,
      portPostgres: 30001,
    },
  ]);
  const where = vi.fn(() => ({ limit }));
  const from = vi.fn(() => ({ where }));
  const select = vi.fn(() => ({ from }));
  return {
    db: () => ({ select }),
    schema: {
      supabaseInstances: {
        encryptedSecrets: 'encrypted_secrets',
        portDbDirect: 'port_db_direct',
        portPostgres: 'port_postgres',
        ref: 'ref',
      },
    },
  };
});

vi.mock('@selfbase/crypto', () => ({
  decryptJson: vi.fn(() => ({ postgresPassword: 'unit-test-pw' })),
  loadMasterKey: vi.fn(() => Buffer.alloc(32)),
}));

vi.mock('drizzle-orm', () => ({
  eq: vi.fn(() => 'eq'),
}));

vi.mock('@selfbase/shared', () => ({
  logger: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// Import the SUT after mocks are wired up.
const { probeAuthWithStoredPassword } = await import('../../src/services/pg-password-probe.js');

beforeEach(() => {
  connectMock.mockReset();
  queryMock.mockReset();
  endMock.mockReset();
  endMock.mockResolvedValue(undefined);
});

function makeAuthError(): Error & { code?: string } {
  const e = new Error('password authentication failed for user "postgres"') as Error & {
    code?: string;
  };
  e.code = '28P01';
  return e;
}

function makeNetworkError(): Error {
  return new Error('connect ECONNREFUSED 127.0.0.1:30000');
}

describe('probeAuthWithStoredPassword', () => {
  it('returns ok=true on first-try success (no retries)', async () => {
    connectMock.mockResolvedValueOnce(undefined);
    queryMock.mockResolvedValueOnce(undefined);
    const r = await probeAuthWithStoredPassword('test-ref', { retries: 3, delayMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(1);
    expect(connectMock).toHaveBeenCalledTimes(1);
  });

  it('returns ok=true after 2 transient failures + 1 success', async () => {
    connectMock
      .mockRejectedValueOnce(makeNetworkError())
      .mockRejectedValueOnce(makeNetworkError())
      .mockResolvedValueOnce(undefined);
    queryMock.mockResolvedValueOnce(undefined);
    const r = await probeAuthWithStoredPassword('test-ref', { retries: 3, delayMs: 0 });
    expect(r.ok).toBe(true);
    expect(r.attempts).toBe(3);
    expect(connectMock).toHaveBeenCalledTimes(3);
  });

  it('returns isAuthClass=true when all 3 attempts fail with 28P01', async () => {
    connectMock.mockRejectedValue(makeAuthError());
    const r = await probeAuthWithStoredPassword('test-ref', { retries: 3, delayMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.isAuthClass).toBe(true);
    expect(r.attempts).toBe(3);
    expect(r.lastError).toMatch(/password authentication failed/);
  });

  it('returns isAuthClass=false when all 3 attempts fail with network error', async () => {
    connectMock.mockRejectedValue(makeNetworkError());
    const r = await probeAuthWithStoredPassword('test-ref', { retries: 3, delayMs: 0 });
    expect(r.ok).toBe(false);
    expect(r.isAuthClass).toBe(false);
    expect(r.attempts).toBe(3);
    expect(r.lastError).toMatch(/ECONNREFUSED/);
  });

  it('classifies auth via message even if SQLSTATE code is missing', async () => {
    const e = new Error('password authentication failed for user "postgres"');
    // No e.code — pg sometimes loses it across error boundaries
    connectMock.mockRejectedValue(e);
    const r = await probeAuthWithStoredPassword('test-ref', { retries: 1, delayMs: 0 });
    expect(r.isAuthClass).toBe(true);
  });

  it('always calls client.end() (defensive cleanup)', async () => {
    connectMock.mockRejectedValueOnce(makeAuthError());
    await probeAuthWithStoredPassword('test-ref', { retries: 1, delayMs: 0 });
    expect(endMock).toHaveBeenCalled();
  });
});
