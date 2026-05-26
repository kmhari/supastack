import { describe, it, expect } from 'vitest';
import {
  RESERVED_SECRETS,
  RESERVED_SECRET_NAMES,
  isReservedSecretName,
} from '../src/reserved-secrets';
import data from '../src/reserved-secrets.json' with { type: 'json' };

describe('reserved secrets', () => {
  it('every key in reserved-secrets.json is reported reserved', () => {
    for (const name of data.reserved) {
      expect(isReservedSecretName(name)).toBe(true);
      expect(RESERVED_SECRET_NAMES.has(name)).toBe(true);
    }
  });
  it('RESERVED_SECRETS has matching length + description', () => {
    expect(RESERVED_SECRETS.length).toBe(data.reserved.length);
    for (const s of RESERVED_SECRETS) {
      expect(typeof s.name).toBe('string');
      expect(typeof s.description).toBe('string');
      expect(s.description.length).toBeGreaterThan(0);
    }
  });
  it('non-reserved sample is not reserved', () => {
    expect(isReservedSecretName('MY_CUSTOM_VAR')).toBe(false);
    expect(isReservedSecretName('POSTGRES_PASSWORD')).toBe(false);
  });
});
