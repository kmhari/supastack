import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * T060 — service-role JWT minter: HS256 signing + 24h cache.
 */

const fakeSecrets = { jwtSecret: 'shared-jwt-secret-1234567890' };
const decryptCount = { n: 0 };

vi.mock('@supastack/db', () => ({
  db: () => ({
    select: () => ({
      from: () => ({
        where: () => ({
          limit: async () => [{ encryptedSecrets: Buffer.from('stub') }],
        }),
      }),
    }),
  }),
  schema: { supabaseInstances: { ref: 'ref', encryptedSecrets: 'es' } },
}));

vi.mock('@supastack/crypto', () => ({
  loadMasterKey: () => Buffer.alloc(32),
  decryptJson: () => {
    decryptCount.n++;
    return fakeSecrets;
  },
}));

vi.mock('drizzle-orm', () => ({ eq: () => ({}) }));

const { mintServiceRoleJwt, _clearServiceRoleCache } =
  await import('../../src/services/service-role-jwt.js');

beforeEach(() => {
  decryptCount.n = 0;
  _clearServiceRoleCache();
});

function decodePayload(jwt: string): Record<string, unknown> {
  const parts = jwt.split('.');
  return JSON.parse(Buffer.from(parts[1]!, 'base64url').toString('utf8'));
}

describe('mintServiceRoleJwt', () => {
  it('returns a valid HS256 JWT with role=service_role + 24h exp', async () => {
    const jwt = await mintServiceRoleJwt('ref-1');
    expect(jwt.split('.').length).toBe(3);
    const payload = decodePayload(jwt);
    expect(payload.role).toBe('service_role');
    expect(payload.iss).toBe('supabase');
    expect(typeof payload.iat).toBe('number');
    expect(typeof payload.exp).toBe('number');
    const ttl = (payload.exp as number) - (payload.iat as number);
    expect(ttl).toBe(24 * 60 * 60);
  });

  it('caches: second call within 24h does not re-decrypt secrets', async () => {
    await mintServiceRoleJwt('ref-1');
    await mintServiceRoleJwt('ref-1');
    await mintServiceRoleJwt('ref-1');
    expect(decryptCount.n).toBe(1);
  });

  it('different refs get independent cache entries', async () => {
    await mintServiceRoleJwt('ref-1');
    await mintServiceRoleJwt('ref-2');
    expect(decryptCount.n).toBe(2);
  });

  it('clearing cache forces re-decrypt', async () => {
    await mintServiceRoleJwt('ref-1');
    _clearServiceRoleCache();
    await mintServiceRoleJwt('ref-1');
    expect(decryptCount.n).toBe(2);
  });
});
