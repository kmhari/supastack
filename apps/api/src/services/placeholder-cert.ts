/**
 * Self-signed placeholder wildcard cert for first boot.
 *
 * Supavisor's runtime config hard-fails when GLOBAL_DOWNSTREAM_CERT_PATH
 * points at a missing file — and the real wildcard cert only exists after
 * /setup's DNS-01 issuance writes it (acme.ts writeCertFiles). On a virgin
 * install that's a chicken-and-egg: supavisor crash-loops until setup
 * completes. The api writes a self-signed placeholder to the SAME paths at
 * boot (only when absent), so supavisor's restart loop finds the files and
 * starts. Real issuance later overwrites them in place.
 *
 * Known limitation (pre-existing, also applies to renewals): supavisor reads
 * the cert at boot, so it serves the placeholder until its next restart after
 * real issuance — tracked as a follow-up issue.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { access, chmod, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '@supastack/shared';

const execFileP = promisify(execFile);

// Apex comes from validated install-time config, but it ends up in an openssl
// argv — be strict anyway. Hostnames only.
const APEX_RE = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/i;

export async function ensurePlaceholderCert(
  apex: string,
  certsDir: string,
): Promise<'exists' | 'created'> {
  if (!APEX_RE.test(apex)) {
    throw new Error(`ensurePlaceholderCert: invalid apex '${apex}'`);
  }
  const dir = join(certsDir, apex);
  const certPath = join(dir, 'cert.pem');
  const keyPath = join(dir, 'key.pem');

  try {
    await access(certPath);
    await access(keyPath);
    return 'exists';
  } catch {
    // fall through — at least one file missing
  }

  await mkdir(dir, { recursive: true });
  // Short-lived on purpose: this must never masquerade as a real cert.
  await execFileP('openssl', [
    'req',
    '-x509',
    '-newkey',
    'ec',
    '-pkeyopt',
    'ec_paramgen_curve:P-256',
    '-keyout',
    keyPath,
    '-out',
    certPath,
    '-days',
    '30',
    '-nodes',
    '-subj',
    `/CN=${apex}/O=supastack placeholder (pre-setup)`,
    '-addext',
    `subjectAltName=DNS:${apex},DNS:*.${apex}`,
  ]);
  await chmod(certPath, 0o644);
  await chmod(keyPath, 0o600);
  return 'created';
}

/** Boot hook — non-fatal: a failure here must never block the api. */
export async function ensurePlaceholderCertAtBoot(): Promise<void> {
  const apex = process.env.SUPASTACK_APEX;
  const certsDir = process.env.SUPASTACK_CERTS_DIR ?? '/var/supastack/certs';
  if (!apex) return;
  try {
    const result = await ensurePlaceholderCert(apex, certsDir);
    if (result === 'created') {
      logger.info({ apex }, 'placeholder wildcard cert written (pre-setup; supavisor can boot)');
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'placeholder cert generation failed; supavisor may crash-loop until the real cert is issued',
    );
  }
}
