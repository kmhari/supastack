#!/usr/bin/env node
/**
 * Coverage lint: every dashboard-page file under apps/web/src/pages/ must
 * either appear in EXPECTED_PAGES (covered by a browser smoke) OR appear in
 * EXCLUDED_PAGES with a written reason.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md FR-010, SC-004
 * Contract: specs/021-dashboard-browser-tests/contracts/expected-pages.md
 * Task: T022
 *
 * Exits 1 on drift with a clear message naming the offender. Wired into the
 * existing `pnpm lint` chain via T023.
 */

import { readdir, readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const PAGES_DIR = resolve(SCRIPT_DIR, '../src/pages');
const REGISTRY_PATH = resolve(SCRIPT_DIR, '../tests/e2e/expected-pages.ts');

// Dashboard-page file convention: files matching these patterns under
// src/pages/ must be covered or explicitly excluded. Sub-directories under
// pages/ are NOT scanned (e.g. apps/web/src/pages/auth-providers/ holds
// component pieces, not top-level pages).
const PAGE_FILE_PATTERN = /^(Project|Settings|Instance|Cli|Connect|Accept|Login|Setup).*\.tsx$/;

async function main() {
  const pageFiles = await listDashboardPageFiles();
  const { coveredFiles, excludedFiles } = await parseRegistry();

  const offenders = [];
  for (const file of pageFiles) {
    if (coveredFiles.has(file)) continue;
    if (excludedFiles.has(file)) continue;
    offenders.push(file);
  }

  const dangling = [];
  for (const file of coveredFiles) {
    if (!pageFiles.has(file)) dangling.push(file);
  }
  for (const file of excludedFiles) {
    if (!pageFiles.has(file)) dangling.push(file);
  }

  if (offenders.length === 0 && dangling.length === 0) {
    console.log(
      `✓ check-page-coverage: ${pageFiles.size} dashboard-page files all covered or excluded`,
    );
    process.exit(0);
  }

  if (offenders.length > 0) {
    console.error('❌ check-page-coverage: the following page files have no browser-test smoke:');
    for (const f of offenders) {
      console.error(`     apps/web/src/pages/${f}`);
    }
    console.error('');
    console.error(
      '   To fix: add an entry to EXPECTED_PAGES in apps/web/tests/e2e/expected-pages.ts,',
    );
    console.error('   OR add it to EXCLUDED_PAGES with a reason.');
  }
  if (dangling.length > 0) {
    console.error('');
    console.error(
      '❌ check-page-coverage: the following registry entries reference missing files:',
    );
    for (const f of dangling) {
      console.error(`     ${f}`);
    }
    console.error('');
    console.error('   To fix: remove the stale entry from apps/web/tests/e2e/expected-pages.ts.');
  }
  process.exit(1);
}

async function listDashboardPageFiles() {
  const out = new Set();
  const entries = await readdir(PAGES_DIR, { withFileTypes: true });
  for (const e of entries) {
    if (!e.isFile()) continue;
    if (!PAGE_FILE_PATTERN.test(e.name)) continue;
    out.add(e.name);
  }
  return out;
}

async function parseRegistry() {
  // Avoid loading the TS file at runtime — the script is plain Node + ESM.
  // Read as text and grep for sourceFile + EXCLUDED_PAGES entries. The
  // registry has a stable shape (single-quoted string literals), so a regex
  // pass is reliable + dep-free.
  const text = await readFile(REGISTRY_PATH, 'utf8');

  const coveredFiles = new Set();
  for (const m of text.matchAll(/sourceFile:\s*'([^']+\.tsx)'/g)) {
    coveredFiles.add(m[1]);
  }

  const excludedFiles = new Set();
  // Anchor on the export-declaration to bypass any preceding comment mention.
  const excludedSection = text.match(/export\s+const\s+EXCLUDED_PAGES[^=]*=\s*\[([\s\S]*?)\];/);
  if (excludedSection) {
    for (const m of excludedSection[1].matchAll(/file:\s*'([^']+\.tsx)'/g)) {
      excludedFiles.add(m[1]);
    }
  }
  return { coveredFiles, excludedFiles };
}

main().catch((err) => {
  console.error('❌ check-page-coverage: unexpected error');
  console.error(err);
  process.exit(2);
});
