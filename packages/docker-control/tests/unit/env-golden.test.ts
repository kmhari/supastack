/**
 * SC-003 / C6 — byte-identity of the rendered per-instance `.env`.
 *
 * The goldens in `../fixtures/env-golden/` were captured from the renderer as
 * it stood before feature 121 touched it. Feature 121 adds validation; it must
 * not change one byte of output for well-formed input. A diff here means the
 * "non-breaking, ships first" claim is false — investigate, do not regenerate.
 *
 * Regenerating is deliberately awkward: `UPDATE_ENV_GOLDEN=1 pnpm vitest run
 * packages/docker-control/tests/unit/env-golden.test.ts`, and only when the
 * vendored template itself legitimately changed.
 */
import { describe, expect, test } from 'vitest';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { renderInstanceEnv } from '../../src/compose-template.js';
import { GOLDEN_CASES, GOLDEN_DIR } from '../fixtures/env-golden/corpus.js';

const UPDATE = process.env.UPDATE_ENV_GOLDEN === '1';

describe('renderInstanceEnv — byte-identity corpus (SC-003)', () => {
  for (const { id, why, inputs } of GOLDEN_CASES) {
    test(`${id}: ${why}`, async () => {
      const rendered = await renderInstanceEnv(inputs);
      const goldenPath = path.join(GOLDEN_DIR, `${id}.env`);

      if (UPDATE) {
        await writeFile(goldenPath, rendered, 'utf8');
        return;
      }

      const golden = await readFile(goldenPath, 'utf8');
      expect(rendered).toBe(golden);
    });
  }

  test('every golden is a sorted, single-assignment-per-line file', async () => {
    for (const { id } of GOLDEN_CASES) {
      const golden = await readFile(path.join(GOLDEN_DIR, `${id}.env`), 'utf8');
      expect(golden.endsWith('\n')).toBe(true);
      const lines = golden.split('\n').slice(0, -1);
      const keys = lines.map((l) => {
        const eq = l.indexOf('=');
        expect(eq, `line without an assignment in ${id}.env`).toBeGreaterThan(0);
        return l.slice(0, eq);
      });
      expect(keys, `${id}.env is not sorted`).toEqual([...keys].sort());
      expect(new Set(keys).size, `${id}.env has a duplicate key`).toBe(keys.length);
    }
  });
});
