import { describe, expect, it } from 'vitest';
import { verifyChallenge } from '../../src/services/oauth-pkce.js';

/**
 * T010 — RFC 7636 §1.1 reference + selfbase-specific guards.
 */
describe('verifyChallenge (PKCE S256)', () => {
  it('RFC 7636 §1.1 test vector — happy path', () => {
    expect(
      verifyChallenge(
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM',
      ),
    ).toBe(true);
  });

  it('mismatched pair returns false', () => {
    expect(
      verifyChallenge(
        'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk',
        'WrongChallengeValueOfTheRightLength000000000',
      ),
    ).toBe(false);
  });

  it('empty verifier returns false', () => {
    expect(verifyChallenge('', 'whatever')).toBe(false);
  });

  it('short verifier (<43 chars) returns false', () => {
    expect(verifyChallenge('too-short', 'irrelevant')).toBe(false);
  });

  it('overlong verifier (>128 chars) returns false', () => {
    const v = 'a'.repeat(129);
    expect(verifyChallenge(v, 'irrelevant')).toBe(false);
  });

  it('verifier with non-RFC chars returns false', () => {
    // Space is not in the allowed set
    expect(verifyChallenge('a'.repeat(20) + ' ' + 'a'.repeat(22), 'irrelevant')).toBe(false);
  });

  it('challenge length mismatch returns false (no timing-leak via length)', () => {
    expect(verifyChallenge('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk', 'short')).toBe(false);
  });

  it('verifier at exactly 43 chars is accepted', () => {
    const v = 'a'.repeat(43);
    // We don't care about the challenge value — just that it gets past the regex.
    // Wrong challenge → false is fine; the test is "did it short-circuit at length?"
    expect(verifyChallenge(v, 'doesnt-match-anything')).toBe(false);
    // And a correct round-trip works
    const correct = createHash('sha256').update(v, 'ascii').digest().toString('base64url');
    expect(verifyChallenge(v, correct)).toBe(true);
  });

  it('verifier at exactly 128 chars is accepted', () => {
    const v = 'a'.repeat(128);
    const correct = createHash('sha256').update(v, 'ascii').digest().toString('base64url');
    expect(verifyChallenge(v, correct)).toBe(true);
  });
});

// Local import (avoid the module-top hash import being unused)
import { createHash } from 'node:crypto';
