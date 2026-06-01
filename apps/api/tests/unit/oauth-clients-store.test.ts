import { describe, expect, it, beforeEach, vi } from 'vitest';

const dbCalls: { kind: string; values?: unknown; where?: unknown }[] = [];
const insertRowReturn: { value: Record<string, unknown> } = {
  value: {
    id: '11111111-1111-1111-1111-111111111111',
    clientName: 'TestClient',
    redirectUris: ['http://localhost/cb'],
    createdAt: new Date('2026-05-26T00:00:00Z'),
    createdByIp: null,
    metadata: null,
  },
};
const selectRowReturn: { row: Record<string, unknown> | null } = { row: null };

vi.mock('@supastack/db', () => ({
  db: () => ({
    insert: () => ({
      values: (v: unknown) => ({
        returning: async () => {
          dbCalls.push({ kind: 'insert', values: v });
          return [insertRowReturn.value];
        },
      }),
    }),
    select: () => ({
      from: () => ({
        where: (w: unknown) => ({
          limit: async () => {
            dbCalls.push({ kind: 'select', where: w });
            return selectRowReturn.row ? [selectRowReturn.row] : [];
          },
        }),
      }),
    }),
  }),
  schema: {
    oauthClients: { id: { name: 'id' }, name: 'oauth_clients' },
  },
}));

const { registerClient, getClientById, validateRedirectUri } =
  await import('../../src/services/oauth-clients-store.js');

beforeEach(() => {
  dbCalls.length = 0;
});

describe('oauth-clients-store', () => {
  describe('registerClient', () => {
    it('inserts row + returns full OAuthClient', async () => {
      const c = await registerClient({
        clientName: 'TestClient',
        redirectUris: ['http://localhost/cb'],
        createdByIp: '127.0.0.1',
      });
      expect(c.id).toBe('11111111-1111-1111-1111-111111111111');
      expect(c.clientName).toBe('TestClient');
      expect(dbCalls[0]?.kind).toBe('insert');
      expect((dbCalls[0]?.values as Record<string, unknown>).clientName).toBe('TestClient');
    });

    it('preserves metadata when supplied', async () => {
      await registerClient({
        clientName: 'TestClient',
        redirectUris: ['http://localhost/cb'],
        metadata: { logo_uri: 'https://example.com/x.png' },
      });
      const v = dbCalls[0]?.values as Record<string, unknown>;
      expect(v.metadata).toEqual({ logo_uri: 'https://example.com/x.png' });
    });
  });

  describe('getClientById', () => {
    it('returns null on miss', async () => {
      selectRowReturn.row = null;
      const result = await getClientById('22222222-2222-2222-2222-222222222222');
      expect(result).toBeNull();
    });
    it('returns OAuthClient on hit', async () => {
      selectRowReturn.row = {
        id: '33333333-3333-3333-3333-333333333333',
        clientName: 'AnotherClient',
        redirectUris: ['http://localhost/x'],
        createdAt: new Date('2026-05-26'),
        createdByIp: '10.0.0.1',
        metadata: { foo: 'bar' },
      };
      const result = await getClientById('33333333-3333-3333-3333-333333333333');
      expect(result?.clientName).toBe('AnotherClient');
      expect(result?.metadata).toEqual({ foo: 'bar' });
    });
  });

  describe('validateRedirectUri', () => {
    const client = {
      id: '1',
      clientName: 'c',
      redirectUris: ['http://localhost:56831/callback'],
      createdAt: new Date(),
      createdByIp: null,
      metadata: null,
    };
    it('exact match → true', () => {
      expect(validateRedirectUri(client, 'http://localhost:56831/callback')).toBe(true);
    });
    it('trailing-slash mismatch → false', () => {
      expect(validateRedirectUri(client, 'http://localhost:56831/callback/')).toBe(false);
    });
    it('substring match → false', () => {
      expect(validateRedirectUri(client, 'http://localhost:56831/callback?evil=1')).toBe(false);
    });
    it('totally different URI → false', () => {
      expect(validateRedirectUri(client, 'http://evil.example/cb')).toBe(false);
    });
  });
});
