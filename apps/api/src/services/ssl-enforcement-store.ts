/**
 * SSL enforcement store — GET/PUT /v1/projects/:ref/ssl-enforcement.
 *
 * SSL enforcement in selfbase means whether external TCP connections to the
 * per-instance Postgres must use TLS. It is controlled by the `host` vs
 * `hostssl` record type in pg_hba.conf for the external address ranges.
 *
 * GET: inspects the current pg_hba.conf to determine if SSL is enforced.
 * PUT: rewrites the external connection lines (host ↔ hostssl) and reloads.
 *
 * The external address lines managed by selfbase are identified by the
 * SELFBASE_SSL_MARKER comment inserted alongside them. If the marker is
 * absent (e.g. a user-customised pg_hba.conf), we fall back to scanning
 * for lines matching the RFC1918 + 0.0.0.0/0 pattern.
 *
 * pg_hba.conf lives at /etc/postgresql/pg_hba.conf inside the db container.
 * We read/write it via `composeExec` and reload via `pg_reload_conf()`.
 *
 * Feature 026 — supabase config push compat.
 */
import path from 'node:path';
import { composeExec } from '@selfbase/docker-control';
import { ManagementApiError } from '../plugins/mgmt-api-errors.js';
import {
  withPerInstancePg,
  InstanceNotFoundError,
  InstanceNotRunningError,
} from './per-instance-pg.js';

const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';
const PG_HBA_PATH = '/etc/postgresql/pg_hba.conf';

// Lines we manage: host/hostssl + all + all + <addr> + scram-sha-256
// Covers the four external ranges in the supabase-template pg_hba.conf
const EXTERNAL_ADDR_RE =
  /^(host(?:ssl)?)\s+(all)\s+(all)\s+((?:10\.|172\.1[6-9]\.|172\.2\d\.|172\.3[01]\.|192\.168\.|0\.0\.0\.0\/0|::0\/0)\S*)\s+(scram-sha-256.*)$/;

export interface SslEnforcementResult {
  currentConfig: { database: boolean };
  appliedSuccessfully: boolean;
}

// ─── Public API ────────────────────────────────────────────────────────────

export async function getSslEnforcement(ref: string): Promise<SslEnforcementResult> {
  const ctx = composeCtx(ref);
  const hba = await readHba(ctx);
  return {
    currentConfig: { database: isSslEnforced(hba) },
    appliedSuccessfully: true,
  };
}

export async function putSslEnforcement(
  ref: string,
  enforce: boolean,
): Promise<SslEnforcementResult> {
  const ctx = composeCtx(ref);
  const hba = await readHba(ctx);
  const updated = rewriteExternalLines(hba, enforce);

  if (updated === hba) {
    // No change needed
    return { currentConfig: { database: enforce }, appliedSuccessfully: true };
  }

  await writeHba(ctx, updated);

  // Reload pg_hba via pg_reload_conf() so no container restart needed
  try {
    await withPerInstancePg(ref, async (client) => {
      await client.query('SELECT pg_reload_conf()');
    });
  } catch (err) {
    if (err instanceof InstanceNotFoundError) {
      throw new ManagementApiError(404, 'Project not found', 'not_found', {});
    }
    if (err instanceof InstanceNotRunningError) {
      throw new ManagementApiError(503, `Project is not running: ${err.status}`, 'not_running', {
        status: err.status,
      });
    }
    throw new ManagementApiError(
      500,
      `pg_reload_conf failed: ${(err as Error).message}`,
      'reload_failed',
      {},
    );
  }

  return { currentConfig: { database: enforce }, appliedSuccessfully: true };
}

// ─── Internals ─────────────────────────────────────────────────────────────

function composeCtx(ref: string) {
  return {
    projectName: `selfbase-${ref}`,
    dir: path.join(INSTANCES_DIR, ref),
  };
}

async function readHba(ctx: { projectName: string; dir: string }): Promise<string> {
  const { stdout, stderr, exitCode } = await composeExec(ctx, 'db', ['cat', PG_HBA_PATH]);
  if (exitCode !== 0) {
    throw new ManagementApiError(
      500,
      `Failed to read pg_hba.conf: ${stderr.trim()}`,
      'hba_read_failed',
      {},
    );
  }
  return stdout;
}

async function writeHba(ctx: { projectName: string; dir: string }, content: string): Promise<void> {
  // base64-encode to avoid any shell quoting / newline issues in composeExec.
  // The encoded string is pure alphanumeric + /+=, safe to pass as a single arg.
  const b64 = Buffer.from(content).toString('base64').replace(/\n/g, '');
  const { stderr, exitCode } = await composeExec(ctx, 'db', [
    'sh',
    '-c',
    `printf '%s' '${b64}' | base64 -d > ${PG_HBA_PATH}`,
  ]);
  if (exitCode !== 0) {
    throw new ManagementApiError(
      500,
      `Failed to write pg_hba.conf: ${stderr.trim()}`,
      'hba_write_failed',
      {},
    );
  }
}

function isSslEnforced(hba: string): boolean {
  let foundExternal = false;
  for (const line of hba.split('\n')) {
    const m = line.trim().match(EXTERNAL_ADDR_RE);
    if (!m) continue;
    foundExternal = true;
    if (m[1] !== 'hostssl') return false; // at least one non-ssl line → not enforced
  }
  // If no external lines found, assume not enforced (default template uses `host`)
  return foundExternal;
}

function rewriteExternalLines(hba: string, enforce: boolean): string {
  return hba
    .split('\n')
    .map((line) => {
      const trimmed = line.trim();
      if (!EXTERNAL_ADDR_RE.test(trimmed)) return line;
      if (enforce) {
        return line.replace(/^(\s*)host(\s+)/, '$1hostssl$2');
      } else {
        return line.replace(/^(\s*)hostssl(\s+)/, '$1host$2');
      }
    })
    .join('\n');
}
