// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { cn } from '../../src/lib/utils';

describe('cn (tailwind class merger)', () => {
  it('joins multiple class strings', () => {
    expect(cn('a', 'b')).toBe('a b');
  });
  it('filters falsy values', () => {
    expect(cn('a', false, null, undefined, '', 'b')).toBe('a b');
  });
  it('merges conflicting tailwind classes via twMerge', () => {
    expect(cn('p-2', 'p-4')).toBe('p-4');
  });
  it('handles arrays + objects', () => {
    expect(cn(['a', 'b'], { c: true, d: false })).toBe('a b c');
  });
});
