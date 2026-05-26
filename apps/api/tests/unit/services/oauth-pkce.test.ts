/**
 * T027 — PKCE S256 verification (pure function). Companion to the existing
 * unit/oauth-pkce.test.ts covering the same module from the requested path.
 */
import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { verifyChallenge } from '../../../src/services/oauth-pkce.js';

function s256(v: string): string {
  return createHash('sha256').update(v, 'ascii').digest().toString('base64url');
}

describe('verifyChallenge', () => {
  const verifier = 'a'.repeat(64); // 64 chars in A-Z/a-z/0-9/-._~
  const challenge = s256(verifier);

  it('matching verifier+challenge → true', () => {
    expect(verifyChallenge(verifier, challenge)).toBe(true);
  });
  it('wrong verifier → false', () => {
    expect(verifyChallenge('b'.repeat(64), challenge)).toBe(false);
  });
  it('verifier too short (<43) → false', () => {
    const short = 'a'.repeat(42);
    expect(verifyChallenge(short, s256(short))).toBe(false);
  });
  it('verifier too long (>128) → false', () => {
    const long = 'a'.repeat(129);
    expect(verifyChallenge(long, s256(long))).toBe(false);
  });
  it('verifier containing forbidden chars (space) → false', () => {
    const bad = 'a'.repeat(43) + ' ';
    expect(verifyChallenge(bad, s256(bad))).toBe(false);
  });
  it('mismatched length challenge → false (early exit)', () => {
    expect(verifyChallenge(verifier, challenge.slice(0, -1))).toBe(false);
  });
  it('accepts allowed special chars - . _ ~', () => {
    const v = 'A'.repeat(40) + '-._~';
    expect(verifyChallenge(v, s256(v))).toBe(true);
  });
});
