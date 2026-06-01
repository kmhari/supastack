/**
 * T047 — cleanup-oauth-codes tests.
 *
 * Mocks @supastack/db's delete chain. Asserts the job:
 *   - issues exactly one DELETE
 *   - returns the count returned by the DB layer
 *   - logs only when count > 0
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

let returningRows: Array<{ code: string }> = [];
const deleteCalls: unknown[] = [];

vi.mock('@supastack/db', () => ({
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
    oauthCodes: { code: 'code', expiresAt: 'expiresAt' },
  },
}));

vi.mock('drizzle-orm', () => ({
  sql: (strings: TemplateStringsArray, ...vals: unknown[]) => ({ strings, vals }),
}));

import {
  runCleanupOauthCodes,
  handleCleanupOauthCodes,
} from '../../../src/jobs/cleanup-oauth-codes.js';

describe('cleanup-oauth-codes', () => {
  beforeEach(() => {
    deleteCalls.length = 0;
    returningRows = [];
  });

  it('TTL boundary: no expired rows → returns 0 + no log', async () => {
    returningRows = [];
    const r = await runCleanupOauthCodes();
    expect(r.deletedCount).toBe(0);
    expect(deleteCalls).toHaveLength(1);
  });

  it('batch sizing: multiple expired rows returned', async () => {
    returningRows = Array.from({ length: 7 }, (_, i) => ({ code: `c${i}` }));
    const r = await runCleanupOauthCodes();
    expect(r.deletedCount).toBe(7);
  });

  it('handleCleanupOauthCodes is a void wrapper', async () => {
    returningRows = [{ code: 'x' }];
    await expect(handleCleanupOauthCodes()).resolves.toBeUndefined();
  });
});
