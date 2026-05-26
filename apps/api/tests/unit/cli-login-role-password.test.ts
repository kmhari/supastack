/**
 * Unit test for the CLI login-role password generator (feature 012, T005).
 *
 * Covers the three assertions called out in tasks.md:
 *   1. Returns a 64-char lowercase hex string.
 *   2. Two consecutive calls return distinct passwords (RNG sanity check).
 *   3. The output decodes to exactly 32 bytes.
 *
 * Also reads `PASSWORD_BYTES` and asserts the constant pins the 32-byte /
 * 256-bit entropy target the spec (SC-005, ≥128 bits) commits to.
 */
import { describe, expect, it } from 'vitest';

import { PASSWORD_BYTES, generateCliPassword } from '../../src/services/cli-login-role-password.js';

describe('generateCliPassword', () => {
  it('exports PASSWORD_BYTES = 32 (256 bits of entropy)', () => {
    expect(PASSWORD_BYTES).toBe(32);
  });

  it('returns a 64-character lowercase hex string', () => {
    const pw = generateCliPassword();
    expect(pw).toMatch(/^[0-9a-f]{64}$/);
  });

  it('two consecutive calls return distinct passwords', () => {
    const a = generateCliPassword();
    const b = generateCliPassword();
    expect(a).not.toBe(b);
  });

  it('decoded length is exactly 32 bytes', () => {
    const pw = generateCliPassword();
    expect(Buffer.from(pw, 'hex')).toHaveLength(PASSWORD_BYTES);
  });

  it('large sample shows no collisions (RNG smoke check)', () => {
    const seen = new Set<string>();
    for (let i = 0; i < 1000; i += 1) {
      const pw = generateCliPassword();
      expect(seen.has(pw)).toBe(false);
      seen.add(pw);
    }
    expect(seen.size).toBe(1000);
  });
});
