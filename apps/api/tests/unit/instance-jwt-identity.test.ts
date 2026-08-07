import { verifySupabaseJwt } from '@supastack/crypto';
import { describe, expect, it } from 'vitest';

/**
 * Feature 123 US2 (SEC-037) — per-project signing identity.
 *
 * Before this feature every project's `jwtSecret` was
 * `deriveGotrueJwtSecret(masterKey)` — one HKDF with a fixed label and no `ref`
 * in the info, so every project on the deployment shared ONE HS256 secret. Any
 * tenant's `service_role` key was therefore a valid `service_role` key on every
 * other tenant's data plane, bypassing all control-plane authorization.
 *
 * These tests are the proof. They failed on the pre-feature code by design —
 * (1) returned two identical secrets, (2) verified a cross-project key.
 */

process.env.MASTER_KEY ??= Buffer.from('m'.repeat(32)).toString('base64');

const { generateInstanceSecrets } = await import('../../src/services/instance-secrets.js');

const REF_A = 'aaaaaaaaaaaaaaaaaaaa';
const REF_B = 'bbbbbbbbbbbbbbbbbbbb';

describe('per-project signing identity', () => {
  it('two projects get different jwt secrets (same master key, same tick)', () => {
    const a = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    const b = generateInstanceSecrets({ ref: REF_B, jwtExpirySec: 3600 });
    expect(a.jwtSecret).not.toBe(b.jwtSecret);
  });

  it('re-generating for the SAME ref still yields a fresh secret (not master-derived)', () => {
    const one = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    const two = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    expect(one.jwtSecret).not.toBe(two.jwtSecret);
  });

  it("project A's service_role key does NOT verify under project B's secret", () => {
    const a = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    const b = generateInstanceSecrets({ ref: REF_B, jwtExpirySec: 3600 });
    expect(verifySupabaseJwt(a.serviceRoleKey, b.jwtSecret)).toBeNull();
    expect(verifySupabaseJwt(a.anonKey, b.jwtSecret)).toBeNull();
  });

  it("project A's keys DO verify under project A's own secret", () => {
    const a = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    expect(verifySupabaseJwt(a.serviceRoleKey, a.jwtSecret)?.role).toBe('service_role');
    expect(verifySupabaseJwt(a.anonKey, a.jwtSecret)?.role).toBe('anon');
  });

  it('issued keys carry the project ref (FR-006 — a key names its project)', () => {
    const a = generateInstanceSecrets({ ref: REF_A, jwtExpirySec: 3600 });
    expect(verifySupabaseJwt(a.anonKey, a.jwtSecret)?.ref).toBe(REF_A);
    expect(verifySupabaseJwt(a.serviceRoleKey, a.jwtSecret)?.ref).toBe(REF_A);
  });

  it('the jwt secret is high-entropy material, not a fixed-label derivation', () => {
    const secrets = Array.from({ length: 8 }, (_, i) =>
      generateInstanceSecrets({ ref: `ref${i}`.padEnd(20, 'x'), jwtExpirySec: 3600 }),
    );
    expect(new Set(secrets.map((s) => s.jwtSecret)).size).toBe(8);
    for (const s of secrets) expect(s.jwtSecret.length).toBeGreaterThanOrEqual(48);
  });
});
