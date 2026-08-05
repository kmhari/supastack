// @vitest-environment node
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { JWT_BEARING_SERVICES, refClaimOf } from '../../src/services/instance-jwt-env.js';

/**
 * Feature 123 — re-keying a project only works if EVERY container holding the
 * old key is recreated. The deleted adopt-platform-jwt route hardcoded four
 * services (kong, storage, auth, rest) and silently left realtime, functions,
 * and studio verifying against the previous secret — a half-re-keyed project
 * that looks fine until a realtime subscribe or an edge function 401s.
 *
 * So the list is not allowed to drift from the template. If someone adds a
 * service that consumes JWT_SECRET / ANON_KEY / SERVICE_ROLE_KEY, this fails
 * until they decide whether re-keying must recreate it.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');
const TEMPLATE = path.join(REPO_ROOT, 'infra/supabase-template/docker-compose.yml');

/** Services whose environment interpolates a JWT-derived .env var. */
function servicesConsumingJwtVars(): Set<string> {
  const lines = readFileSync(TEMPLATE, 'utf8').split('\n');
  const found = new Set<string>();
  let current = '';
  for (const line of lines) {
    const svc = /^ {2}([a-z0-9_-]+):\s*$/.exec(line);
    if (svc?.[1]) current = svc[1];
    // Only real interpolations, not the commented-out Podman alternatives.
    if (/^\s*#/.test(line)) continue;
    if (/\$\{(JWT_SECRET|ANON_KEY|SERVICE_ROLE_KEY)[:}]/.test(line) && current) found.add(current);
  }
  return found;
}

describe('JWT_BEARING_SERVICES', () => {
  it('covers every template service that consumes a JWT-derived env var', () => {
    const consumers = servicesConsumingJwtVars();
    // `db` receives JWT_SECRET but only via docker-entrypoint-initdb.d, which
    // does not re-run on an existing volume — its GUC is re-issued with SQL.
    consumers.delete('db');
    const missing = [...consumers].filter(
      (s) => !(JWT_BEARING_SERVICES as readonly string[]).includes(s),
    );
    expect(missing).toEqual([]);
  });

  it('lists no service the template does not actually run', () => {
    const template = readFileSync(TEMPLATE, 'utf8');
    for (const svc of JWT_BEARING_SERVICES) {
      expect(template).toMatch(new RegExp(`^ {2}${svc}:\\s*$`, 'm'));
    }
  });

  it('includes the four the old adopt route recreated AND the three it missed', () => {
    expect([...JWT_BEARING_SERVICES].sort()).toEqual(
      ['auth', 'functions', 'kong', 'realtime', 'rest', 'storage', 'studio'].sort(),
    );
  });
});

describe('refClaimOf', () => {
  const enc = (o: unknown) => Buffer.from(JSON.stringify(o), 'utf8').toString('base64url');
  const tok = (payload: unknown) => `${enc({ alg: 'HS256' })}.${enc(payload)}.sig`;

  it('reads the ref of a post-123 key', () => {
    expect(refClaimOf(tok({ role: 'anon', ref: 'abcdefghijklmnopqrst' }))).toBe(
      'abcdefghijklmnopqrst',
    );
  });

  it('returns null for a pre-123 key that names no project', () => {
    expect(refClaimOf(tok({ role: 'anon', iss: 'supabase' }))).toBeNull();
  });

  it('returns null for a non-string ref rather than trusting it', () => {
    expect(refClaimOf(tok({ role: 'anon', ref: 12345 }))).toBeNull();
    expect(refClaimOf(tok({ role: 'anon', ref: { toString: 'x' } }))).toBeNull();
  });

  it('returns null on malformed input instead of throwing', () => {
    expect(refClaimOf('')).toBeNull();
    expect(refClaimOf('not-a-jwt')).toBeNull();
    expect(refClaimOf('a.!!!not-base64!!!.c')).toBeNull();
    expect(refClaimOf(`${enc({})}.${enc('a string, not an object')}.sig`)).toBeNull();
  });
});
