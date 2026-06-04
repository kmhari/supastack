import { describe, it, expect } from 'vitest';
import { dnsGateReady } from '@/lib/dns-gate';

/**
 * Feature 087 (fix #94) — the "Create Certs" gate. It must open only when the
 * apex AND wildcard A-records resolve AND the authoritative backend signal
 * (cert.allDnsReady, resolved to false when absent) is true. Replaces the
 * brittle captured-once client recount.
 */
describe('dnsGateReady — Create Certs gate', () => {
  it('happy: apex + wildcard A ok AND dnsReady → open', () => {
    expect(dnsGateReady(true, true, true)).toBe(true);
  });

  it('sad: dnsReady false (incl. undefined→false at call site) with A-records ok → closed', () => {
    expect(dnsGateReady(true, true, false)).toBe(false);
  });

  it('sad: an A-record not resolving, even with dnsReady true → closed', () => {
    expect(dnsGateReady(false, true, true)).toBe(false);
    expect(dnsGateReady(true, false, true)).toBe(false);
  });
});
