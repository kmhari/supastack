/**
 * Writer 3 (key adoption) after migration onto the unified writer — feature
 * 121 T016, US1.
 *
 * The route's DB and container work is untouched by this feature; what changed
 * is the env transformation, which is exported precisely so it can be asserted
 * without standing up Postgres. The property that matters is conservative: the
 * three JWT lines change and NOTHING else does, byte for byte.
 */
import { describe, expect, test } from 'vitest';
import { applyPlatformJwtToEnv } from '../../src/routes/instance-internal.js';

/** Shaped like a real per-instance .env: sorted, with a comment and a blank. */
const EXISTING = [
  '# supastack per-instance environment',
  'ANON_KEY=eyJhbGci.old-anon.sig',
  'DOCKER_SOCKET_LOCATION=/var/run/docker.sock',
  'JWT_SECRET=OldSecret0123456789',
  'SERVICE_ROLE_KEY=eyJhbGci.old-service.sig',
  'SMTP_SENDER_NAME=My Project',
  'STUDIO_DEFAULT_ORGANIZATION=My Project',
  '',
].join('\n');

const JWT = {
  jwtSecret: 'NewPlatformSecret9876543210',
  anonKey: 'eyJhbGci.new-anon.sig',
  serviceRoleKey: 'eyJhbGci.new-service.sig',
};

describe('applyPlatformJwtToEnv — happy path', () => {
  const out = applyPlatformJwtToEnv(EXISTING, JWT);

  test('updates exactly the three JWT lines', () => {
    expect(out).toMatch(/^JWT_SECRET=NewPlatformSecret9876543210$/m);
    expect(out).toMatch(/^ANON_KEY=eyJhbGci\.new-anon\.sig$/m);
    expect(out).toMatch(/^SERVICE_ROLE_KEY=eyJhbGci\.new-service\.sig$/m);
  });

  test('preserves every other line byte-for-byte, comment and ordering included', () => {
    const before = EXISTING.split('\n');
    const after = out.split('\n');
    expect(after).toHaveLength(before.length);
    const touched = new Set(['ANON_KEY', 'JWT_SECRET', 'SERVICE_ROLE_KEY']);
    before.forEach((line, i) => {
      const key = line.slice(0, Math.max(line.indexOf('='), 0));
      if (!touched.has(key)) expect(after[i]).toBe(line);
    });
  });

  test('leaves a name containing a space alone — adoption must not break Studio', () => {
    expect(out).toMatch(/^STUDIO_DEFAULT_ORGANIZATION=My Project$/m);
  });

  test('is idempotent — the route is documented as safe to call repeatedly', () => {
    expect(applyPlatformJwtToEnv(out, JWT)).toBe(out);
  });

  test('adds a missing variable rather than silently dropping it', () => {
    const withoutAnon = EXISTING.split('\n')
      .filter((l) => !l.startsWith('ANON_KEY='))
      .join('\n');
    expect(applyPlatformJwtToEnv(withoutAnon, JWT)).toMatch(/^ANON_KEY=eyJhbGci\.new-anon\.sig$/m);
  });
});

describe('applyPlatformJwtToEnv — sad path', () => {
  test('a line break in a key is refused rather than corrupting the file', () => {
    expect(() =>
      applyPlatformJwtToEnv(EXISTING, { ...JWT, anonKey: 'good\nCOMPOSE_FILE=attacker.yml' }),
    ).toThrow(/ANON_KEY/);
  });

  test('a $ in the secret is refused — it would expand inside the api container', () => {
    expect(() => applyPlatformJwtToEnv(EXISTING, { ...JWT, jwtSecret: 'a${MASTER_KEY}' })).toThrow(
      /JWT_SECRET/,
    );
  });

  test('rejection returns nothing, so the caller still holds the original content', () => {
    expect(() => applyPlatformJwtToEnv(EXISTING, { ...JWT, anonKey: 'a\nb' })).toThrow();
    expect(EXISTING).toContain('ANON_KEY=eyJhbGci.old-anon.sig');
  });

  test('refuses a file that already assigns a target variable twice', () => {
    const doubled = EXISTING + 'JWT_SECRET=sneaky\n';
    expect(() => applyPlatformJwtToEnv(doubled, JWT)).toThrow(/more than once/);
  });

  test('the rejection message names the variable and not the secret', () => {
    const secret = 'lea"kThisAndFail';
    try {
      applyPlatformJwtToEnv(EXISTING, { ...JWT, serviceRoleKey: secret });
      throw new Error('expected applyPlatformJwtToEnv to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('SERVICE_ROLE_KEY');
      expect(message).not.toContain(secret);
    }
  });
});
