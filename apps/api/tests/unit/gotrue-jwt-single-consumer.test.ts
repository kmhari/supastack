// @vitest-environment node
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * Feature 123 US1 exit gate (FR-017 / SC-008) — the shared secret has exactly
 * ONE legitimate consumer.
 *
 * `deriveGotrueJwtSecret(masterKey)` is a single deployment-wide HKDF with a
 * fixed label and no project in the info. That is correct for exactly one
 * thing: the control-plane GoTrue that authenticates operators, which is
 * genuinely singleton. It is wrong for anything per-project — that was SEC-037,
 * where every project shared it and any tenant's service_role key was valid on
 * every other tenant.
 *
 * This test is a ratchet. If a future change reaches for the shared secret in a
 * second place, it fails here rather than silently re-opening cross-tenant key
 * acceptance. Adding a consumer is a deliberate act: prove the caller is
 * singleton, then update this list.
 */

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../..');

/** The one permitted consumer, plus the module that defines it. */
const ALLOWED = new Set([
  'apps/api/src/services/gotrue-admin.ts',
  'packages/crypto/src/gotrue-jwt.ts',
]);

function gitGrep(args: string[]): string[] {
  let out: string;
  try {
    out = execFileSync('git', ['grep', '-l', ...args, '--', 'apps/*/src/**', 'packages/*/src/**'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
    });
  } catch (err) {
    // git grep exits 1 with no output when there are zero matches.
    if ((err as { status?: number }).status === 1) return [];
    throw err;
  }
  return out.split('\n').filter(Boolean).sort();
}

function grepProductionSources(needle: string): string[] {
  return gitGrep(['--fixed-strings', needle]);
}

describe('deriveGotrueJwtSecret — single-consumer contract', () => {
  it('is referenced only by the control-plane GoTrue admin and its own module', () => {
    expect(grepProductionSources('deriveGotrueJwtSecret')).toEqual([...ALLOWED].sort());
  });

  it('per-project secret generation does NOT reach for the shared secret', () => {
    const consumers = grepProductionSources('deriveGotrueJwtSecret');
    expect(consumers).not.toContain('apps/api/src/services/instance-secrets.ts');
  });

  it('the deleted adopt-platform-jwt route is really gone (it re-enrolled tenants)', () => {
    // Matches a quoted route-path literal, not the name in prose — the
    // surviving env writer documents where it came from, and that history is
    // worth keeping. Fastify puts the path on its own line, so a same-line
    // `.post(` pattern would miss the very declaration this guards against.
    expect(gitGrep(['-E', '[\'"]/[^\'"]*adopt-platform-jwt'])).toEqual([]);
  });
});
