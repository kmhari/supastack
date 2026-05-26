/**
 * T026 — env-field-mapper pure lookups + transforms. Companion to existing
 * `tests/unit/env-field-mapper.test.ts`; exercises the public surface from
 * the requested path.
 */
import { describe, expect, it } from 'vitest';
import {
  lookupAuthFieldMapping,
  lookupPostgrestFieldMapping,
  defaultEnvValueTransform,
  POSTGREST_CONFIG_MAP,
  AUTH_CONFIG_HONORED,
} from '../../../src/services/env-field-mapper.js';

describe('lookupPostgrestFieldMapping', () => {
  it('db_schema → honored PGRST_DB_SCHEMAS', () => {
    const m = lookupPostgrestFieldMapping('db_schema');
    expect(m.kind).toBe('honored');
    if (m.kind === 'honored') expect(m.envName).toBe('PGRST_DB_SCHEMAS');
  });
  it('max_rows → honored', () => {
    expect(lookupPostgrestFieldMapping('max_rows').kind).toBe('honored');
  });
  it('db_pool → stored_only', () => {
    expect(lookupPostgrestFieldMapping('db_pool').kind).toBe('stored_only');
  });
  it('unknown field → stored_only', () => {
    expect(lookupPostgrestFieldMapping('zzz_made_up').kind).toBe('stored_only');
  });
});

describe('lookupAuthFieldMapping', () => {
  it('OAuth template-bound provider (google) → honored', () => {
    expect(lookupAuthFieldMapping('external_google_enabled').kind).toBe('honored');
    expect(lookupAuthFieldMapping('external_google_client_id').kind).toBe('honored');
    expect(lookupAuthFieldMapping('external_google_secret').kind).toBe('honored');
  });
  it('non-template OAuth provider (apple) → stored_only', () => {
    expect(lookupAuthFieldMapping('external_apple_enabled').kind).toBe('stored_only');
  });
  it('unknown auth field → stored_only', () => {
    expect(lookupAuthFieldMapping('totally_made_up').kind).toBe('stored_only');
  });
});

describe('defaultEnvValueTransform', () => {
  it('null → empty string', () => expect(defaultEnvValueTransform(null)).toBe(''));
  it('undefined → empty string', () => expect(defaultEnvValueTransform(undefined)).toBe(''));
  it('true → "true"', () => expect(defaultEnvValueTransform(true)).toBe('true'));
  it('false → "false"', () => expect(defaultEnvValueTransform(false)).toBe('false'));
  it('number → stringified', () => expect(defaultEnvValueTransform(42)).toBe('42'));
  it('string → as-is', () => expect(defaultEnvValueTransform('abc')).toBe('abc'));
});

describe('matrix sanity', () => {
  it('POSTGREST_CONFIG_MAP has at least 4 documented keys', () => {
    expect(Object.keys(POSTGREST_CONFIG_MAP).length).toBeGreaterThanOrEqual(4);
  });
  it('AUTH_CONFIG_HONORED includes google/github/azure provider triples', () => {
    for (const p of ['google', 'github', 'azure']) {
      expect(AUTH_CONFIG_HONORED[`external_${p}_enabled`]?.kind).toBe('honored');
    }
  });
});
