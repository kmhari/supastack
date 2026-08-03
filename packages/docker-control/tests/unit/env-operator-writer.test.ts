/**
 * Feature 124 — the operator env writer (raw delivery).
 *
 * The happy-path assertions here encode BEHAVIOUR OBSERVED IN A CONTAINER on
 * Compose v5.0.0: with `env_file: format: raw`, `$`, `#`, quotes, `$$` and
 * trailing space all reach the process byte-for-byte. So values that the
 * interpolated `.env` writer rejects are *accepted* here — that inversion is the
 * feature. The one thing raw cannot survive is a line break.
 */
import { describe, expect, test } from 'vitest';
import { renderOperatorEnv } from '../../src/env-writer.js';
import { resolveFinalEnvName, HONORED_SHORT_TO_FINAL } from '../../src/config-final-names.js';

/** Parse a rendered operator file the way a raw env_file is read: verbatim. */
function readRaw(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split('\n')) {
    if (line === '') continue;
    const eq = line.indexOf('=');
    out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

describe('renderOperatorEnv — accepts what interpolation would mangle', () => {
  test('the SEC-065 payload is delivered as literal text, not expanded', () => {
    const out = readRaw(renderOperatorEnv({ GOTRUE_MAILER_SUBJECTS_CONFIRMATION: '${MASTER_KEY}' }));
    expect(out.GOTRUE_MAILER_SUBJECTS_CONFIRMATION).toBe('${MASTER_KEY}');
  });

  test.each([
    ['dollar in an SMTP password', 'GOTRUE_SMTP_PASS', 'pa$$w0rd'],
    ['single dollar', 'GOTRUE_SMTP_PASS', 'p$ss'],
    ['hash in a subject', 'GOTRUE_MAILER_SUBJECTS_CONFIRMATION', 'Sale #1 for you'],
    ['quotes and hash in HTML', 'GOTRUE_MAILER_SUBJECTS_INVITE', '<b style="color:#fff">Hi</b>'],
    ['apostrophe', 'GOTRUE_MAILER_SUBJECTS_RECOVERY', "your team's reset"],
    ['backtick', 'GOTRUE_EXTERNAL_GOOGLE_SECRET', 'a`b`c'],
    ['space and trailing space', 'GOTRUE_SITE_URL', 'My Project '],
  ])('%s is delivered byte-for-byte', (_label, key, value) => {
    const out = readRaw(renderOperatorEnv({ [key]: value }));
    expect(out[key]).toBe(value);
  });

  test('a line break is rejected — it would split one assignment into two', () => {
    expect(() =>
      renderOperatorEnv({ GOTRUE_SITE_URL: 'a\nGOTRUE_SMTP_PASS=stolen' }),
    ).toThrow(/line break/);
  });

  test('a carriage return is rejected too', () => {
    expect(() => renderOperatorEnv({ GOTRUE_SITE_URL: 'a\rb' })).toThrow(/line break/);
  });

  test('the rejection never echoes the value (may be a secret)', () => {
    let msg = '';
    try {
      renderOperatorEnv({ GOTRUE_SMTP_PASS: 'topsecret\ninjected' });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/GOTRUE_SMTP_PASS/);
    expect(msg).not.toContain('topsecret');
  });
});

describe('renderOperatorEnv — absent vs empty (feature 024 semantics)', () => {
  test.each([['null', null], ['undefined', undefined], ['empty string', '']] as const)(
    'a %s value emits NO line',
    (_label, value) => {
      const content = renderOperatorEnv({ GOTRUE_SITE_URL: value, GOTRUE_SMTP_HOST: 'mail' });
      expect(content).not.toMatch(/GOTRUE_SITE_URL/);
      expect(readRaw(content)).toEqual({ GOTRUE_SMTP_HOST: 'mail' });
    },
  );

  test('all-absent renders an empty file, not a lone newline', () => {
    expect(renderOperatorEnv({ GOTRUE_SITE_URL: '', GOTRUE_SMTP_HOST: null })).toBe('');
  });

  test('numeric values coerce to string', () => {
    expect(readRaw(renderOperatorEnv({ GOTRUE_SMTP_PORT: 587 }))).toEqual({ GOTRUE_SMTP_PORT: '587' });
  });
});

describe('renderOperatorEnv — structural integrity', () => {
  test('round-trips a realistic multi-field set', () => {
    const fields = {
      GOTRUE_SITE_URL: 'https://app.example.com',
      GOTRUE_SMTP_HOST: 'smtp.example.com',
      GOTRUE_SMTP_PASS: 'p@$$w0rd#1',
      GOTRUE_MAILER_SUBJECTS_CONFIRMATION: 'Confirm — ${not_expanded}',
    };
    expect(readRaw(renderOperatorEnv(fields))).toEqual(fields);
  });

  test('keys are sorted for deterministic diffs', () => {
    const content = renderOperatorEnv({ GOTRUE_Z: '1', GOTRUE_A: '2' });
    expect(content).toBe('GOTRUE_A=2\nGOTRUE_Z=1\n');
  });

  test('an unsafe key is refused', () => {
    expect(() => renderOperatorEnv({ 'BAD KEY': 'x' })).toThrow(/unsafe name/);
  });
});

describe('resolveFinalEnvName — the 16-entry short→final table', () => {
  test('already-final names pass through unchanged', () => {
    expect(resolveFinalEnvName('GOTRUE_MAILER_SUBJECTS_CONFIRMATION')).toBe(
      'GOTRUE_MAILER_SUBJECTS_CONFIRMATION',
    );
    expect(resolveFinalEnvName('PGRST_DB_SCHEMAS')).toBe('PGRST_DB_SCHEMAS');
  });

  test.each([
    ['SMTP_PASS', 'GOTRUE_SMTP_PASS'],
    ['SMTP_HOST', 'GOTRUE_SMTP_HOST'],
    ['SITE_URL', 'GOTRUE_SITE_URL'],
    ['ADDITIONAL_REDIRECT_URLS', 'GOTRUE_URI_ALLOW_LIST'],
    ['JWT_EXPIRY', 'GOTRUE_JWT_EXP'],
    ['ENABLE_EMAIL_SIGNUP', 'GOTRUE_EXTERNAL_EMAIL_ENABLED'],
  ])('short key %s resolves to %s', (short, final) => {
    expect(resolveFinalEnvName(short)).toBe(final);
  });

  test('the credential fields are all in the table (a miss silently breaks SMTP/OAuth)', () => {
    for (const k of ['SMTP_HOST', 'SMTP_USER', 'SMTP_PASS', 'SMTP_PORT', 'SMTP_ADMIN_EMAIL', 'SMTP_SENDER_NAME']) {
      expect(HONORED_SHORT_TO_FINAL[k], `${k} must map to a final GOTRUE_ name`).toMatch(/^GOTRUE_/);
    }
  });
});
