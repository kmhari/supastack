import { describe, expect, it } from 'vitest';
import { mapSelfbaseStatusToCloud } from '../../src/services/project-status-mapper.js';

describe('mapSelfbaseStatusToCloud', () => {
  it('running → ACTIVE_HEALTHY', () => {
    expect(mapSelfbaseStatusToCloud('running')).toBe('ACTIVE_HEALTHY');
  });
  it('paused / stopped → INACTIVE', () => {
    expect(mapSelfbaseStatusToCloud('paused')).toBe('INACTIVE');
    expect(mapSelfbaseStatusToCloud('stopped')).toBe('INACTIVE');
  });
  it('provisioning / creating → COMING_UP', () => {
    expect(mapSelfbaseStatusToCloud('provisioning')).toBe('COMING_UP');
    expect(mapSelfbaseStatusToCloud('creating')).toBe('COMING_UP');
  });
  it('failed → UNKNOWN', () => {
    expect(mapSelfbaseStatusToCloud('failed')).toBe('UNKNOWN');
  });
  it('deleting → REMOVED', () => {
    expect(mapSelfbaseStatusToCloud('deleting')).toBe('REMOVED');
  });
  it('unknown selfbase status → UNKNOWN (default)', () => {
    expect(mapSelfbaseStatusToCloud('not_a_real_status')).toBe('UNKNOWN');
    expect(mapSelfbaseStatusToCloud('')).toBe('UNKNOWN');
  });
});
