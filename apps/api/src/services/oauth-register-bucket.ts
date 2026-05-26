/**
 * Per-key token-bucket rate limiter for OAuth dynamic client registration.
 *
 * In-process map keyed by source IP. 10 registrations per IP per hour
 * (matches FR-005). Process restart resets buckets — acceptable for our
 * single-replica api topology.
 */

interface Bucket {
  tokens: number;
  lastRefill: number;
}

const buckets = new Map<string, Bucket>();

export interface ConsumeResult {
  allowed: boolean;
  retryAfterSeconds: number;
}

export function tryConsume(key: string, capacity: number, windowMs: number): ConsumeResult {
  const now = Date.now();
  const refillRate = capacity / windowMs; // tokens per ms
  let bucket = buckets.get(key);
  if (!bucket) {
    bucket = { tokens: capacity, lastRefill: now };
    buckets.set(key, bucket);
  }
  // Refill based on elapsed time
  const elapsed = now - bucket.lastRefill;
  bucket.tokens = Math.min(capacity, bucket.tokens + elapsed * refillRate);
  bucket.lastRefill = now;

  if (bucket.tokens >= 1) {
    bucket.tokens -= 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }
  const tokensNeeded = 1 - bucket.tokens;
  const retryMs = Math.ceil(tokensNeeded / refillRate);
  return { allowed: false, retryAfterSeconds: Math.ceil(retryMs / 1000) };
}

/** Test-only: reset all buckets. */
export function resetBuckets(): void {
  buckets.clear();
}
