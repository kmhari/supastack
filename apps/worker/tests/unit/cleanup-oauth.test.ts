import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * T024d — cleanup cron jobs delete only the rows they should + idempotent.
 */

interface Row {
  code?: string;
  token?: string;
  expiresAt?: Date;
  lastUsedAt?: Date;
  revokedAt?: Date | null;
}

const codesStore: Row[] = [];
const refreshStore: Row[] = [];

vi.mock('@supastack/db', () => ({
  db: () => ({
    delete: (table: { __name: string }) => ({
      where: () => ({
        returning: async () => {
          const now = Date.now();
          if (table.__name === 'oauth_codes') {
            const before = codesStore.length;
            // Mock SQL: expires_at < now()
            for (let i = codesStore.length - 1; i >= 0; i--) {
              if (codesStore[i]!.expiresAt!.getTime() < now) codesStore.splice(i, 1);
            }
            return new Array(before - codesStore.length).fill({ code: 'x' });
          }
          if (table.__name === 'oauth_refresh') {
            const before = refreshStore.length;
            const thirty = now - 30 * 24 * 60 * 60 * 1000;
            for (let i = refreshStore.length - 1; i >= 0; i--) {
              const r = refreshStore[i]!;
              if (r.lastUsedAt!.getTime() < thirty && r.revokedAt === null) {
                refreshStore.splice(i, 1);
              }
            }
            return new Array(before - refreshStore.length).fill({ token: 'x' });
          }
          return [];
        },
      }),
    }),
  }),
  schema: {
    oauthCodes: { __name: 'oauth_codes', code: 'code', expiresAt: 'expires_at' },
    oauthRefreshTokens: {
      __name: 'oauth_refresh',
      token: 'token',
      lastUsedAt: 'last_used_at',
      revokedAt: 'revoked_at',
    },
  },
}));

vi.mock('@supastack/shared', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {} },
}));

vi.mock('drizzle-orm', () => ({
  sql: () => ({ __sql: true }),
  isNull: () => ({ __isNull: true }),
  and: () => ({ __and: true }),
  lt: () => ({ __lt: true }),
  eq: () => ({ __eq: true }),
}));

const { runCleanupOauthCodes } = await import('../../src/jobs/cleanup-oauth-codes.js');
const { runCleanupOauthRefresh } = await import('../../src/jobs/cleanup-oauth-refresh.js');

beforeEach(() => {
  codesStore.length = 0;
  refreshStore.length = 0;
});

describe('runCleanupOauthCodes', () => {
  it('deletes expired codes, leaves fresh ones', async () => {
    const now = Date.now();
    codesStore.push(
      { code: 'expired-1', expiresAt: new Date(now - 60_000) },
      { code: 'expired-2', expiresAt: new Date(now - 120_000) },
      { code: 'fresh-1', expiresAt: new Date(now + 60_000) },
    );
    const result = await runCleanupOauthCodes();
    expect(result.deletedCount).toBe(2);
    expect(codesStore.map((r) => r.code)).toEqual(['fresh-1']);
  });

  it('idempotent — second run on empty store returns 0', async () => {
    await runCleanupOauthCodes();
    const result = await runCleanupOauthCodes();
    expect(result.deletedCount).toBe(0);
  });
});

describe('runCleanupOauthRefresh', () => {
  it('deletes refresh tokens idle >30d, keeps fresh + revoked rows', async () => {
    const now = Date.now();
    const day = 24 * 60 * 60 * 1000;
    refreshStore.push(
      { token: 'idle-1', lastUsedAt: new Date(now - 40 * day), revokedAt: null },
      { token: 'fresh-1', lastUsedAt: new Date(now - 5 * day), revokedAt: null },
      {
        token: 'revoked-old',
        lastUsedAt: new Date(now - 100 * day),
        revokedAt: new Date(now - 50 * day),
      },
    );
    const result = await runCleanupOauthRefresh();
    expect(result.deletedCount).toBe(1);
    expect(refreshStore.map((r) => r.token)).toEqual(['fresh-1', 'revoked-old']);
  });

  it('idempotent', async () => {
    await runCleanupOauthRefresh();
    const result = await runCleanupOauthRefresh();
    expect(result.deletedCount).toBe(0);
  });
});
