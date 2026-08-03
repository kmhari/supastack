/**
 * Shared assertions for the feature-121 env-writer suites.
 *
 * `parseEnvBack` is deliberately an INDEPENDENT implementation of Compose's
 * dotenv semantics rather than a re-export of the writer's own parser. The
 * writer self-verifies with its parser; if the tests used the same one, a bug
 * in it would be invisible on both sides. Two implementations that agree is
 * evidence; one implementation agreeing with itself is not.
 *
 * Semantics modelled (measured against Compose v5.0.2 — specs/121 research Q5):
 *   - blank lines and full-line `#` comments are skipped
 *   - a value ends at the first whitespace-preceded `#`
 *   - surrounding whitespace is stripped; `a#b` is literal
 */
import { expect } from 'vitest';

export interface ParsedEnv {
  /** In file order, duplicates preserved — an injected line shows up here. */
  entries: Array<{ name: string; value: string }>;
  /** Collapsed to a map, last assignment winning. */
  map: Record<string, string>;
}

export function parseEnvBack(content: string): ParsedEnv {
  const entries: Array<{ name: string; value: string }> = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const rawValue = line.slice(eq + 1);
    const commentAt = rawValue.search(/\s#/);
    entries.push({
      name: line.slice(0, eq).trim(),
      value: (commentAt >= 0 ? rawValue.slice(0, commentAt) : rawValue).trim(),
    });
  }
  const map: Record<string, string> = {};
  for (const { name, value } of entries) map[name] = value;
  return { entries, map };
}

/**
 * C5 — a rejection must name the field without echoing the value. Checks the
 * whole error, message and stack, because a thrown value interpolated into a
 * stack frame leaks just as effectively as one in the message.
 */
export function assertNoSecretInMessage(err: unknown, secret: string, field?: string): void {
  const error = err as Error;
  const rendered = `${error?.message ?? String(err)}\n${error?.stack ?? ''}`;
  expect(rendered).not.toContain(secret);
  if (field) expect(error.message).toContain(field);
}

/**
 * Run `fn`, assert it threw, and hand the error back for further assertions.
 * `await expect(...).rejects` cannot express "and now inspect the stack".
 */
export async function captureThrow(fn: () => unknown | Promise<unknown>): Promise<unknown> {
  try {
    await fn();
  } catch (err) {
    return err;
  }
  throw new Error('expected the call to throw, but it returned');
}
