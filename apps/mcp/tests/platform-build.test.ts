import { describe, expect, it } from 'vitest';
import { buildPlatform } from '../src/platform-build.js';

/**
 * T038 — verify the deferred-tool-group stripping works against the real
 * upstream library. If upstream renames a method, these assertions catch it.
 */

const SAMPLE = {
  accessToken: 'sbp_test_token',
  apiUrl: 'http://test:3001',
};

describe('buildPlatform', () => {
  const platform = buildPlatform(SAMPLE);

  it('returns a platform object', () => {
    expect(platform).toBeDefined();
    expect(typeof platform).toBe('object');
  });

  it('branching group is fully removed', () => {
    expect(platform.branching).toBeUndefined();
  });

  it('debugging.getSecurityAdvisors + getPerformanceAdvisors stripped (US4 keeps getLogs only)', () => {
    if (platform.debugging) {
      expect(platform.debugging.getSecurityAdvisors).toBeUndefined();
      expect(platform.debugging.getPerformanceAdvisors).toBeUndefined();
      // getLogs should remain for US4
      expect(typeof platform.debugging.getLogs).toBe('function');
    }
  });

  it('storage.getStorageConfig + updateStorageConfig stripped (US5 keeps listAllBuckets only)', () => {
    if (platform.storage) {
      expect(platform.storage.getStorageConfig).toBeUndefined();
      expect(platform.storage.updateStorageConfig).toBeUndefined();
      expect(typeof platform.storage.listAllBuckets).toBe('function');
    }
  });

  it('account.createProject + getCost + confirmCost stripped (kept: listProjects, getProject, pauseProject, restoreProject)', () => {
    if (platform.account) {
      expect(platform.account.createProject).toBeUndefined();
      expect(platform.account.getCost).toBeUndefined();
      expect(platform.account.confirmCost).toBeUndefined();
      expect(typeof platform.account.listProjects).toBe('function');
      expect(typeof platform.account.getProject).toBe('function');
    }
  });

  it('database group is fully present (full feature 013 surface)', () => {
    expect(platform.database).toBeDefined();
    expect(typeof platform.database.executeSql).toBe('function');
  });
});
