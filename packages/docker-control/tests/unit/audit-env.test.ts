/**
 * The US3 audit tool (T009). Its two hard properties — never prints a value,
 * never modifies anything — are asserted directly, because both are the kind of
 * promise that is easy to make and easy to break by accident.
 */
import { describe, expect, test } from 'vitest';
import { mkdtemp, mkdir, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  auditEnvContent,
  auditInstancesDir,
  auditStoredValues,
  envContentIsStructurallyClean,
  formatAuditReport,
} from '../../src/audit-env.js';

const CLEAN_ENV = [
  '# supastack per-instance environment',
  'ANON_KEY=eyJhbGci.eyJyb2xl.sig',
  'POSTGRES_PASSWORD=SafeAlphaNum123',
  'PROXY_DOMAIN=',
  'STUDIO_DEFAULT_ORGANIZATION=My Project',
  '',
].join('\n');

describe('auditEnvContent — happy path', () => {
  test('a clean file produces zero findings', () => {
    expect(auditEnvContent('abc', CLEAN_ENV)).toEqual([]);
  });

  test('spaces, empty values, comments and unicode are not findings', () => {
    const content = '# c\nA=Ünïcode Prøject 日本\nB=\nC=a#b\n\n';
    expect(auditEnvContent('abc', content)).toEqual([]);
  });
});

describe('auditEnvContent — sad path', () => {
  test('reports each character class with the right field and violation', () => {
    const content = [
      'GOTRUE_SITE_URL=https://x/?k=${MASTER_KEY}',
      'SMTP_USER=a`b',
      'SMTP_PASS=a\\b',
      "SMTP_HOST=a'b",
      'STUDIO_DEFAULT_PROJECT=a\tb',
    ].join('\n');

    expect(auditEnvContent('abc', content, 'runtime-config')).toEqual([
      { ref: 'abc', field: 'GOTRUE_SITE_URL', origin: 'runtime-config', violation: 'dollar' },
      { ref: 'abc', field: 'SMTP_USER', origin: 'runtime-config', violation: 'backtick' },
      { ref: 'abc', field: 'SMTP_PASS', origin: 'runtime-config', violation: 'backslash' },
      { ref: 'abc', field: 'SMTP_HOST', origin: 'runtime-config', violation: 'quote' },
      {
        ref: 'abc',
        field: 'STUDIO_DEFAULT_PROJECT',
        origin: 'runtime-config',
        violation: 'whitespace',
      },
    ]);
  });

  test('reports a duplicate assignment — the trace an injected line leaves', () => {
    const content = 'A=1\nCOMPOSE_FILE=attacker.yml\nA=2\n';
    const findings = auditEnvContent('abc', content);
    expect(findings).toContainEqual({
      ref: 'abc',
      field: 'A',
      origin: 'provision',
      violation: 'duplicate-assignment',
    });
  });

  test('reports a line that is not an assignment', () => {
    expect(auditEnvContent('abc', 'A=1\nthis is not an assignment\n')).toContainEqual({
      ref: 'abc',
      field: '<line>',
      origin: 'provision',
      violation: 'malformed-line',
    });
  });

  test('reports values Compose would silently alter, which the character rule allows', () => {
    expect(auditEnvContent('abc', 'A=trailing \n')).toEqual([
      { ref: 'abc', field: 'A', origin: 'provision', violation: 'edge-whitespace' },
    ]);
    expect(auditEnvContent('abc', 'B=issue #12\n')).toEqual([
      { ref: 'abc', field: 'B', origin: 'provision', violation: 'inline-comment' },
    ]);
  });
});

describe('auditStoredValues', () => {
  test('happy: ordinary stored configuration reports nothing', () => {
    expect(
      auditStoredValues('abc', {
        SITE_URL: 'https://abc.supastack.example',
        MAILER_SUBJECTS_INVITE: 'You have been invited',
        SMTP_PORT: 587,
        DISABLED: null,
      }),
    ).toEqual([]);
  });

  test('sad: the SEC-065 payload is reported by field and class', () => {
    expect(auditStoredValues('abc', { MAILER_SUBJECTS_INVITE: 'hi ${MASTER_KEY}' })).toEqual([
      { ref: 'abc', field: 'MAILER_SUBJECTS_INVITE', origin: 'stored-config', violation: 'dollar' },
    ]);
  });
});

describe('FR-009 — the audit never prints a value', () => {
  const SECRET = 'sup3rSecret$Passw0rd';

  test('neither findings nor the rendered report contain the value', () => {
    const findings = [
      ...auditEnvContent('abc', `SMTP_PASS=${SECRET}\n`),
      ...auditStoredValues('abc', { SMTP_PASS: SECRET }),
    ];
    expect(findings.length).toBe(2);

    const serialized = JSON.stringify(findings) + formatAuditReport(findings);
    expect(serialized).not.toContain(SECRET);
    expect(serialized).not.toContain('sup3rSecret');
    expect(serialized).toContain('SMTP_PASS');
    expect(serialized).toContain('dollar');
  });

  test('a clean run says so rather than printing nothing', () => {
    expect(formatAuditReport([])).toMatch(/0 findings/);
  });
});

describe('auditInstancesDir — filesystem walk', () => {
  test('happy: a clean installation reports zero and changes no file', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-clean-'));
    await mkdir(path.join(dir, 'ref1'));
    const envPath = path.join(dir, 'ref1', '.env');
    await writeFile(envPath, CLEAN_ENV);
    const before = await stat(envPath);

    expect(await auditInstancesDir(dir)).toEqual([]);

    const after = await stat(envPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    expect(after.size).toBe(before.size);
    await rm(dir, { recursive: true });
  });

  test('sad: seeded violations are reported per project, and nothing is rewritten', async () => {
    const dir = await mkdtemp(path.join(tmpdir(), 'audit-dirty-'));
    await mkdir(path.join(dir, 'ref1'));
    await mkdir(path.join(dir, 'ref2'));
    await mkdir(path.join(dir, 'halfprovisioned'));
    await writeFile(path.join(dir, 'ref1', '.env'), CLEAN_ENV);
    await writeFile(path.join(dir, 'ref2', '.env'), 'SMTP_HOST=a${MASTER_KEY}\nA=1\nA=2\n');
    const dirtyPath = path.join(dir, 'ref2', '.env');
    const before = await stat(dirtyPath);

    const findings = await auditInstancesDir(dir);

    expect(findings.map((f) => `${f.ref}/${f.field}/${f.violation}`)).toEqual([
      'ref2/SMTP_HOST/dollar',
      'ref2/A/duplicate-assignment',
    ]);
    const after = await stat(dirtyPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
    await rm(dir, { recursive: true });
  });

  test('a missing instances directory is not an error', async () => {
    expect(await auditInstancesDir(path.join(tmpdir(), 'definitely-not-here-121'))).toEqual([]);
  });
});

describe('envContentIsStructurallyClean', () => {
  test('true for a well-formed file, false once a line is injected', () => {
    expect(envContentIsStructurallyClean(CLEAN_ENV)).toBe(true);
    expect(envContentIsStructurallyClean(CLEAN_ENV + 'ANON_KEY=hijacked\n')).toBe(false);
  });
});
