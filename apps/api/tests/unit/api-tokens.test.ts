import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { PAT_FORMAT_REGEX, formatTokenPrefix } from '../../src/services/api-tokens.js';

/**
 * T003a (a): pure tests for the PAT minting + format checks.
 *
 * These tests do not touch the DB. They validate format constraints that the
 * upstream Supabase CLI enforces client-side (`^sbp_(oauth_)?[a-f0-9]{40}$`).
 * Mismatched format would be rejected by the CLI before any HTTP request.
 */
describe('mintApiToken format', () => {
  it('exports the regex the upstream CLI uses', () => {
    expect(PAT_FORMAT_REGEX.source).toBe('^sbp_(oauth_)?[a-f0-9]{40}$');
  });

  it('mintApiToken returns a string matching the regex', async () => {
    const { mintApiToken } = await import('../../src/services/api-tokens.js');
    // Pure call — no DB. mintApiToken should expose a `generateRawToken` helper
    // OR we can extract by calling and parsing the .raw return. We test the
    // pure generator here, not the DB insert.
    // Spec: the generator is `sbp_${randomBytes(20).toString('hex')}`.
    const { generateRawToken } = await import('../../src/services/api-tokens.js');
    const raw = generateRawToken();
    expect(raw).toMatch(PAT_FORMAT_REGEX);
    expect(raw.length).toBe(44); // sbp_ (4) + 40 hex chars
  });

  it('generateRawToken produces distinct tokens across calls', async () => {
    const { generateRawToken } = await import('../../src/services/api-tokens.js');
    const a = generateRawToken();
    const b = generateRawToken();
    expect(a).not.toBe(b);
  });

  it('formatTokenPrefix returns the first 12 chars of plaintext', () => {
    const raw = 'sbp_0123456789abcdef0123456789abcdef01234567';
    expect(formatTokenPrefix(raw)).toBe('sbp_01234567');
    expect(formatTokenPrefix(raw)).toHaveLength(12);
  });

  it('the SHA-256 hash of a generated token is 32 bytes (validation, not service tested here)', async () => {
    const { generateRawToken } = await import('../../src/services/api-tokens.js');
    const raw = generateRawToken();
    const hash = createHash('sha256').update(raw, 'utf8').digest();
    expect(hash.byteLength).toBe(32);
  });
});
