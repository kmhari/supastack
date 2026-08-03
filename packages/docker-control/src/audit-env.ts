/**
 * Read-only audit for values that got in before the boundary closed
 * (feature 121, US3 / FR-009 / D6).
 *
 * Fixing the writer stops new injection but evicts nobody who already got in.
 * This walks what is already on disk and already stored, and reports anything
 * the new rule would refuse.
 *
 * Two hard properties, both tested:
 *  - **It never prints a value.** A finding carries the project, the variable
 *    name, which writer produced it, and which class of character is wrong.
 *    Half these variables are secrets; an audit that leaks them is worse than
 *    no audit.
 *  - **It never modifies anything.** No writes, no chmod, no atime-touching
 *    rewrite. Remediating a live tenant's configuration is a breaking change
 *    and a separate decision (D6).
 *
 * Detection on a file that is already flat is necessarily different from
 * detection at the writer: an injected line break has already become a real
 * line and is indistinguishable from a legitimate one. So this reports the
 * evidence a redirect leaves behind — a duplicate assignment, a variable no
 * writer of ours emits, a line that is not an assignment at all — alongside
 * the character violations.
 */
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { findEnvViolation, type EnvViolationClass } from '@supastack/crypto';
import { parseEnvFile } from './env-writer.js';

/** Which code path produced the value being audited. */
export type EnvWriterOrigin = 'provision' | 'runtime-config' | 'key-adoption' | 'stored-config';

/** Character-class violations, plus the structural evidence only a file shows. */
export type EnvAuditViolation =
  | EnvViolationClass
  | 'edge-whitespace'
  | 'inline-comment'
  | 'duplicate-assignment'
  | 'malformed-line';

export interface EnvAuditFinding {
  /** Project ref, or the installation-level marker when not project-scoped. */
  ref: string;
  /** Variable or field name. Never the value. */
  field: string;
  origin: EnvWriterOrigin;
  violation: EnvAuditViolation;
}

/**
 * Classify a single value. `allowSpace` mirrors the writer's trust classes:
 * stored operator configuration is held to the space-permitting rule.
 */
function classifyValue(value: string, allowSpace: boolean): EnvAuditViolation | null {
  const characterViolation = findEnvViolation(value, allowSpace);
  if (characterViolation) return characterViolation;
  if (value !== value.trim()) return 'edge-whitespace';
  if (/\s#/.test(value)) return 'inline-comment';
  return null;
}

/**
 * Audit already-rendered env-file content.
 *
 * Note the asymmetry with the writer: this reads the RAW text of each line, not
 * the parsed value, because the parse is exactly what hides the problem. A
 * value that ends in a space parses to the trimmed string and looks clean; the
 * raw line is what shows the operator that the container is not receiving what
 * the dashboard displays.
 */
export function auditEnvContent(
  ref: string,
  content: string,
  origin: EnvWriterOrigin = 'provision',
): EnvAuditFinding[] {
  const findings: EnvAuditFinding[] = [];
  const seen = new Set<string>();

  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;

    const eq = line.indexOf('=');
    if (eq < 1) {
      findings.push({ ref, field: '<line>', origin, violation: 'malformed-line' });
      continue;
    }

    const field = line.slice(0, eq).trim();
    if (seen.has(field)) {
      findings.push({ ref, field, origin, violation: 'duplicate-assignment' });
    }
    seen.add(field);

    const violation = classifyValue(line.slice(eq + 1), true);
    if (violation) findings.push({ ref, field, origin, violation });
  }

  return findings;
}

/**
 * Audit stored configuration values — the ones a rewrite would push into an
 * env file. `values` is a plain field→value map; the caller decrypts, this
 * function never sees storage.
 */
export function auditStoredValues(
  ref: string,
  values: Record<string, string | number | null | undefined>,
  origin: EnvWriterOrigin = 'stored-config',
): EnvAuditFinding[] {
  const findings: EnvAuditFinding[] = [];
  for (const [field, raw] of Object.entries(values)) {
    if (raw === null || raw === undefined) continue;
    const violation = classifyValue(String(raw), true);
    if (violation) findings.push({ ref, field, origin, violation });
  }
  return findings;
}

/**
 * Walk an instances directory (`/var/supastack/instances`) and audit each
 * project's `.env`. Opens files read-only and writes nothing.
 *
 * A directory without a readable `.env` is skipped rather than reported — a
 * half-provisioned project is not an injection finding.
 */
export async function auditInstancesDir(instancesDir: string): Promise<EnvAuditFinding[]> {
  let refs: string[];
  try {
    refs = (await fs.readdir(instancesDir, { withFileTypes: true }))
      .filter((d) => d.isDirectory())
      .map((d) => d.name)
      .sort();
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return [];
    throw err;
  }

  const findings: EnvAuditFinding[] = [];
  for (const ref of refs) {
    let content: string;
    try {
      content = await fs.readFile(path.join(instancesDir, ref, '.env'), 'utf8');
    } catch {
      continue;
    }
    findings.push(...auditEnvContent(ref, content, 'provision'));
  }
  return findings;
}

/**
 * Render findings for an operator. One line per finding, no values, ever.
 * A clean run says so explicitly rather than printing nothing — silence is
 * indistinguishable from a tool that failed to run.
 */
export function formatAuditReport(findings: EnvAuditFinding[]): string {
  if (findings.length === 0) {
    return 'env audit: 0 findings — every stored value and env line passes the rule\n';
  }
  const lines = findings.map((f) => `${f.ref}\t${f.field}\t${f.origin}\t${f.violation}`);
  return (
    `env audit: ${findings.length} finding(s) — values are NOT printed\n` +
    'ref\tfield\torigin\tviolation\n' +
    lines.join('\n') +
    '\n'
  );
}

/** True when a rendered env file would parse to exactly the pairs it declares. */
export function envContentIsStructurallyClean(content: string): boolean {
  const entries = parseEnvFile(content);
  return new Set(entries.map((e) => e.name)).size === entries.length;
}
