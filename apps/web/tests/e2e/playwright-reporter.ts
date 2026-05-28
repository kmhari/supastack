import { readFile, writeFile } from 'node:fs/promises';
import type { Reporter, TestCase, TestResult } from '@playwright/test/reporter';
import { redact } from './redactor';

/**
 * Custom Playwright reporter that redacts known secret patterns from text
 * artifacts captured during a test run.
 *
 * Spec: specs/021-dashboard-browser-tests/spec.md FR-009 (text-only scope)
 * Plan: specs/021-dashboard-browser-tests/plan.md §A6
 * Task: T011
 *
 * Image attachments (`image/*` content types) pass through unchanged — PNG
 * redaction is out of scope for v1; see FR-009 for the tracking note.
 */
export default class RedactingReporter implements Reporter {
  async onTestEnd(_test: TestCase, result: TestResult): Promise<void> {
    for (const attachment of result.attachments) {
      if (attachment.contentType?.startsWith('image/')) continue;

      // In-memory body (small attachments — Playwright keeps these in RAM)
      if (attachment.body) {
        const redacted = redact(attachment.body.toString('utf8'));
        attachment.body = Buffer.from(redacted, 'utf8');
      }

      // File-backed body (larger artifacts; HTML report references the path)
      if (attachment.path) {
        await redactFile(attachment.path);
      }
    }
  }
}

async function redactFile(path: string): Promise<void> {
  // Only process plausible text formats; binary / unknown extensions left alone.
  if (!isTextFile(path)) return;
  try {
    const raw = await readFile(path, 'utf8');
    const redacted = redact(raw);
    if (redacted !== raw) {
      await writeFile(path, redacted, 'utf8');
    }
  } catch {
    // Best-effort — file may have been moved by the parent reporter already.
  }
}

function isTextFile(path: string): boolean {
  return /\.(txt|log|json|jsonl|md|yaml|yml|xml|html|csv)$/i.test(path);
}
