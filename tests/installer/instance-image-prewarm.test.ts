import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * install.sh pulls the per-project Supabase images upfront (before the stack
 * starts) so the FIRST project creation doesn't spend minutes downloading
 * ~4 GB (hit on the shipfan.xyz fresh install). The list is HARDCODED in install.sh
 * (deliberate — pull-mode installs have no source checkout to read the
 * template from), so this test is the drift guard: it must equal exactly the
 * pins in infra/supabase-template/docker-compose.yml plus the STUDIO_IMAGE
 * default from infra/docker-compose.yml. Bump a pin → update install.sh.
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '../..', rel), 'utf8');

const installSh = read('install.sh');
const template = read('infra/supabase-template/docker-compose.yml');
const controlPlane = read('infra/docker-compose.yml');

function installerImages(): string[] {
  const block = installSh.match(/INSTANCE_IMAGES=\(([^)]*)\)/);
  if (!block) throw new Error('INSTANCE_IMAGES=( ... ) block not found in install.sh');
  return block[1]
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith('#'));
}

function templateImages(): string[] {
  const images = [...template.matchAll(/^\s+image:\s*(\S+)/gm)].map((m) => m[1]);
  // ${STUDIO_IMAGE} resolves from the worker env default in the control-plane compose.
  const studioDefault = controlPlane.match(/STUDIO_IMAGE:\s*\$\{STUDIO_IMAGE:-([^}]+)\}/);
  if (!studioDefault) throw new Error('STUDIO_IMAGE default not found in infra/docker-compose.yml');
  return images.map((img) => (img === '${STUDIO_IMAGE}' ? studioDefault[1] : img));
}

describe('install.sh — per-project image prewarm', () => {
  it('prewarm list matches the template pins exactly (no missing, no stale extras)', () => {
    expect(installerImages().sort()).toEqual([...new Set(templateImages())].sort());
  });

  it('every template image is a literal pinned tag (no unresolved compose vars leak into the list)', () => {
    for (const img of templateImages()) {
      expect(img, `unresolved compose variable in template image: ${img}`).not.toContain('${');
      expect(img, `unpinned image (no tag): ${img}`).toMatch(/:[^:]+$/);
    }
  });

  it('pulls everything upfront — per-project images download BEFORE the stack starts', () => {
    const pullLoop = installSh.indexOf('docker pull -q "$img"');
    // The literal compose invocation — a plain 'up -d' also matches comments.
    const stackUp = installSh.indexOf('"${COMPOSE[@]}" up -d');
    expect(pullLoop, 'per-project pull loop not found').toBeGreaterThan(-1);
    expect(stackUp, 'compose up not found').toBeGreaterThan(-1);
    expect(pullLoop, 'per-project images must be pulled before compose up').toBeLessThan(stackUp);
  });

  it('a failed pull warns but never aborts the install (set -e is active)', () => {
    expect(installSh).toMatch(/docker pull -q "\$img" \|\| warn/);
  });

  it('pulls run in parallel — backgrounded jobs joined by wait, not one-by-one', () => {
    // The original serial loop spent minutes pulling ~4 GB sequentially on a
    // fresh VM. Each pull must be backgrounded (`… ; } &`) and the loop joined
    // with `wait` over the collected PIDs.
    expect(installSh).toMatch(/docker pull -q "\$img" \|\| warn[^\n]*; \} &/);
    expect(installSh).toMatch(/pull_pids\+=\("\$!"\)/);
    expect(installSh).toMatch(/wait "\$\{pull_pids\[@\]\}"/);
  });
});
