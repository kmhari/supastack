/**
 * T025 — selfbase → cloud status enum mapping (pure function).
 */
import { describe, expect, it } from 'vitest';
import { mapSelfbaseStatusToCloud } from '../../../src/services/project-status-mapper.js';

describe('mapSelfbaseStatusToCloud', () => {
  const cases: Array<[string, string]> = [
    ['running', 'ACTIVE_HEALTHY'],
    ['paused', 'INACTIVE'],
    ['stopped', 'INACTIVE'],
    ['provisioning', 'COMING_UP'],
    ['creating', 'COMING_UP'],
    ['failed', 'UNKNOWN'],
    ['deleting', 'REMOVED'],
  ];
  for (const [src, dst] of cases) {
    it(`${src} → ${dst}`, () => {
      expect(mapSelfbaseStatusToCloud(src)).toBe(dst);
    });
  }
  it('unknown selfbase state → UNKNOWN (default branch)', () => {
    expect(mapSelfbaseStatusToCloud('weird')).toBe('UNKNOWN');
  });
  it('empty string → UNKNOWN', () => {
    expect(mapSelfbaseStatusToCloud('')).toBe('UNKNOWN');
  });
});
