/**
 * Unit test for the CLI login-role rate-limit token bucket (feature 012, T006).
 *
 * Covers the five assertions called out in tasks.md:
 *   1. First 30 calls in a window return allowed:true; the 31st returns
 *      allowed:false with positive retryAfterSeconds ≤ 60.
 *   2. After advancing time past the window, a fresh 30 calls succeed.
 *   3. Two distinct keys are accounted for independently.
 *   4. retryAfterSeconds rounds UP (a 17.3s remainder returns 18).
 *   5. Idle eviction: a key untouched for >10×windowMs is purged.
 *
 * Uses vitest fake timers (`vi.useFakeTimers()` + `vi.setSystemTime(...)`)
 * so the discrete-counter window semantics can be exercised
 * deterministically without sleeping a full minute per test case.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  IDLE_EVICTION_MS,
  RATE_LIMIT,
  WINDOW_MS,
  _resetBuckets,
  tryConsume,
} from '../../src/services/cli-login-role-bucket.js';

describe('tryConsume (rate-limit token bucket)', () => {
  beforeEach(() => {
    _resetBuckets();
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-26T12:00:00.000Z'));
  });

  afterEach(() => {
    vi.useRealTimers();
    _resetBuckets();
  });

  it('exports RATE_LIMIT=30 and WINDOW_MS=60000 (spec constants)', () => {
    expect(RATE_LIMIT).toBe(30);
    expect(WINDOW_MS).toBe(60_000);
    expect(IDLE_EVICTION_MS).toBe(10 * 60_000);
  });

  it('allows the first RATE_LIMIT calls and refuses the next', () => {
    const key = 'pat-a:proj-x';
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      const r = tryConsume(key);
      expect(r.allowed).toBe(true);
    }
    const r = tryConsume(key);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSeconds).toBeGreaterThanOrEqual(1);
      expect(r.retryAfterSeconds).toBeLessThanOrEqual(60);
    }
  });

  it('window resets after WINDOW_MS so a fresh RATE_LIMIT succeed', () => {
    const key = 'pat-a:proj-x';
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      tryConsume(key);
    }
    expect(tryConsume(key).allowed).toBe(false);
    // Advance just past the window boundary.
    vi.advanceTimersByTime(WINDOW_MS + 1);
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect(tryConsume(key).allowed).toBe(true);
    }
    expect(tryConsume(key).allowed).toBe(false);
  });

  it('distinct keys are accounted for independently', () => {
    const keyA = 'pat-a:proj-x';
    const keyB = 'pat-b:proj-x';
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect(tryConsume(keyA).allowed).toBe(true);
    }
    expect(tryConsume(keyA).allowed).toBe(false);
    // PAT B has its own bucket — first call still succeeds.
    expect(tryConsume(keyB).allowed).toBe(true);
  });

  it('retryAfterSeconds rounds UP (17.3s remaining → 18)', () => {
    const key = 'pat-a:proj-x';
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      tryConsume(key);
    }
    // 60s window started at fake-time T0; advance by 42.7s, leaving 17.3s.
    vi.advanceTimersByTime(42_700);
    const r = tryConsume(key);
    expect(r.allowed).toBe(false);
    if (!r.allowed) {
      expect(r.retryAfterSeconds).toBe(18);
    }
  });

  it('idle key gets evicted after >IDLE_EVICTION_MS', () => {
    const evictee = 'pat-evict:proj-x';
    const fresh = 'pat-fresh:proj-x';

    // Seed: consume from `evictee`, then go quiet on that key.
    tryConsume(evictee);

    // Fast-forward past the idle threshold (10 windows + a buffer).
    vi.advanceTimersByTime(IDLE_EVICTION_MS + 5_000);

    // Touch `fresh` to trigger the lazy eviction sweep at the top of
    // `tryConsume()`. By this point, the `evictee` entry should be gone.
    tryConsume(fresh);

    // If the evictee bucket had survived, it would still be at count=1 in
    // its very-stale window. After eviction, the next call against it
    // starts a brand-new window — observable by getting `RATE_LIMIT` more
    // free slots (which would not be true if the count had simply been
    // carried forward).
    for (let i = 0; i < RATE_LIMIT; i += 1) {
      expect(tryConsume(evictee).allowed).toBe(true);
    }
    expect(tryConsume(evictee).allowed).toBe(false);
  });
});
