import { describe, expect, test } from 'vitest';
import {
  encrypt,
  decrypt,
  encryptJson,
  decryptJson,
  loadMasterKey,
  hashPassword,
  verifyPassword,
  signSupabaseJwt,
  verifySupabaseJwt,
  generatePassword,
  assertSafeForEnv,
  generateRef,
  isValidRef,
} from '../src/index.js';
import { randomBytes } from 'node:crypto';

const key32 = () => randomBytes(32);

describe('aes-gcm', () => {
  test('round-trips arbitrary bytes', () => {
    const key = key32();
    for (const size of [0, 1, 31, 256, 4096, 65536]) {
      const data = randomBytes(size);
      const blob = encrypt(data, key);
      const back = decrypt(blob, key);
      expect(back.equals(data)).toBe(true);
    }
  });

  test('json round-trip preserves structure', () => {
    const key = key32();
    const obj = { jwt_secret: 'abc', anon_key: 'def', nested: { n: 1 } };
    const blob = encryptJson(obj, key);
    expect(decryptJson<typeof obj>(blob, key)).toEqual(obj);
  });

  test('tampered ciphertext is rejected', () => {
    const key = key32();
    const blob = encrypt('hello', key);
    blob[blob.length - 1] ^= 0xff; // flip a bit in the tag
    expect(() => decrypt(blob, key)).toThrow();
  });

  test('wrong key is rejected', () => {
    const blob = encrypt('hello', key32());
    expect(() => decrypt(blob, key32())).toThrow();
  });

  test('loadMasterKey accepts 64 hex chars', () => {
    const hex = randomBytes(32).toString('hex');
    expect(loadMasterKey({ MASTER_KEY: hex } as NodeJS.ProcessEnv).length).toBe(32);
  });

  test('loadMasterKey accepts 32 raw bytes as base64', () => {
    const b64 = randomBytes(32).toString('base64');
    expect(loadMasterKey({ MASTER_KEY: b64 } as NodeJS.ProcessEnv).length).toBe(32);
  });

  test('loadMasterKey throws on missing', () => {
    expect(() => loadMasterKey({} as NodeJS.ProcessEnv)).toThrow(/MASTER_KEY/);
  });

  test('loadMasterKey throws on malformed', () => {
    expect(() => loadMasterKey({ MASTER_KEY: 'too-short' } as NodeJS.ProcessEnv)).toThrow();
  });
});

describe('argon2', () => {
  test('hash + verify happy path', async () => {
    const h = await hashPassword('correct horse battery staple');
    expect(await verifyPassword(h, 'correct horse battery staple')).toBe(true);
  });

  test('verify rejects wrong password', async () => {
    const h = await hashPassword('s3cret');
    expect(await verifyPassword(h, 'guess')).toBe(false);
  });

  test('hashes differ across calls (salted)', async () => {
    const a = await hashPassword('same');
    const b = await hashPassword('same');
    expect(a).not.toBe(b);
  });
});

describe('jwt — anti-SupaConsole regression', () => {
  test('signed anon_key VERIFIES against the same secret', () => {
    // SupaConsole's bug: it produced a random 43-char string as the
    // "signature" so the JWT never validated against jwt_secret. This test
    // asserts our key is a real HS256 token that downstream Supabase services
    // will accept.
    const secret = 'this-is-a-secret-token-for-tests-32b';
    const token = signSupabaseJwt(secret, { role: 'anon' });
    const decoded = verifySupabaseJwt(token, secret);
    expect(decoded).toBeTruthy();
    expect(decoded?.role).toBe('anon');
    expect(decoded?.iss).toBe('supabase');
  });

  test('signed service_role_key verifies and carries the right role claim', () => {
    const secret = 'another-test-secret-32-bytes-please';
    const token = signSupabaseJwt(secret, { role: 'service_role' });
    const decoded = verifySupabaseJwt(token, secret);
    expect(decoded?.role).toBe('service_role');
  });

  test('signature does not verify under a different secret', () => {
    const token = signSupabaseJwt('secret-A', { role: 'anon' });
    expect(verifySupabaseJwt(token, 'secret-B')).toBeNull();
  });

  test('expSec controls the exp claim', () => {
    const t = signSupabaseJwt('s', { role: 'anon', expSec: 60 });
    const d = verifySupabaseJwt(t, 's')!;
    expect(d.exp! - d.iat!).toBe(60);
  });
});

describe('passwords — anti-Multibase regression', () => {
  test('1000 generated passwords contain only [A-Za-z0-9]', () => {
    // Multibase's huntvox/.env had `POSTGRES_PASSWORD=...$GINIWZBA8` which
    // Docker Compose interpreted as a variable substitution. We forbid $
    // (and several other characters) end-to-end.
    const re = /^[A-Za-z0-9]+$/;
    for (let i = 0; i < 1000; i++) {
      const pw = generatePassword(32);
      expect(pw).toMatch(re);
      expect(pw).toHaveLength(32);
    }
  });

  test('generated passwords never contain a $', () => {
    for (let i = 0; i < 5000; i++) {
      expect(generatePassword(32)).not.toContain('$');
    }
  });

  test('assertSafeForEnv accepts safe values', () => {
    expect(() => assertSafeForEnv('Ax9_-')).not.toThrow();
  });

  test('assertSafeForEnv rejects $', () => {
    expect(() => assertSafeForEnv('UcCy$GINIWZBA8', 'POSTGRES_PASSWORD')).toThrow(/POSTGRES_PASSWORD/);
  });

  test('assertSafeForEnv rejects backtick, quote, backslash, whitespace', () => {
    for (const bad of ['has`tick', "single'q", 'double"q', 'has\\slash', 'with space']) {
      expect(() => assertSafeForEnv(bad)).toThrow();
    }
  });
});

describe('ref', () => {
  test('1000 generated refs match /^[a-z0-9]{20}$/', () => {
    for (let i = 0; i < 1000; i++) {
      const ref = generateRef();
      expect(ref).toMatch(/^[a-z0-9]{20}$/);
      expect(ref).toHaveLength(20);
      expect(isValidRef(ref)).toBe(true);
    }
  });

  test('isValidRef rejects uppercase, wrong length, special chars', () => {
    expect(isValidRef('ABCDEFGHIJKLMNOPQRST')).toBe(false);
    expect(isValidRef('abc')).toBe(false);
    expect(isValidRef('aaaaaaaaaaaaaaaaaaa$')).toBe(false);
  });
});
