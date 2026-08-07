import { describe, expect, test } from 'vitest';
import { clampDataPlaneExp } from '../../src/services/api-tokens.js';

/**
 * Feature 122 US2 (SEC-076) — data-plane key lifetime clamp. Requester-supplied
 * `authorization_exp` is bounded to the platform max; malformed input is refused
 * (never coerced into a NaN expiry). Happy + sad paths.
 */
describe('clampDataPlaneExp', () => {
  const MAX = 3600;

  test('absent → platform default, not clamped', () => {
    expect(clampDataPlaneExp(undefined, MAX)).toEqual({ ok: true, expSec: MAX, clamped: false });
  });

  test('below max → honored verbatim', () => {
    expect(clampDataPlaneExp('600', MAX)).toEqual({ ok: true, expSec: 600, clamped: false });
  });

  test('at max → honored, not clamped', () => {
    expect(clampDataPlaneExp('3600', MAX)).toEqual({ ok: true, expSec: 3600, clamped: false });
  });

  test('above max → clamped down and flagged', () => {
    expect(clampDataPlaneExp('999999', MAX)).toEqual({ ok: true, expSec: MAX, clamped: true });
  });

  test('surrounding whitespace tolerated', () => {
    expect(clampDataPlaneExp('  600  ', MAX)).toEqual({ ok: true, expSec: 600, clamped: false });
  });

  // Sad paths — every one refused, never a NaN/partial expiry.
  test.each(['abc', '', '  ', '0', '-5', '10.5', '10abc', 'NaN', '0x10', '1e3'])(
    'rejects malformed %o',
    (bad) => {
      expect(clampDataPlaneExp(bad, MAX)).toEqual({ ok: false });
    },
  );
});
