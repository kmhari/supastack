/**
 * The unified writer — contract C1, C2, C4, C5, C7.
 *
 * C4 ("no file, no partial write") is structural here rather than asserted:
 * these functions are pure and never touch the filesystem, so a rejection has
 * nothing to clean up. The call sites are what must not create a directory
 * first; that is asserted in compose-template.test.ts.
 */
import { describe, expect, test } from 'vitest';
import {
  parseEnvFile,
  parseEnvMap,
  renderEnvFile,
  updateEnvFile,
  type EnvTrustClass,
} from '../../src/env-writer.js';
import { assertNoSecretInMessage, captureThrow, parseEnvBack } from '../helpers/env-assert.js';

const FORBIDDEN: Array<[label: string, payload: string]> = [
  ['line break', 'a\nCOMPOSE_FILE=attacker.yml'],
  ['carriage return', 'a\rb'],
  ['dollar', 'a${MASTER_KEY}'],
  ['backtick', 'a`whoami`'],
  ['backslash', 'a\\b'],
  ['single quote', "a'b"],
  ['double quote', 'a"b'],
  ['tab', 'a\tb'],
];

describe('renderEnvFile — happy path', () => {
  test('emits one sorted assignment per variable and parses back identically (C2/C3)', () => {
    const content = renderEnvFile({
      generated: { POSTGRES_PASSWORD: 'SafeAlphaNum123', JWT_SECRET: 'AAAA1111' },
      operator: { STUDIO_DEFAULT_ORGANIZATION: 'My Project', SMTP_PORT: 587, PROXY_DOMAIN: '' },
    });

    expect(content).toBe(
      [
        'JWT_SECRET=AAAA1111',
        'POSTGRES_PASSWORD=SafeAlphaNum123',
        'PROXY_DOMAIN=',
        'SMTP_PORT=587',
        'STUDIO_DEFAULT_ORGANIZATION=My Project',
        '',
      ].join('\n'),
    );

    const { entries, map } = parseEnvBack(content);
    expect(entries).toHaveLength(5);
    expect(map).toEqual({
      JWT_SECRET: 'AAAA1111',
      POSTGRES_PASSWORD: 'SafeAlphaNum123',
      PROXY_DOMAIN: '',
      SMTP_PORT: '587',
      STUDIO_DEFAULT_ORGANIZATION: 'My Project',
    });
  });

  test('both trust classes accept ordinary values', () => {
    expect(() =>
      renderEnvFile({
        generated: { A: 'Ax9_-', B: 'eyJhbGci.eyJyb2xl.sig' },
        operator: { C: 'Ünïcode Prøject 日本', D: 'https://ref.apex.example', E: 'a#b' },
      }),
    ).not.toThrow();
  });

  test('an empty spec renders an empty file rather than throwing', () => {
    expect(renderEnvFile({ generated: {}, operator: {} })).toBe('\n');
  });

  test('numbers are stringified, not coerced away', () => {
    const map = parseEnvMap(renderEnvFile({ generated: {}, operator: { KONG_HTTP_PORT: 30000 } }));
    expect(map.KONG_HTTP_PORT).toBe('30000');
  });
});

