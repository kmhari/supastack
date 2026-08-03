/**
 * The safety rule (feature 121, FR-002). Two rules, one classifier.
 *
 * The whole feature rests on this predicate being right, so it is tested
 * directly rather than only through its callers — constitution Principle VI.
 */
import { describe, expect, test } from 'vitest';
import {
  assertSafeForEnv,
  assertSafeForEnvValue,
  findEnvViolation,
  type EnvViolationClass,
} from '../../src/passwords.js';

/** Every forbidden character, paired with the class it must be reported as. */
const FORBIDDEN: Array<[string, EnvViolationClass]> = [
  ['\n', 'line-break'],
  ['\r', 'line-break'],
  ['\r\n', 'line-break'],
  ['$', 'dollar'],
  ['`', 'backtick'],
  ['\\', 'backslash'],
  ["'", 'quote'],
  ['"', 'quote'],
  ['\t', 'whitespace'],
  ['\v', 'whitespace'],
  ['\f', 'whitespace'],
  [' ', 'whitespace'],
];

describe('findEnvViolation — happy path', () => {
  test('ordinary generated secrets are clean under both rules', () => {
    for (const good of ['Ax9_-', 'SafeAlphaNum123', 'a'.repeat(64), 'eyJhbGci.eyJyb2xl.sig']) {
      expect(findEnvViolation(good, false)).toBeNull();
      expect(findEnvViolation(good, true)).toBeNull();
    }
  });

  test('the empty string is clean — optional vars are emitted as KEY=', () => {
    expect(findEnvViolation('', false)).toBeNull();
    expect(findEnvViolation('', true)).toBeNull();
  });

  test('unicode is data, not structure', () => {
    expect(findEnvViolation('Ünïcode-Prøject-日本', false)).toBeNull();
    expect(findEnvViolation('Ünïcode Prøject 日本', true)).toBeNull();
  });

  test('a hash is permitted — only " #" starts a comment, and parse-back catches that', () => {
    expect(findEnvViolation('a#b', true)).toBeNull();
  });
});

describe('findEnvViolation — sad path', () => {
  test.each(FORBIDDEN)('rejects %j as %s under the strict rule', (ch, expected) => {
    expect(findEnvViolation(`before${ch}after`, false)).toBe(expected);
  });

  test.each(FORBIDDEN)('rejects %j as %s under the value rule too', (ch, expected) => {
    expect(findEnvViolation(`before${ch}after`, true)).toBe(expected);
  });

  test('reports the FIRST violation, so the message is deterministic', () => {
    expect(findEnvViolation('a$b`c', false)).toBe('dollar');
    expect(findEnvViolation('a`b$c', false)).toBe('backtick');
  });

  test('a value that is only whitespace is rejected by both rules', () => {
    expect(findEnvViolation('\t\t', false)).toBe('whitespace');
    expect(findEnvViolation('\t\t', true)).toBe('whitespace');
    expect(findEnvViolation('   ', false)).toBe('whitespace');
  });

  test('the COMPOSE_FILE redirect payload is caught at its line break', () => {
    expect(findEnvViolation('proj\nCOMPOSE_FILE=attacker.yml', true)).toBe('line-break');
  });

  test('the master-key expansion payload is caught at its $', () => {
    expect(findEnvViolation('https://evil.example/?k=${MASTER_KEY}', true)).toBe('dollar');
  });
});

describe('the space is the one difference between the two rules', () => {
  test('strict rule rejects a space — a generated password never contains one', () => {
    expect(findEnvViolation('with space', false)).toBe('whitespace');
    expect(() => assertSafeForEnv('with space', 'POSTGRES_PASSWORD')).toThrow(/POSTGRES_PASSWORD/);
  });

  test('value rule permits a space — "My Project" is an ordinary project name', () => {
    expect(findEnvViolation('My Project', true)).toBeNull();
    expect(() => assertSafeForEnvValue('My Project', 'name')).not.toThrow();
  });

  test('permitting the space does not permit any other whitespace', () => {
    expect(findEnvViolation('My\tProject', true)).toBe('whitespace');
    expect(findEnvViolation('My\nProject', true)).toBe('line-break');
  });
});

describe('rejection messages (FR-004 / C5)', () => {
  test('name the field and the character class', () => {
    expect(() => assertSafeForEnvValue('a\nb', 'SMTP_HOST')).toThrow(/SMTP_HOST/);
    expect(() => assertSafeForEnvValue('a\nb', 'SMTP_HOST')).toThrow(/line break/);
    expect(() => assertSafeForEnvValue('a$b', 'SMTP_HOST')).toThrow(/expand/);
  });

  test('never echo the offending value', () => {
    const secret = 'sup3rSecretPassw0rd$LEAK';
    try {
      assertSafeForEnvValue(secret, 'SMTP_PASS');
      throw new Error('expected assertSafeForEnvValue to throw');
    } catch (err) {
      const message = (err as Error).message;
      expect(message).toContain('SMTP_PASS');
      expect(message).not.toContain('sup3rSecretPassw0rd');
      expect(message).not.toContain(secret);
    }
  });
});
