// @vitest-environment node
//
// Feature 117 — single-source apex invariant. The apex domain lives only in
// SUPASTACK_APEX (read via @supastack/shared getApex). There is NO
// installation.apex_domain column anymore (migration 0024 dropped it). This
// contract test fails if any production source re-introduces a second source:
// a read/write of installation.apexDomain / the apex_domain column, or an import
// of the deleted apex-resolver. Greppably enforces #110 cannot recur.
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const REPO = join(here, '../../../..'); // apps/api/tests/contract → repo root
const SRC_DIRS = [
  join(REPO, 'apps/api/src'),
  join(REPO, 'apps/worker/src'),
  join(REPO, 'packages/shared/src'),
  join(REPO, 'packages/db/src'),
];

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (p.endsWith('.ts')) out.push(p);
  }
  return out;
}

const FILES = SRC_DIRS.flatMap(tsFiles);
const rel = (p: string): string => relative(REPO, p);

// Banned in production source: a second apex store. (`apex_domain` as a column,
// or `.apexDomain` off the installation schema/row.)
const PATTERNS: { label: string; re: RegExp }[] = [
  { label: 'installation.apexDomain', re: /installation\.apexDomain/ },
  { label: 'apex_domain column', re: /apex_domain/ },
  { label: 'apex-resolver import', re: /apex-resolver/ },
  { label: 'resolveApex', re: /\bresolveApex\b/ },
];

describe('single-source apex contract (feature 117 — #110 cannot recur)', () => {
  it('no production source reads/writes a second apex store', () => {
    const offenders: string[] = [];
    for (const file of FILES) {
      const text = readFileSync(file, 'utf8');
      for (const { label, re } of PATTERNS) {
        if (re.test(text)) offenders.push(`${rel(file)} → ${label}`);
      }
    }
    expect(
      offenders,
      `apex is single-sourced from SUPASTACK_APEX; offenders:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('the deleted apex-resolver service no longer exists', () => {
    const resolver = join(REPO, 'apps/api/src/services/apex-resolver.ts');
    let exists = true;
    try {
      statSync(resolver);
    } catch {
      exists = false;
    }
    expect(exists).toBe(false);
  });
});
