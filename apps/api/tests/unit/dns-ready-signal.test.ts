import { describe, it, expect } from 'vitest';
import { computeAllDnsReady } from '../../src/services/acme.js';

/**
 * Feature 087 (fix #94) — the authoritative DNS-readiness signal. The bug was
 * `dnsChecks.every(c => c.found)` reporting a vacuous `true` for an empty
 * challenge list (`[].every() === true`). `computeAllDnsReady` adds the
 * `length > 0` guard; this is the single source both the status route
 * (wildcard-certs.ts) and verifyAndFinalize (acme.ts) consume.
 */
describe('computeAllDnsReady — DNS-ready signal', () => {
  it('sad: empty dnsChecks → false (never vacuously ready — FR-002)', () => {
    expect(computeAllDnsReady([])).toBe(false);
  });

  it('sad: any record not found → false', () => {
    expect(computeAllDnsReady([{ found: false }])).toBe(false);
    expect(computeAllDnsReady([{ found: true }, { found: false }])).toBe(false);
  });

  it('happy: non-empty and every record found → true', () => {
    expect(computeAllDnsReady([{ found: true }])).toBe(true);
    expect(computeAllDnsReady([{ found: true }, { found: true }])).toBe(true);
  });
});
