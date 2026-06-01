/**
 * T025 — supastack → cloud status enum mapping (pure function).
 */
import { describe, expect, it } from 'vitest';
import { mapSupastackStatusToCloud } from '../../../src/services/project-status-mapper.js';

describe('mapSupastackStatusToCloud', () => {
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
      expect(mapSupastackStatusToCloud(src)).toBe(dst);
    });
  }
  it('unknown supastack state → UNKNOWN (default branch)', () => {
    expect(mapSupastackStatusToCloud('weird')).toBe('UNKNOWN');
  });
  it('empty string → UNKNOWN', () => {
    expect(mapSupastackStatusToCloud('')).toBe('UNKNOWN');
  });
});
