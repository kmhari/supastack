#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const PACKAGES = [
  'apps/api',
  'apps/worker',
  'apps/web',
  'apps/mcp',
  'packages/oauth',
  'packages/crypto',
  'packages/db',
  'packages/docker-control',
  'packages/backup-store',
  'packages/shared',
];

function pct(v) {
  if (v === undefined || v === null || Number.isNaN(v)) return '—';
  return `${v.toFixed(2)}%`;
}

function pad(s, n, right = false) {
  s = String(s);
  if (s.length >= n) return s;
  const fill = ' '.repeat(n - s.length);
  return right ? fill + s : s + fill;
}

const rows = [];
let anyFailed = false;

for (const pkg of PACKAGES) {
  const cwd = join(ROOT, pkg);
  if (!existsSync(cwd)) {
    rows.push({ pkg, status: 'missing' });
    continue;
  }
  const res = spawnSync(
    'pnpm',
    [
      'exec',
      'vitest',
      'run',
      '--coverage',
      '--coverage.reporter=json-summary',
      '--coverage.reporter=text-summary',
      '--passWithNoTests',
    ],
    { cwd, encoding: 'utf8', env: process.env },
  );
  const out = (res.stdout || '') + (res.stderr || '');
  // Vitest exits non-zero for startup warnings (e.g. missing jsdom) even when
  // all tests pass — derive real status from test counts, not exit code.
  const failedMatch = out.match(/Tests\s+(\d+)\s+failed/);
  const passedMatch = out.match(/Tests\s+(\d+)\s+passed/);
  const noTests = /No test files found/.test(out);
  const failedCount = failedMatch ? parseInt(failedMatch[1], 10) : 0;
  const passedCount = passedMatch ? parseInt(passedMatch[1], 10) : 0;
  let status;
  if (noTests && passedCount === 0) status = 'no-tests';
  else if (failedCount > 0) status = `${failedCount} failed`;
  else status = 'ok';
  if (failedCount > 0) anyFailed = true;

  const summaryPath = join(cwd, 'coverage', 'coverage-summary.json');
  if (existsSync(summaryPath)) {
    const data = JSON.parse(readFileSync(summaryPath, 'utf8')).total;
    rows.push({
      pkg,
      stmts: data.statements?.pct,
      branch: data.branches?.pct,
      funcs: data.functions?.pct,
      lines: data.lines?.pct,
      status,
    });
  } else {
    rows.push({ pkg, status });
  }
}

const header = ['Package', 'Stmts', 'Branch', 'Funcs', 'Lines', 'Status'];
const widths = [30, 10, 10, 10, 10, 14];
console.log();
console.log(header.map((h, i) => (i === 0 ? pad(h, widths[i]) : pad(h, widths[i], true))).join(''));
console.log(widths.map((w) => '─'.repeat(w - 1) + ' ').join(''));

for (const r of rows) {
  if (r.status === 'ok' || r.status === 'failed-tests') {
    console.log(
      [
        pad(r.pkg, widths[0]),
        pad(pct(r.stmts), widths[1], true),
        pad(pct(r.branch), widths[2], true),
        pad(pct(r.funcs), widths[3], true),
        pad(pct(r.lines), widths[4], true),
        pad(r.status, widths[5], true),
      ].join(''),
    );
  } else {
    console.log(pad(r.pkg, widths[0]) + pad(r.status, widths.slice(1).reduce((a, b) => a + b, 0), true));
  }
}
console.log();

const weighted = rows.filter((r) => r.stmts !== undefined);
if (weighted.length) {
  const avg = (k) => weighted.reduce((a, r) => a + (r[k] ?? 0), 0) / weighted.length;
  console.log(
    `Unweighted mean (${weighted.length} pkgs): ` +
      `stmts ${pct(avg('stmts'))}  branch ${pct(avg('branch'))}  funcs ${pct(avg('funcs'))}  lines ${pct(avg('lines'))}`,
  );
  console.log();
}

process.exit(anyFailed ? 1 : 0);
