import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * SEC-010 — installs must not silently track the mutable `latest` tag (a no-digest
 * mutable tag is a supply-chain RCE vector). The default lives in a single
 * `SUPASTACK_DEFAULT_VERSION` bumped at release time, and `latest` triggers a loud
 * warning recommending a pinned release.
 */
const here = dirname(fileURLToPath(import.meta.url));
const src = readFileSync(join(here, '../../install.sh'), 'utf8');

describe('install.sh — version pinning (SEC-010)', () => {
  it('resolves the pull-mode default from a single pinnable variable', () => {
    expect(src).toMatch(/SUPASTACK_DEFAULT_VERSION="[^"]*"/);
    expect(src).toMatch(/SUPASTACK_VERSION="\$\{SUPASTACK_VERSION:-\$SUPASTACK_DEFAULT_VERSION\}"/);
  });

  it('warns loudly when the resolved tag is the mutable `latest`', () => {
    expect(src).toMatch(/if \[\[ "\$SUPASTACK_VERSION" == "latest" \]\]; then\n\s+warn /);
    expect(src).toMatch(/pin a release/i);
  });
});
