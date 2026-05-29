#!/usr/bin/env node
/**
 * Dormancy guard (feature 023): every committed test file MUST live where the
 * vitest workspace collects it, so a test can never exist-but-never-run.
 * Fails `pnpm lint` otherwise.
 *
 * Collected roots (must mirror vitest.workspace.ts): packages/*, apps/*, tests/.
 * Excludes build output (node_modules, dist, ...) and locations intentionally
 * outside the vitest suite, mirroring vitest.config.ts: tests/e2e (Playwright),
 * any theme/ (vendored), and infra/supabase-template (per-instance templates).
 *
 * Spec: specs/023-integration-test-home/spec.md FR-006, SC-004
 * Contract: specs/023-integration-test-home/contracts/test-collection-guard.md
 */
import { readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const TEST_FILE = /\.(test|spec)\.tsx?$/;
const PRUNE_DIRS = new Set(['node_modules', 'dist', 'build', 'coverage', '.next', '.git']);
// Locations intentionally outside the vitest suite (mirror vitest.config.ts excludes):
// tests/e2e (Playwright, e2e job), theme/ (vendored), infra/supabase-template (templates).
const EXCLUDE = [/(^|\/)tests\/e2e\//, /(^|\/)theme\//, /^infra\/supabase-template\//];

// A test file is "collected" iff its repo-relative path is under one of these.
function isCollected(rel) {
  return /^packages\/[^/]+\//.test(rel) || /^apps\/[^/]+\//.test(rel) || /^tests\//.test(rel);
}

/** Recursively list repo-relative test file paths, pruning heavy/output dirs. */
function walk(absDir, relDir = '') {
  const found = [];
  for (const dirent of readdirSync(absDir, { withFileTypes: true })) {
    const rel = relDir ? `${relDir}/${dirent.name}` : dirent.name;
    if (dirent.isDirectory()) {
      if (PRUNE_DIRS.has(dirent.name)) continue;
      found.push(...walk(`${absDir}/${dirent.name}`, rel));
    } else if (TEST_FILE.test(dirent.name)) {
      found.push(rel);
    }
  }
  return found;
}

const candidates = walk(REPO_ROOT).filter((rel) => !EXCLUDE.some((re) => re.test(rel)));
const offenders = candidates.filter((rel) => !isCollected(rel));

if (offenders.length > 0) {
  for (const rel of offenders) {
    console.error(`✗ uncollected test file: ${rel}`);
    console.error(
      '    → move it under a package (apps/<x>/ or packages/<x>/) or the root tests/ dir',
    );
  }
  console.error(
    `\ncheck-test-collection: ${offenders.length} test file(s) in a location no vitest project collects ` +
      '(workspace collects packages/*, apps/*, ./tests/).',
  );
  process.exit(1);
}

console.log(`✓ all ${candidates.length} test files are collected`);
