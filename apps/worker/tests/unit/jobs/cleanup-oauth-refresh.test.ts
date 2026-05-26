/**
 * T047 — cleanup-oauth-refresh tests.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let returningRows: Array<{ token: string }> = [];
const deleteCalls: unknown[] = [];

vi.mock('@selfbase/db', () => ({
  db: () => ({
    delete: (_t: unknown) => ({
      where: (_w: unknown) => ({
        returning: async () => {
          deleteCalls.push({ tag: 'delete' });
          return returningRows;
        },
      }),
    }),
  }),
  schema: {
    oauthRefreshTokens: { token: 'token', lastUsedAt: 'lastUsedAt', revokedAt: 'revokedAt' },
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
  isNull: (_c: unknown) => ({ kind: 'isNull' }),
  and: (...args: unknown[]) => ({ kind: 'and', args }),
  lt: (_a: unknown, _b: unknown) => ({ kind: 'lt' }),
}));

import {
  runCleanupOauthRefresh,
  handleCleanupOauthRefresh,
} from '../../../src/jobs/cleanup-oauth-refresh.js';

describe('cleanup-oauth-refresh', () => {
  beforeEach(() => {
    deleteCalls.length = 0;
    returningRows = [];
  });

  it('no idle tokens → 0', async () => {
    const r = await runCleanupOauthRefresh();
    expect(r.deletedCount).toBe(0);
  });

  it('idle tokens deleted', async () => {
    returningRows = [{ token: 'a' }, { token: 'b' }];
    const r = await runCleanupOauthRefresh();
    expect(r.deletedCount).toBe(2);
  });

  it('void wrapper', async () => {
    returningRows = [{ token: 'a' }];
    await expect(handleCleanupOauthRefresh()).resolves.toBeUndefined();
  });
});