describe('renderEnvFile — sad path (C1)', () => {
  test.each(FORBIDDEN)('rejects %s in an operator value', async (_label, payload) => {
    const err = await captureThrow(() =>
      renderEnvFile({ generated: {}, operator: { SMTP_HOST: payload } }),
    );
    assertNoSecretInMessage(err, payload, 'SMTP_HOST');
  });

  test.each(FORBIDDEN)('rejects %s in a generated value too', async (_label, payload) => {
    const err = await captureThrow(() =>
      renderEnvFile({ generated: { JWT_SECRET: payload }, operator: {} }),
    );
    assertNoSecretInMessage(err, payload, 'JWT_SECRET');
  });

  test('a space is refused for generated values and accepted for operator values', () => {
    expect(() => renderEnvFile({ generated: { PW: 'a b' }, operator: {} })).toThrow(/PW/);
    expect(() => renderEnvFile({ generated: {}, operator: { NAME: 'a b' } })).not.toThrow();
  });

  test('rejects a value whose trailing space Compose would strip (parse-back, not the rule)', () => {
    expect(() => renderEnvFile({ generated: {}, operator: { NAME: 'My Project ' } })).toThrow(
      /NAME/,
    );
  });

  test('rejects a value whose " #" Compose would truncate into a comment', () => {
    expect(() => renderEnvFile({ generated: {}, operator: { NAME: 'issue #12' } })).toThrow(/NAME/);
  });

  test('rejects an unsafe variable NAME, not only an unsafe value', () => {
    expect(() => renderEnvFile({ generated: {}, operator: { 'A\nB': 'x' } })).toThrow(
      /unsafe name/,
    );
    expect(() => renderEnvFile({ generated: {}, operator: { '9LEADING': 'x' } })).toThrow(
      /unsafe name/,
    );
  });

  test('rejects the same variable supplied by both trust classes', () => {
    expect(() => renderEnvFile({ generated: { X: 'a' }, operator: { X: 'b' } })).toThrow(
      /supplied twice/,
    );
  });

  test('the SEC-064 payload cannot produce a COMPOSE_FILE line', async () => {
    const payload = 'proj\nCOMPOSE_FILE=/tmp/attacker.yml';
    const err = await captureThrow(() =>
      renderEnvFile({ generated: {}, operator: { STUDIO_DEFAULT_PROJECT: payload } }),
    );
    expect((err as Error).message).toContain('STUDIO_DEFAULT_PROJECT');
    expect((err as Error).message).not.toContain('COMPOSE_FILE');
  });

  test('the SEC-065 payload cannot expand against the process environment (C7)', () => {
    expect(() =>
      renderEnvFile({ generated: {}, operator: { GOTRUE_SITE_URL: 'https://x/?k=${MASTER_KEY}' } }),
    ).toThrow(/GOTRUE_SITE_URL/);
  });
});

describe('parseEnvFile — Compose dotenv semantics', () => {
  test('skips blanks and comment lines, keeps order and duplicates', () => {
    const entries = parseEnvFile('# header\n\nA=1\nB=2\nA=3\n');
    expect(entries).toEqual([
      { name: 'A', value: '1' },
      { name: 'B', value: '2' },
      { name: 'A', value: '3' },
    ]);
  });

  test('strips surrounding whitespace and inline comments; "a#b" stays literal', () => {
    expect(parseEnvMap('A= spaced \nB=a #comment\nC=a#b\n')).toEqual({
      A: 'spaced',
      B: 'a',
      C: 'a#b',
    });
  });

  test('agrees with the independent test-side parser', () => {
    const content = 'A=1\n# c\nB=x y\nC=\n';
    expect(parseEnvMap(content)).toEqual(parseEnvBack(content).map);
  });
});

describe('updateEnvFile — happy path', () => {
  const existing = '# generated by supastack\nA=1\nJWT_SECRET=old\nB=keep me\n';

  test('rewrites only the named lines and preserves the rest byte-for-byte', () => {
    const out = updateEnvFile(existing, { JWT_SECRET: 'newSecret9' }, 'generated');
    expect(out).toBe('# generated by supastack\nA=1\nJWT_SECRET=newSecret9\nB=keep me\n');
  });

  test('appends a variable the file does not have, keeping the trailing newline', () => {
    const out = updateEnvFile(existing, { ANON_KEY: 'eyJ.a.b' }, 'generated');
    expect(out).toBe(existing.replace(/\n$/, '\nANON_KEY=eyJ.a.b\n'));
    expect(parseEnvBack(out).map.ANON_KEY).toBe('eyJ.a.b');
  });

  test('is idempotent — applying the same update twice is a no-op', () => {
    const once = updateEnvFile(existing, { JWT_SECRET: 'newSecret9' }, 'generated');
    expect(updateEnvFile(once, { JWT_SECRET: 'newSecret9' }, 'generated')).toBe(once);
  });
});

