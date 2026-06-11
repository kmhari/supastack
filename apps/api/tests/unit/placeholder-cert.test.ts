// @vitest-environment node
import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtemp, stat, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { X509Certificate } from 'node:crypto';
import { ensurePlaceholderCert } from '../../src/services/placeholder-cert.js';

/**
 * Fresh-install regression (shipfan.xyz, 2026-06-11): supavisor hard-fails at
 * boot when GLOBAL_DOWNSTREAM_CERT_PATH points at a file that doesn't exist —
 * and the wildcard cert only exists after /setup issues it. The api must
 * write a self-signed placeholder at boot so supavisor can start on a virgin
 * install; the real cert later overwrites it via the same paths.
 */
const opensslAvailable = (() => {
  try {
    execFileSync('openssl', ['version'], { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
})();

describe.skipIf(!opensslAvailable)('ensurePlaceholderCert', () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'supastack-cert-'));
  });

  it('creates a parseable self-signed cert covering apex + wildcard', async () => {
    const result = await ensurePlaceholderCert('example.test', dir);
    expect(result).toBe('created');

    const certPem = await readFile(join(dir, 'example.test', 'cert.pem'), 'utf8');
    const cert = new X509Certificate(certPem);
    expect(cert.subjectAltName).toContain('DNS:example.test');
    expect(cert.subjectAltName).toContain('DNS:*.example.test');

    // key.pem must be operator-read-only (same mode acme.ts uses).
    const keyStat = await stat(join(dir, 'example.test', 'key.pem'));
    expect(keyStat.mode & 0o777).toBe(0o600);
  });

  it('is a no-op when cert files already exist (never clobbers a real cert)', async () => {
    await ensurePlaceholderCert('example.test', dir);
    const before = await readFile(join(dir, 'example.test', 'cert.pem'), 'utf8');

    const result = await ensurePlaceholderCert('example.test', dir);
    expect(result).toBe('exists');
    const after = await readFile(join(dir, 'example.test', 'cert.pem'), 'utf8');
    expect(after).toBe(before);
  });

  it('rejects an apex that could break out of the shell command', async () => {
    await expect(ensurePlaceholderCert("bad'apex; rm -rf /", dir)).rejects.toThrow();
  });
});
