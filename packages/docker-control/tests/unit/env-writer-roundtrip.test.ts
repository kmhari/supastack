/**
 * C3 — `parseEnvBack(renderEnvFile(map))` deep-equals `map`, for randomly
 * generated valid input.
 *
 * The value of a property test here is that it does not require anyone to have
 * thought of the attack string. FR-006 is a structural invariant: if a value
 * ever injects a line, the parsed entry COUNT diverges from the written one,
 * whatever the payload was. The count assertion below is the load-bearing part
 * — a deep-equal on the map alone would pass while an extra `COMPOSE_FILE=`
 * line sat in the file.
 *
 * Seeded, so a failure is reproducible rather than a story about CI.
 */
import { describe, expect, test } from 'vitest';
import { renderEnvFile } from '../../src/env-writer.js';
import { parseEnvBack } from '../helpers/env-assert.js';

/** xorshift32 — deterministic, dependency-free. */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    return (s >>> 0) / 0x100000000;
  };
}

const NAME_HEAD = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ_';
const NAME_TAIL = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_';
// Every character an operator value may legitimately carry: alphanumerics,
// punctuation Compose does not read, unicode, and the space (research Q5).
const VALUE_CHARS = 'abcXYZ019-_.,:/@+=%()[]{}<>!?*&|~^;áÜø日本 #';

function pick(r: () => number, alphabet: string): string {
  return alphabet.charAt(Math.floor(r() * alphabet.length));
}

function randomName(r: () => number): string {
  let out = pick(r, NAME_HEAD);
  for (let i = 0; i < 1 + Math.floor(r() * 20); i++) out += pick(r, NAME_TAIL);
  return out;
}

/**
 * A value that is valid under BOTH the character rule and the parse-back
 * invariant: no forbidden character, no edge whitespace, no ` #`.
 */
function randomValue(r: () => number): string {
  const len = Math.floor(r() * 40);
  let out = '';
  for (let i = 0; i < len; i++) out += pick(r, VALUE_CHARS);
  out = out.replace(/\s#/g, 'x#').trim();
  return out;
}

describe('renderEnvFile — round-trip property (C3)', () => {
  test('500 random valid maps survive render → parse unchanged', () => {
    const r = rng(0x12151121);
    for (let iteration = 0; iteration < 500; iteration++) {
      const generated: Record<string, string> = {};
      const operator: Record<string, string> = {};
      const expected: Record<string, string> = {};

      for (let i = 0; i < 1 + Math.floor(r() * 25); i++) {
        const name = randomName(r);
        if (name in expected) continue;
        if (r() < 0.3) {
          // generated values are held to the no-whitespace rule
          const value = randomValue(r).replace(/\s/g, 'q');
          generated[name] = value;
          expected[name] = value;
        } else {
          const value = randomValue(r);
          operator[name] = value;
          expected[name] = value;
        }
      }

      const content = renderEnvFile({ generated, operator });
      const { entries, map } = parseEnvBack(content);

      expect(entries).toHaveLength(Object.keys(expected).length);
      expect(map).toEqual(expected);
    }
  });

  test('the property FAILS when a line is injected — the test can detect what it claims to', () => {
    const content = renderEnvFile({ generated: {}, operator: { A: '1', B: '2' } });
    const tampered = content.replace('A=1\n', 'A=1\nCOMPOSE_FILE=attacker.yml\n');
    const { entries, map } = parseEnvBack(tampered);
    expect(entries).toHaveLength(3);
    expect(map).not.toEqual({ A: '1', B: '2' });
  });
});
