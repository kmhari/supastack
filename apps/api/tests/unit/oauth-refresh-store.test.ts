import { describe, expect, it, beforeEach, vi } from 'vitest';

interface FakeRow {
  token: string;
  clientId: string;
  userId: string;
  scope: string;
  issuedAt: Date;
  lastUsedAt: Date;
  revokedAt: Date | null;
  previousToken: string | null;
}

const store = new Map<string, FakeRow>();
let lastWhere: 'by-token' | 'by-previous' | null = null;
let lastWhereValue: string | null = null;

vi.mock('@selfbase/db', () => {
  // The query builder under test calls these patterns:
  //   db().insert(...).values(...)
  //   db().select().from(...).where(eq(... .token, X)).limit(...)
  //   db().select().from(...).where(eq(... .previousToken, X)).limit(...)
  //   db().delete(...).where(and(eq(... .clientId, X), eq(... .userId, Y))).returning(...)
  //   db().transaction(async tx => { tx.insert + tx.delete })
  //   db().update(...).set(...).where(...)
  //
  // We approximate by tracking which "where" was the most recent.
  return {
    db: () => ({
      insert: () => ({
        values: async (v: Partial<FakeRow>) => {
          store.set(v.token!, {
            token: v.token!,
            clientId: v.clientId!,
            userId: v.userId!,
            scope: v.scope!,
            issuedAt: new Date(),
            lastUsedAt: new Date(),
            revokedAt: null,
            previousToken: v.previousToken ?? null,
          });
        },
      }),
      select: () => ({
        from: () => ({
          where: (_w: unknown) => ({
            limit: async () => {
              if (lastWhere === 'by-token') {
                const row = store.get(lastWhereValue!);
                return row ? [row] : [];
              }
              if (lastWhere === 'by-previous') {
                for (const row of store.values()) {
                  if (row.previousToken === lastWhereValue) return [row];
                }
                return [];
              }
              return [];
            },
          }),
        }),
      }),
      delete: () => ({
        where: () => ({
          returning: async () => {
            // delete by clientId+userId (revokeRefreshByClient)
            const deleted: { token: string }[] = [];
            for (const [k, v] of store.entries()) {
              if (v.clientId === lastDeleteClientId && v.userId === lastDeleteUserId) {
                store.delete(k);
                deleted.push({ token: k });
              }
            }
            return deleted;
          },
        }),
      }),
      transaction: async (fn: (tx: unknown) => Promise<void>) => {
        // Pass through to a stub tx with insert+delete
        await fn({
          insert: () => ({
            values: async (v: Partial<FakeRow>) => {
              store.set(v.token!, {
                token: v.token!,
                clientId: v.clientId!,
                userId: v.userId!,
                scope: v.scope!,
                issuedAt: new Date(),
                lastUsedAt: new Date(),
                revokedAt: null,
                previousToken: v.previousToken ?? null,
              });
            },
          }),
          delete: () => ({
            where: async () => {
              store.delete(lastDeleteByToken!);
            },
          }),
        });
      },
      update: () => ({
        set: () => ({
          where: async () => {
            // touchRefresh — bump lastUsedAt
            const row = store.get(lastWhereValue!);
            if (row && !row.revokedAt) row.lastUsedAt = new Date();
          },
        }),
      }),
    }),
    schema: {
      oauthRefreshTokens: {
        token: 't',
        previousToken: 'p',
        clientId: 'c',
        userId: 'u',
        revokedAt: 'r',
      },
    },
  };
});

// Helpers our mocked drizzle "where" closures consult
let lastDeleteClientId: string | null = null;
let lastDeleteUserId: string | null = null;
let lastDeleteByToken: string | null = null;

// We need to intercept the where args. Since drizzle `eq` is opaque, the
// store functions under test set these via small monkey-patches below before
// calling into the mocked db. Simpler: wrap the imports with helpers that
// stamp the "lastWhere" cursor.

