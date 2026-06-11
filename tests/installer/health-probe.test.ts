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
    expect(src).toMatch(/sudo mkdir -p "\$INSTALL_DIR\/infra" "\$INSTALL_DIR\/scripts"/);
  });
});
