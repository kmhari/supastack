/**
 * In-memory sliding-window rate-limit bucket for the CLI login-role create
 * endpoint (feature 012).
 *
 * Decision 8 in specs/012-cli-login-role/research.md:
 *   Selfbase's deploy model is single-VM (one api replica), so a
 *   process-local Map keyed by `${patId}:${projectRef}` is correct. The
 *   limit is 30 calls / 60 seconds (matches spec Clarifications Q3 +
 *   FR-010). If/when selfbase later scales horizontally, this helper is
 *   swapped for a Redis token bucket using INCR + EXPIRE — same interface.
 *
 * Approximation: discrete-counter sliding window. Worst-case overshoot at a
 * window flip is one extra full window's worth of calls (≤30 in <2s in the
 * adversarial case), harmless at this scale and dramatically simpler than a
 * true sliding-window-log.
 *
 * Memory bound: at most ~(PATs × active-projects) entries, expected ≪1000
 * on a real selfbase deployment. Lazy eviction at the top of every call
 * drops entries idle for more than IDLE_EVICTION_MS (default: 10× the
 * window) so the Map can't grow unboundedly if traffic patterns change.
 */

export const RATE_LIMIT = 30;
export const WINDOW_MS = 60_000;
/** Evict entries idle for >10 windows (10 minutes by default). */
export const IDLE_EVICTION_MS = 10 * WINDOW_MS;

interface BucketState {
  count: number;
  windowStart: number;
}

const BUCKETS = new Map<string, BucketState>();

export type ConsumeResult = { allowed: true } | { allowed: false; retryAfterSeconds: number };

/**
 * Attempt to consume a token from the bucket identified by `key`.
 *
 * `key` is typically `${patId}:${projectRef}` (per-PAT, per-project).
 *
 * - Returns `{ allowed: true }` if the bucket has room in the current
 *   window (and atomically increments its counter).
 * - Returns `{ allowed: false, retryAfterSeconds }` if the bucket is full;
 *   `retryAfterSeconds` rounds UP to the next whole second (so a 17.3s
 *   remainder returns 18 — caller can safely use it as a `Retry-After`
 *   header without risking a "still throttled" follow-up request).
 *
 * Lazy idle eviction runs on every call.
 */
export function tryConsume(
  key: string,
  limit: number = RATE_LIMIT,
  windowMs: number = WINDOW_MS,
): ConsumeResult {
  const now = Date.now();

  // Lazy eviction: drop any bucket entry whose window started more than
  // IDLE_EVICTION_MS ago. Bounded cost: a small constant per call (the
  // Map size is itself small under expected load).
  for (const [k, v] of BUCKETS) {
    if (now - v.windowStart > IDLE_EVICTION_MS) {
      BUCKETS.delete(k);
    }
  }

  let state = BUCKETS.get(key);
  if (state === undefined || now - state.windowStart >= windowMs) {
    // Either no record yet, or the previous window has closed → fresh window.
    state = { count: 1, windowStart: now };
    BUCKETS.set(key, state);
    return { allowed: true };
  }

  if (state.count < limit) {
    state.count += 1;
    return { allowed: true };
  }

  const remainingMs = windowMs - (now - state.windowStart);
  const retryAfterSeconds = Math.max(1, Math.ceil(remainingMs / 1000));
  return { allowed: false, retryAfterSeconds };
}

/**
 * Test-only helper: clear all buckets. Call from `beforeEach` (or
 * `afterEach`) in tests to keep cases hermetic. NOT exported via the
 * module's intended public surface; do not call from production code.
 */
export function _resetBuckets(): void {
  BUCKETS.clear();
}
