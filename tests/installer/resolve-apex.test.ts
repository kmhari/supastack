import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Feature 117 (US2) — install.sh domain capture must resolve in a fixed priority
 * and prompt even under `curl … | bash`. We test the real shipped `resolve_apex`
 * function (extracted from install.sh) for ordering, and assert the source wires
 * the prompt to /dev/tty (not stdin) so the piped install never silently
 * defaults to localhost.
 */
const here = dirname(fileURLToPath(import.meta.url));
const INSTALL = join(here, '../../install.sh'); // tests/installer → repo root

function resolveApex(arg: string, env: string, dotenv: string, tty: string): string {
  const script = `eval "$(sed -n '/^resolve_apex() {/,/^}/p' "${INSTALL}")"; resolve_apex "$1" "$2" "$3" "$4"`;
  return execFileSync('bash', ['-c', script, '_', arg, env, dotenv, tty], { encoding: 'utf8' }).trim();
}

describe('resolve_apex — priority order', () => {
  it('positional arg wins over env/.env/prompt', () => {
    expect(resolveApex('arg.dev', 'env.dev', 'dot.dev', 'tty.dev')).toBe('arg.dev');
  });
  it('env wins when no arg', () => {
    expect(resolveApex('', 'env.dev', 'dot.dev', 'tty.dev')).toBe('env.dev');
  });
  it('.env wins when no arg/env', () => {
    expect(resolveApex('', '', 'dot.dev', 'tty.dev')).toBe('dot.dev');
  });
  it('prompt (tty) wins when no arg/env/.env', () => {
    expect(resolveApex('', '', '', 'tty.dev')).toBe('tty.dev');
  });
  it('localhost only when everything is empty', () => {
    expect(resolveApex('', '', '', '')).toBe('localhost');
  });
});

describe('install.sh — prompt wiring (curl|bash must still prompt)', () => {
  const src = readFileSync(INSTALL, 'utf8');
  it('reads the apex prompt from /dev/tty, not stdin', () => {
    expect(src).toMatch(/read -rp ".*Apex domain.*" TTY_APEX < \/dev\/tty/);
  });
  it('does NOT gate the apex prompt on `[[ -t 0 ]]` (the old silent-localhost bug)', () => {
    // The prompt guard must key off /dev/tty readability, not stdin being a TTY.
    expect(src).toMatch(/-r \/dev\/tty/);
    expect(src).not.toMatch(/\[\[ -t 0 \]\][\s\S]{0,80}Apex domain/);
  });
  it('accepts a positional apex argument', () => {
    expect(src).toMatch(/ARG_APEX="\$\{1:-\}"/);
  });
});