describe('updateEnvFile — sad path', () => {
  const existing = 'A=1\nJWT_SECRET=old\n';

  test.each(FORBIDDEN)('rejects %s rather than corrupting the file', async (_label, payload) => {
    const err = await captureThrow(() =>
      updateEnvFile(existing, { JWT_SECRET: payload }, 'generated'),
    );
    assertNoSecretInMessage(err, payload, 'JWT_SECRET');
  });

  test('a line break can no longer smuggle a second assignment in', () => {
    expect(() =>
      updateEnvFile(existing, { JWT_SECRET: 'x\nCOMPOSE_FILE=attacker.yml' }, 'generated'),
    ).toThrow();
    // and the caller still holds the untouched original
    expect(existing).toBe('A=1\nJWT_SECRET=old\n');
  });

  test('refuses a file that already assigns the target variable twice', () => {
    expect(() => updateEnvFile('A=1\nA=2\n', { A: '3' }, 'operator')).toThrow(/more than once/);
  });

  test.each<EnvTrustClass>(['generated', 'operator'])(
    'the %s rule is applied — neither class is exempt',
    (trust) => {
      expect(() => updateEnvFile(existing, { A: 'has$dollar' }, trust)).toThrow(/A/);
    },
  );

  test('blames the pre-existing duplicate, not the caller value', () => {
    // A duplicate of a variable NOT being updated reaches the round-trip check.
    // Both the duplicate guard and the count check fire on this input; the
    // duplicate one must win, because "a value injected a line" would point at
    // B's value for a file that was already malformed before the call.
    const err = captureThrowSync(() => updateEnvFile('A=1\nA=2\nB=3\n', { B: '4' }, 'operator'));
    expect(err.message).toMatch(/A is assigned more than once/);
    expect(err.message).not.toMatch(/injected or swallowed/);
  });
});

describe('undeliverable-value diagnostics name the cause and never the value', () => {
  // The character rule deliberately does not enumerate these; they are caught
  // structurally. That makes this message the only guidance an operator gets
  // until entry-point validation (FR-005 / T017) lands, so it has to say what
  // to change rather than that a round-trip failed.
  test("' #' is reported as an inline comment, with the remedy", () => {
    const err = captureThrowSync(() =>
      renderEnvFile({ generated: {}, operator: { NAME: 'release # 2' } }),
    );
    expect(err.message).toMatch(/NAME/);
    expect(err.message).toMatch(/inline comment/);
    expect(err.message).toMatch(/Remove the space before the #/);
  });

  test('trailing whitespace is reported as stripping, not as a comment', () => {
    const err = captureThrowSync(() =>
      renderEnvFile({ generated: {}, operator: { NAME: 'My Project ' } }),
    );
    expect(err.message).toMatch(/NAME/);
    expect(err.message).toMatch(/leading or trailing whitespace/);
    expect(err.message).not.toMatch(/inline comment/);
  });

  test('the diagnostic never echoes the value, even when it is a secret', () => {
    const secretish = 'sbp_deadbeef # never-print-me';
    const err = captureThrowSync(() =>
      renderEnvFile({ generated: {}, operator: { SMTP_PASS: secretish } }),
    );
    assertNoSecretInMessage(err, secretish, 'SMTP_PASS');
  });

  test('a value that needs no diagnosis still renders', () => {
    expect(() =>
      renderEnvFile({ generated: {}, operator: { NAME: 'My Project', OTHER: 'a#b' } }),
    ).not.toThrow();
  });
});

/** Synchronous sibling of `captureThrow` — returns the Error rather than rethrowing. */
function captureThrowSync(fn: () => unknown): Error {
  try {
    fn();
  } catch (err) {
    return err as Error;
  }
  throw new Error('expected the call to throw, but it returned');
}
