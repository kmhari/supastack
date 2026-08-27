/**
 * scripts/rekey-master.mjs must account for EVERY bytea column in the schema —
 * either it rotates the column (COLUMNS) or it declares the column is not
 * envelope ciphertext (NOT_ENCRYPTED). A third state does not exist.
 *
 * Why this runs in CI rather than at rotation time: the script's own sweep
 * already fails closed on an unclassified column, but that check only fires
 * during an actual master-key rotation — a rare, high-stakes operation usually
 * run under pressure. A column added today would sit unnoticed until then, and
 * the failure mode it guards against (a blob left under the old key) is
 * unrecoverable. This turns "the rotation aborts" into "the PR that adds the
 * column fails", which is the same guarantee several months earlier.
 *
 * Both sides are parsed as TEXT. rekey-master.mjs must not be imported: it has
 * a top-level `await client.connect()` (scripts/rekey-master.mjs:92) and no main
 * guard, so importing it opens a database connection and runs the rotation.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const REPO = resolve(__dirname, '../..');
const SCRIPT = join(REPO, 'scripts/rekey-master.mjs');
const SCHEMA_DIR = join(REPO, 'packages/db/src/schema');

const script = readFileSync(SCRIPT, 'utf8');

/** `table.column` for every bytea column declared in the Drizzle schema. */
function schemaByteaColumns(): string[] {
  const found: string[] = [];
  for (const file of readdirSync(SCHEMA_DIR).filter((f) => f.endsWith('.ts'))) {
    const src = readFileSync(join(SCHEMA_DIR, file), 'utf8');
    let table: string | null = null;
    for (const line of src.split('\n')) {
      // `export const x = pgTable('name', {` — and the multi-line form where the
      // name sits on the following line.
      const t = line.match(/pgTable\(\s*'([^']+)'/) ?? line.match(/^\s*'([a-z_]+)',\s*$/);
      if (t) {
        table = t[1]!;
        continue;
      }
      // Skip the `const bytea = customType...` declaration itself.
      const c = line.match(/^\s+\w+:\s*bytea\('([^']+)'\)/);
      if (c && table) found.push(`${table}.${c[1]}`);
    }
  }
  return found;
}

/** `table.column` for every entry in the script's COLUMNS array. */
function rotatedColumns(): string[] {
  const block = script.match(/const COLUMNS = \[([\s\S]*?)\n\];/);
  if (!block) throw new Error('COLUMNS array not found in rekey-master.mjs');
  return [...block[1]!.matchAll(/table:\s*'([^']+)'[^}]*col:\s*'([^']+)'/g)].map(
    (m) => `${m[1]}.${m[2]}`,
  );
}

/** `table.column` for every entry in the script's NOT_ENCRYPTED set. */
function excludedColumns(): string[] {
  const block = script.match(/const NOT_ENCRYPTED = new Set\(\[([\s\S]*?)\]\);/);
  if (!block) throw new Error('NOT_ENCRYPTED set not found in rekey-master.mjs');
  return [...block[1]!.matchAll(/'([^']+)'/g)].map((m) => m[1]!);
}

describe('rekey-master.mjs column coverage', () => {
  it('parses both sides — a silent parse failure would make every assertion vacuous', () => {
    // Without this, a refactor that renames COLUMNS turns the whole suite green
    // by finding nothing on either side.
    expect(schemaByteaColumns().length).toBeGreaterThan(5);
    expect(rotatedColumns().length).toBeGreaterThan(5);
    expect(excludedColumns().length).toBeGreaterThan(0);
  });

  it('happy: every bytea column in the schema is classified exactly once', () => {
    const rotated = rotatedColumns();
    const excluded = excludedColumns();
    const classified = new Set([...rotated, ...excluded]);

    const unclassified = schemaByteaColumns().filter((c) => !classified.has(c));
    expect(
      unclassified,
      `Unclassified bytea column(s). Add each to COLUMNS in scripts/rekey-master.mjs ` +
        `if it holds envelope ciphertext, or to NOT_ENCRYPTED if it does not. ` +
        `Leaving one out means a master-key rotation silently strands it under the old key.`,
    ).toEqual([]);

    // A column in both lists would be rotated AND declared non-ciphertext.
    const overlap = rotated.filter((c) => excluded.includes(c));
    expect(overlap, 'column is in both COLUMNS and NOT_ENCRYPTED').toEqual([]);
  });

  it('sad: neither list names a column the schema no longer has', () => {
    // The mirror of the check above. The script's runtime sweep cannot catch
    // this — a stale entry resolves to "column absent", which is precisely the
    // case the fail-closed path treats as a bug in the list.
    const schema = new Set(schemaByteaColumns());
    const stale = [...rotatedColumns(), ...excludedColumns()].filter((c) => !schema.has(c));
    expect(stale, 'listed in rekey-master.mjs but no longer in the schema').toEqual([]);
  });

  it('sad: the fail-closed path is still there', () => {
    // The whole guarantee rests on an unclassified column THROWING rather than
    // being skipped. Deleting that throw would leave every test above passing
    // while the tool silently resumed the old skip-on-miss behaviour.
    expect(script).toMatch(/if\s*\(!optional\)\s*\{\s*throw new Error\(/);
    expect(script).toContain('assertNoUnclassifiedBlobColumns');
  });

  it('sad: the two digest columns stay excluded, never rotated', () => {
    // Rekeying either would overwrite a SHA-256 digest with ciphertext and
    // permanently invalidate every PAT / open invitation. Verified against the
    // writers: api-tokens.ts:118 and org-membership.ts:14 both use
    // createHash('sha256'), with no encrypt() on either path.
    const excluded = excludedColumns();
    expect(excluded).toContain('api_tokens.token_sha256');
    expect(excluded).toContain('organization_invitations.token_sha256');
    expect(rotatedColumns()).not.toContain('api_tokens.token_sha256');
    expect(rotatedColumns()).not.toContain('organization_invitations.token_sha256');
  });
});
