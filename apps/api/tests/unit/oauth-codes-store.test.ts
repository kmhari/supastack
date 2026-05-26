import { describe, expect, it, beforeEach, vi } from 'vitest';

interface FakeCodeRow {
  code: string;
  clientId: string;
  userId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  expiresAt: Date;
  usedAt: Date | null;
}

const store = new Map<string, FakeCodeRow>();

vi.mock('@selfbase/db', () => ({
  db: () => ({
    insert: () => ({
      values: async (v: Partial<FakeCodeRow>) => {
        store.set(v.code!, { ...(v as FakeCodeRow), usedAt: null });
      },
    }),
    update: () => ({
      set: (s: { usedAt: unknown }) => ({
        where: () => ({
          returning: async () => {
            // Find the row where code matches AND usedAt IS NULL — relies on
            // tests calling .where() with code matcher. We simplify by scanning.
            for (const row of store.values()) {
              if (row.usedAt) continue;
              // Atomically mark used (mock parity with UPDATE … RETURNING)
              row.usedAt = new Date();
              void s;
              // Only the first match — but real query uses code uniqueness; in
              // tests we always create one code per test so this is fine.
              return [{ ...row }];
            }
            return [];
          },
        }),
      }),
    }),
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => {
            // Return first row in store (tests use one code at a time)
            const arr = [...store.values()];
            return arr.length > 0 ? [{ usedAt: arr[0]!.usedAt }] : [];
          },
        }),
      }),
    }),
  }),
  schema: {
    oauthCodes: {
      code: { name: 'code' },
      usedAt: { name: 'used_at' },
      name: 'oauth_codes',
    },
  },
}));

const { issueCode, consumeCode, CODE_TTL_SEC } =
  await import('../../src/services/oauth-codes-store.js');

beforeEach(() => {
  store.clear();
});

describe('oauth-codes-store', () => {
  describe('issueCode', () => {
    it('inserts row with TTL ~60s', async () => {
      const result = await issueCode({
        clientId: 'cid-1',
        userId: 'uid-1',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'challenge',
        scope: 'platform',
      });
      expect(result.code.length).toBeGreaterThanOrEqual(43);
      const drift = result.expiresAt.getTime() - Date.now() - CODE_TTL_SEC * 1000;
      expect(Math.abs(drift)).toBeLessThan(1000);
    });
  });

  describe('consumeCode', () => {
    async function seed() {
      const { code } = await issueCode({
        clientId: 'cid-1',
        userId: 'uid-1',
        redirectUri: 'http://localhost/cb',
        codeChallenge: 'challenge',
        scope: 'platform',
      });
      return code;
    }

    it('happy path: returns user + scope + challenge and marks used', async () => {
      const code = await seed();
      const result = await consumeCode(code, 'http://localhost/cb', 'cid-1');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.userId).toBe('uid-1');
        expect(result.scope).toBe('platform');
        expect(result.codeChallenge).toBe('challenge');
      }
      // Stored row is now used
      expect([...store.values()][0]!.usedAt).not.toBeNull();
    });

    it('second consume → reused', async () => {
      const code = await seed();
      await consumeCode(code, 'http://localhost/cb', 'cid-1');
      const result = await consumeCode(code, 'http://localhost/cb', 'cid-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('reused');
    });

    it('unknown code → unknown', async () => {
      const result = await consumeCode('no-such-code', 'http://localhost/cb', 'cid-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('unknown');
    });

    it('redirect_uri mismatch → mismatch', async () => {
      const code = await seed();
      const result = await consumeCode(code, 'http://evil.example/cb', 'cid-1');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('mismatch');
    });

    it('client_id mismatch → mismatch', async () => {
      const code = await seed();
      const result = await consumeCode(code, 'http://localhost/cb', 'wrong-cid');
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.error).toBe('mismatch');
    });
  });
});
