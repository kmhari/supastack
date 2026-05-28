/**
 * Secret-pattern redactor for browser-test artifacts.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md FR-009
 * Data model: specs/021-dashboard-browser-tests/data-model.md §6
 * Task: T010
 *
 * Applied by the custom Playwright reporter (`playwright-reporter.ts`) to
 * captured text artifacts (logs, JSON network panels, JUnit reports) before
 * they're zipped for CI upload. PNG screenshots are NOT processed by this
 * module — image redaction is explicitly out of scope for v1 (see FR-009 +
 * tracking issue).
 */

export interface RedactionPattern {
  pattern: RegExp;
  /** Stable replacement string. Length-independent so test failures don't
   * depend on the original secret's length. */
  replacement: string;
}

export const REDACTION_PATTERNS: ReadonlyArray<RedactionPattern> = [
  // selfbase Personal Access Tokens: `sbp_` + 40 hex chars
  { pattern: /sbp_[a-f0-9]{40}/g, replacement: 'sbp_REDACTED' },
  // Authorization headers
  { pattern: /Bearer [A-Za-z0-9._-]+/g, replacement: 'Bearer REDACTED' },
  // Dashboard session cookie value
  { pattern: /sb_sid=[A-Za-z0-9_-]+/g, replacement: 'sb_sid=REDACTED' },
];

/**
 * Apply every redaction pattern in order. Idempotent — running redact on an
 * already-redacted string is a no-op.
 */
export function redact(input: string): string {
  let out = input;
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    out = out.replace(pattern, replacement);
  }
  return out;
}
