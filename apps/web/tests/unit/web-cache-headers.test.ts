// @vitest-environment node
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, test } from 'vitest';

/**
 * Contract test for the dashboard web container's Caddy cache policy.
 *
 * Regression guard for issue #80 (stale dashboard bundle after a deploy):
 *   - index.html + SPA routes MUST be served `Cache-Control: no-cache`, so the
 *     browser revalidates every load and picks up a new deploy on a normal
 *     refresh (no hard-refresh). The 304 path is cheap (Caddy emits an ETag).
 *   - Vite content-hashed /assets/* MUST be cached `immutable` for ~1y; the
 *     filename changes on every rebuild, so a stale bundle can never be served.
 *
 * This behavior lives ONLY in the production `web` container (Caddy serving the
 * built SPA from Caddyfile.runtime). The e2e job runs the Vite dev server, which
 * does not read that file — so this static contract test is the cheapest CI
 * guard against someone silently dropping these directives. The faithful
 * on-the-wire check lives in tests/cli-e2e/web-cache-headers.sh.
 */
const CADDYFILE = readFileSync(
  fileURLToPath(new URL('../../Caddyfile.runtime', import.meta.url)),
  'utf8',
);

describe('web Caddyfile.runtime cache policy (issue #80)', () => {
  test('content-hashed /assets/* are cached immutably for ~a year', () => {
    expect(CADDYFILE, 'expected a matcher scoping /assets/*').toMatch(/path\s+\/assets\/\*/);
    const assetCC = CADDYFILE.match(/Cache-Control\s+"([^"]*immutable[^"]*)"/i);
    expect(assetCC, 'expected an immutable Cache-Control for /assets/*').not.toBeNull();
    // long-lived: max-age of at least ~1,000,000s (the fix uses 31536000 = 1y)
    expect(assetCC![1]).toMatch(/max-age=\d{7,}/);
  });

  test('index.html / SPA routes revalidate every load (no-cache)', () => {
    expect(CADDYFILE).toMatch(/Cache-Control\s+"no-cache"/i);
  });

  test('SPA fallback to /index.html is preserved (routing not broken)', () => {
    expect(CADDYFILE).toMatch(/try_files\s+\{path\}\s+\/index\.html/);
  });
});
