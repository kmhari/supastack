import { describe, expect, it } from 'vitest';
import { upsertEnvEntry, removeEnvEntry } from '../../src/services/secret-store.js';

/**
 * T003a (d): pure .env file editor.
 *
 * The secret-set flow needs to atomically rewrite the per-instance
 * /var/selfbase/instances/<ref>/.env file. This editor is the pure
 * string-in/string-out core of that operation — no I/O, no locking.
 *
 * Requirements (see secret-store.ts):
 *   - Replace an existing KEY=value line in place (preserving order).
 *   - Append a new KEY=value if absent.
 *   - Preserve comments, blank lines, and unrelated keys.
 *   - Quote values that contain whitespace, '#', or quotes so docker-compose
 *     env-file parsing doesn't truncate them.
 *   - removeEnvEntry deletes the KEY=... line entirely; preserves surrounding.
 */
describe('upsertEnvEntry', () => {
  it('appends a new key when absent', () => {
    const before = 'FOO=1\nBAR=2\n';
    const after = upsertEnvEntry(before, 'BAZ', 'three');
    expect(after).toBe('FOO=1\nBAR=2\nBAZ=three\n');
  });

  it('replaces an existing key in place, preserving order', () => {
    const before = 'FOO=old\nBAR=2\n';
    const after = upsertEnvEntry(before, 'FOO', 'new');
    expect(after).toBe('FOO=new\nBAR=2\n');
  });

  it('preserves comments and blank lines', () => {
    const before = '# comment\n\nFOO=1\n# another\nBAR=2\n';
    const after = upsertEnvEntry(before, 'BAR', '22');
    expect(after).toBe('# comment\n\nFOO=1\n# another\nBAR=22\n');
  });

  it('quotes values containing whitespace, hash, or quotes', () => {
    expect(upsertEnvEntry('', 'A', 'has space')).toBe('A="has space"\n');
    expect(upsertEnvEntry('', 'A', 'has#hash')).toBe('A="has#hash"\n');
    expect(upsertEnvEntry('', 'A', 'has"quote')).toBe('A="has\\"quote"\n');
  });

  it('does not quote simple values', () => {
    expect(upsertEnvEntry('', 'A', 'simple')).toBe('A=simple\n');
    expect(upsertEnvEntry('', 'A', 'sk_test_abc123')).toBe('A=sk_test_abc123\n');
  });

  it('handles empty starting content', () => {
    expect(upsertEnvEntry('', 'FOO', '1')).toBe('FOO=1\n');
  });
});

describe('removeEnvEntry', () => {
  it('removes the line for an existing key', () => {
    const before = 'FOO=1\nBAR=2\nBAZ=3\n';
    expect(removeEnvEntry(before, 'BAR')).toBe('FOO=1\nBAZ=3\n');
  });

  it('is a no-op for an absent key', () => {
    const before = 'FOO=1\n';
    expect(removeEnvEntry(before, 'BAR')).toBe('FOO=1\n');
  });

  it('preserves comments and blank lines around the removed entry', () => {
    const before = '# top\nFOO=1\n# mid\nBAR=2\nBAZ=3\n';
    expect(removeEnvEntry(before, 'BAR')).toBe('# top\nFOO=1\n# mid\nBAZ=3\n');
  });
});
