// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { safeNext } from '../../src/lib/safe-next';

describe('safeNext', () => {
  it('accepts a plain relative path', () => {
    expect(safeNext('/dashboard')).toBe('/dashboard');
    expect(safeNext('/dashboard/cli/login?session_id=foo&token_name=bar')).toBe(
      '/dashboard/cli/login?session_id=foo&token_name=bar',
    );
    expect(safeNext('/foo/bar')).toBe('/foo/bar');
  });

  it('decodes URL-encoded input before checking', () => {
    expect(safeNext('/dashboard/cli/login%3Fsession_id%3Dfoo')).toBe(
      '/dashboard/cli/login?session_id=foo',
    );
  });

  it('rejects absolute URLs (open-redirect defense)', () => {
    expect(safeNext('https://evil.com')).toBe('/dashboard');
    expect(safeNext('http://evil.com/foo')).toBe('/dashboard');
  });

  it('rejects protocol-relative URLs', () => {
    expect(safeNext('//evil.com')).toBe('/dashboard');
    expect(safeNext('//evil.com/foo')).toBe('/dashboard');
  });

  it('rejects javascript: / mailto: / data: pseudo-schemes', () => {
    expect(safeNext('javascript:alert(1)')).toBe('/dashboard');
    expect(safeNext('mailto:x@y.com')).toBe('/dashboard');
    expect(safeNext('data:text/html,foo')).toBe('/dashboard');
  });

  it('rejects URL-encoded protocol attacks', () => {
    // URL-encoded "//" → "%2F%2Fevil.com"
    expect(safeNext('%2F%2Fevil.com')).toBe('/dashboard');
    // URL-encoded "://"
    expect(safeNext('https%3A%2F%2Fevil.com')).toBe('/dashboard');
  });

  it('rejects empty / null / undefined', () => {
    expect(safeNext(null)).toBe('/dashboard');
    expect(safeNext(undefined)).toBe('/dashboard');
    expect(safeNext('')).toBe('/dashboard');
  });

  it('rejects relative-only paths (no leading slash)', () => {
    expect(safeNext('dashboard')).toBe('/dashboard');
    expect(safeNext('foo/bar')).toBe('/dashboard');
  });

  it('handles malformed URI encoding gracefully', () => {
    // decodeURIComponent throws on invalid % sequences → fall back
    expect(safeNext('/foo%')).toBe('/dashboard');
  });
});
