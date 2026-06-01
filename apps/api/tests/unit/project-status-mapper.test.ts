import { describe, expect, it } from 'vitest';
import { mapSupastackStatusToCloud } from '../../src/services/project-status-mapper.js';

describe('mapSupastackStatusToCloud', () => {
  it('running → ACTIVE_HEALTHY', () => {
    expect(mapSupastackStatusToCloud('running')).toBe('ACTIVE_HEALTHY');
  });
  it('paused / stopped → INACTIVE', () => {
    expect(mapSupastackStatusToCloud('paused')).toBe('INACTIVE');
    expect(mapSupastackStatusToCloud('stopped')).toBe('INACTIVE');
  });
  it('provisioning / creating → COMING_UP', () => {
    expect(mapSupastackStatusToCloud('provisioning')).toBe('COMING_UP');
    expect(mapSupastackStatusToCloud('creating')).toBe('COMING_UP');
  });
  it('failed → UNKNOWN', () => {
    expect(mapSupastackStatusToCloud('failed')).toBe('UNKNOWN');
  });
  it('deleting → REMOVED', () => {
    expect(mapSupastackStatusToCloud('deleting')).toBe('REMOVED');
  });
  it('unknown supastack status → UNKNOWN (default)', () => {
    expect(mapSupastackStatusToCloud('not_a_real_status')).toBe('UNKNOWN');
    expect(mapSupastackStatusToCloud('')).toBe('UNKNOWN');
  });
});