vi.mock('drizzle-orm', async (orig) => {
  const actual = (await orig()) as Record<string, unknown>;
  return {
    ...actual,
    eq: (col: unknown, val: unknown) => {
      // Heuristic: which column was matched?
      const c = col as { name?: string } | string;
      const tag = typeof c === 'string' ? c : c?.name;
      if (tag === 't' || tag === 'token') {
        lastWhere = 'by-token';
        lastWhereValue = val as string;
      } else if (tag === 'p' || tag === 'previous_token') {
        lastWhere = 'by-previous';
        lastWhereValue = val as string;
      } else if (tag === 'c' || tag === 'client_id') {
        lastDeleteClientId = val as string;
      } else if (tag === 'u' || tag === 'user_id') {
        lastDeleteUserId = val as string;
      }
      return { __eq: true, col, val };
    },
    and: (...args: unknown[]) => ({ __and: args }),
    isNull: (col: unknown) => ({ __isNull: col }),
    sql: () => ({ __sql: true }),
  };
});

const { issueRefresh, rotateRefresh, revokeRefreshByClient } =
  await import('../../src/services/oauth-refresh-store.js');

beforeEach(() => {
  store.clear();
  lastWhere = null;
  lastWhereValue = null;
  lastDeleteClientId = null;
  lastDeleteUserId = null;
  lastDeleteByToken = null;
});

describe('oauth-refresh-store', () => {
  it('issueRefresh returns ≥256-bit opaque token + persists row', async () => {
    const token = await issueRefresh({
      clientId: 'cid-1',
      userId: 'uid-1',
      scope: 'platform',
    });
    expect(token.length).toBeGreaterThanOrEqual(43); // 32 bytes → 43 base64url chars
    expect(store.has(token)).toBe(true);
  });

  it('rotateRefresh happy path: deletes old, inserts new with previous_token', async () => {
    const old = await issueRefresh({ clientId: 'cid-1', userId: 'uid-1', scope: 'platform' });
    // Stub the delete-by-token marker for the tx
    lastDeleteByToken = old;
    const result = await rotateRefresh(old, 'cid-1');
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.newToken).not.toBe(old);
      expect(store.has(result.newToken)).toBe(true);
      const child = store.get(result.newToken);
      expect(child?.previousToken).toBe(old);
    }
    expect(store.has(old)).toBe(false);
  });

  it('rotateRefresh of unknown token → unknown', async () => {
    const result = await rotateRefresh('not-a-token', 'cid-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unknown');
  });

  it('rotateRefresh with reused old token → reuse_detected + grant revoked', async () => {
    // Issue + rotate once (legit). Then try to rotate the ORIGINAL token again.
    const orig = await issueRefresh({ clientId: 'cid-1', userId: 'uid-1', scope: 'platform' });
    lastDeleteByToken = orig;
    await rotateRefresh(orig, 'cid-1');
    // orig is now gone; a child row has previous_token = orig
    const result = await rotateRefresh(orig, 'cid-1');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('reuse_detected');
    // Grant should be revoked (all rows deleted)
    expect(store.size).toBe(0);
  });

  it('rotateRefresh with wrong clientId → unknown', async () => {
    const token = await issueRefresh({ clientId: 'cid-1', userId: 'uid-1', scope: 'platform' });
    const result = await rotateRefresh(token, 'cid-WRONG');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('unknown');
  });

  it('revokeRefreshByClient deletes all rows for (user, client)', async () => {
    await issueRefresh({ clientId: 'cid-1', userId: 'uid-1', scope: 'platform' });
    await issueRefresh({ clientId: 'cid-1', userId: 'uid-1', scope: 'platform' });
    await issueRefresh({ clientId: 'cid-OTHER', userId: 'uid-1', scope: 'platform' });
    const count = await revokeRefreshByClient('cid-1', 'uid-1');
    expect(count).toBe(2);
    expect(store.size).toBe(1); // only the cid-OTHER row remains
  });
});
