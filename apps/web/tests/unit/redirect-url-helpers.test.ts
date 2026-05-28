import { describe, expect, it } from 'vitest';
import {
  MAX_REDIRECT_URLS,
  dedupKey,
  isDuplicate,
  looksLikeValidUrl,
  parseAllowList,
  serializeAllowList,
} from '@/pages/auth-url-config/redirect-url-helpers';

describe('looksLikeValidUrl', () => {
  it.each([
    ['http://localhost:3000', true, 'http scheme'],
    ['https://app.example.com', true, 'https scheme'],
    ['http://localhost:*', true, 'single-segment wildcard'],
    ['http://localhost:8765/**', true, 'multi-segment wildcard'],
    ['http://*.example.com', true, 'host wildcard'],
    ['http://example.com/foo?id=?', true, 'question-mark glob'],
    ['localhost:3000', false, 'missing scheme'],
    ['app.example.com', false, 'no scheme'],
    ['javascript:alert(1)', false, 'disallowed javascript scheme'],
    ['data:text/html,foo', false, 'disallowed data scheme'],
    ['file:///etc/passwd', false, 'disallowed file scheme'],
    ['http:// trailing space', false, 'embedded whitespace'],
    ['', false, 'empty'],
    ['   ', false, 'whitespace only'],
  ])('%s → %s (%s)', (input, expected) => {
    expect(looksLikeValidUrl(input)).toBe(expected);
  });
});

describe('dedupKey', () => {
  it('folds case-insensitive scheme and host', () => {
    expect(dedupKey('HTTP://Localhost:3000/foo')).toBe(
      dedupKey('http://localhost:3000/foo'),
    );
  });

  it('preserves byte-exact path (with vs without trailing-slash on subpath)', () => {
    expect(dedupKey('http://localhost:3000/foo')).not.toBe(
      dedupKey('http://localhost:3000/foo/'),
    );
  });

  it('preserves wildcards in the dedup key', () => {
    expect(dedupKey('http://localhost:3000/**')).toBe(
      'http://localhost:3000/**',
    );
  });

  it('preserves query string in the dedup key', () => {
    expect(dedupKey('http://localhost:3000/?x=1')).toBe(
      dedupKey('HTTP://localhost:3000/?x=1'),
    );
  });

  it('WHATWG URL normalisation: root with and without trailing slash fold (intentional, matches GoTrue)', () => {
    // `new URL('http://localhost:3000').pathname === '/'`, so the absence of
    // a trailing slash on the root path round-trips to the same key. This
    // matches GoTrue's runtime behaviour.
    expect(dedupKey('http://localhost:3000')).toBe(
      dedupKey('http://localhost:3000/'),
    );
  });

  it('falls back to exact string when input is unparseable', () => {
    expect(dedupKey('not a url at all')).toBe('not a url at all');
  });
});

describe('isDuplicate', () => {
  it('finds case-insensitive matches', () => {
    expect(isDuplicate('HTTP://Localhost:3000', ['http://localhost:3000'])).toBe(true);
  });

  it('distinguishes different paths', () => {
    expect(isDuplicate('http://localhost:3000/foo', ['http://localhost:3000/bar'])).toBe(false);
  });

  it('returns false for empty haystack', () => {
    expect(isDuplicate('http://localhost:3000', [])).toBe(false);
  });
});

describe('parseAllowList / serializeAllowList', () => {
  it('round-trips a typical list', () => {
    const csv = 'http://localhost:3000,http://localhost:8765/**';
    expect(serializeAllowList(parseAllowList(csv))).toBe(csv);
  });

  it('trims whitespace around comma-separated entries', () => {
    expect(parseAllowList(' http://a , http://b ,http://c')).toEqual([
      'http://a',
      'http://b',
      'http://c',
    ]);
  });

  it('drops empty entries', () => {
    expect(parseAllowList('http://a,,http://b,')).toEqual(['http://a', 'http://b']);
  });

  it('returns [] for null/undefined/empty', () => {
    expect(parseAllowList(null)).toEqual([]);
    expect(parseAllowList(undefined)).toEqual([]);
    expect(parseAllowList('')).toEqual([]);
  });

  it('serializes [] to ""', () => {
    expect(serializeAllowList([])).toBe('');
  });
});

describe('MAX_REDIRECT_URLS', () => {
  it('is 50 (matches FR-009)', () => {
    expect(MAX_REDIRECT_URLS).toBe(50);
  });
});
