import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * install.sh's health gate probes the api from INSIDE the api container, so
 * the probe binary must exist in the api image. The image is node:20-slim:
 * no wget, no curl. The first real pull-mode install (shipfan.xyz,
 * 2026-06-11) timed out at the gate purely because the probe used wget —
 * the api itself was healthy. The probe must use node fetch, exactly like
 * the compose healthcheck.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../install.sh'), 'utf8');

describe('install.sh — health gate probe', () => {
  it('does not probe the api container with wget or curl (not in the image)', () => {
    expect(src).not.toMatch(/exec -T api (wget|curl)/);
  });
  it('probes via node fetch against /api/v1/health', () => {
    expect(src).toMatch(/exec -T api node -e .*fetch\('http:\/\/localhost:3001\/api\/v1\/health'\)/);
  });
});

describe('install.sh — repo-free staging is the installer\'s job', () => {
  it('stages pre-staged files from the script dir into INSTALL_DIR itself (no operator sudo/mkdir)', () => {
    expect(src).toMatch(/have_needed_files "\$SCRIPT_DIR"/);
    expect(src).toMatch(/\$SUDO mkdir -p "\$INSTALL_DIR\/infra" "\$INSTALL_DIR\/scripts"/);
  });
});

describe('install.sh — preflight (root VPS reality)', () => {
  it('supports running as root (fresh VPSes often only have root) — no root rejection', () => {
    // The old `die "Do not run as root"` blocked every root-only VPS.
    expect(src).not.toMatch(/Do not run as root/);
    // Root path: privileged commands run bare; non-root path keeps sudo.
    expect(src).toMatch(/if \[\[ \$EUID -eq 0 \]\]; then\n\s+SUDO=""/);
    // No privileged command bypasses the wrapper (allowed bare-sudo: the
    // -n probe, usermod inside the non-root branch, and help-text strings).
    const bareSudo = src
      .split('\n')
      .filter((l) => /^\s*sudo /.test(l) && !/usermod|sudo -n/.test(l));
    expect(bareSudo).toEqual([]);
  });

  it('refuses to run inside a container', () => {
    expect(src).toMatch(/\/\.dockerenv/);
  });

  it('fails fast when ports 80/443 are taken — but not by our own caddy (idempotent re-run)', () => {
    expect(src).toMatch(/supastack-caddy/);
    expect(src).toMatch(/ss -ltn/);
    expect(src).toMatch(/already listening on port/);
  });
});

describe('install.sh — curl|bash one-liner (public repo)', () => {
  it('sg-docker re-exec only when $0 is a real file — piped installs have $0=bash', () => {
    // Unguarded `exec sg docker "$0 $*"` under curl|bash exec's a bare shell
    // instead of resuming the install.
    expect(src).toMatch(/if \[\[ -f "\$0" \]\]; then\n\s+warn .*\n\s+exec sg docker "\$0 \$\*"/);
    expect(src).toMatch(/Log out and back in \(or run as root\)/);
  });

  it('auto-installs git for the clone path on apt systems (minimal images)', () => {
    expect(src).toMatch(/apt-get install -y -qq git/);
    // Non-apt systems still get the actionable manual hint instead of a bare failure.
    expect(src).toMatch(/git not found\. Install it/);
  });
});
