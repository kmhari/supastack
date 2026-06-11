import { describe, it, expect, afterEach } from 'vitest';
import { getApex, getApexOrThrow, isRealApex } from '../src/apex';

const ORIG = process.env.SUPASTACK_APEX;
afterEach(() => {
  if (ORIG === undefined) delete process.env.SUPASTACK_APEX;
  else process.env.SUPASTACK_APEX = ORIG;
});

describe('getApex', () => {
  it('returns the env value when set', () => {
    process.env.SUPASTACK_APEX = 'supaviser.dev';
    expect(getApex()).toBe('supaviser.dev');
  });
  it('returns null when unset', () => {
    delete process.env.SUPASTACK_APEX;
    expect(getApex()).toBeNull();
  });
  it('returns null when empty string', () => {
    process.env.SUPASTACK_APEX = '';
    expect(getApex()).toBeNull();
  });
});

describe('getApexOrThrow', () => {
  it('returns the value when set', () => {
    process.env.SUPASTACK_APEX = 'supaviser.dev';
    expect(getApexOrThrow()).toBe('supaviser.dev');
  });
  it('throws when unset', () => {
    delete process.env.SUPASTACK_APEX;
    expect(() => getApexOrThrow()).toThrow(/SUPASTACK_APEX/);
  });
});

describe('isRealApex', () => {
  it('true for a dotted public domain', () => {
    expect(isRealApex('supaviser.dev')).toBe(true);
    expect(isRealApex('a.b.example.com')).toBe(true);
  });
  it('false for localhost / empty / null / undefined / no-dot', () => {
    expect(isRealApex('localhost')).toBe(false);
    expect(isRealApex('')).toBe(false);
    expect(isRealApex(null)).toBe(false);
    expect(isRealApex(undefined)).toBe(false);
    expect(isRealApex('myhost')).toBe(false);
  });
});
