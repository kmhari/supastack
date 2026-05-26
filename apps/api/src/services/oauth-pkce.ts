/**
 * PKCE S256 verification per RFC 7636.
 *
 * Computes base64url(sha256(verifier)) and compares to the stored challenge
 * in constant time. Pure function; no I/O.
 *
 * Spec: 014-mcp-http-oauth — FR-004, contracts/oauth-token-endpoint.md.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

// Per RFC 7636 §4.1: verifier MUST be 43..128 chars, A-Z / a-z / 0-9 / -._~
const VERIFIER_RE = /^[A-Za-z0-9\-._~]{43,128}$/;

/**
 * Returns true iff `base64url(sha256(verifier)) === challenge` AND the
 * verifier conforms to RFC 7636 length+charset constraints.
 */
export function verifyChallenge(verifier: string, challenge: string): boolean {
  if (!VERIFIER_RE.test(verifier)) return false;
  const computed = createHash('sha256').update(verifier, 'ascii').digest().toString('base64url');
  if (computed.length !== challenge.length) return false;
  return timingSafeEqual(Buffer.from(computed, 'ascii'), Buffer.from(challenge, 'ascii'));
}
