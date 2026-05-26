/**
 * Multi-statement SQL detector — feature 013 db query (research.md Decision 3).
 *
 * `pg`'s `client.query(sql)` silently runs ALL statements when the SQL string
 * contains multiple semicolon-separated statements, returning only the LAST
 * result. The `db query` endpoint MUST reject multi-statement inputs upfront
 * (clarification Q1) so operators get a predictable 400 instead of lossy
 * "first wins / last wins" surprises.
 *
 * Pure function; state machine over the input string. Aware of:
 *   - single-quoted string literals  ('foo''bar' escapes)
 *   - double-quoted identifiers      ("col""name" escapes)
 *   - line comments                  -- to end of line
 *   - block comments                 /* … *\/  (nestable per PG)
 *   - dollar-quoted strings          $tag$ … $tag$
 *
 * Returns true if a `;` appears OUTSIDE of any of the above AND non-whitespace
 * content follows it. Trailing `;` (one or many) is allowed.
 */
export function detectMultiStatement(sql: string): boolean {
  let i = 0;
  const n = sql.length;

  type State =
    | { kind: 'normal' }
    | { kind: 'single' } // inside '…'
    | { kind: 'double' } // inside "…"
    | { kind: 'line-comment' } // inside -- …
    | { kind: 'block-comment'; depth: number } // /* … */ (nestable)
    | { kind: 'dollar'; tag: string }; // $tag$ … $tag$

  let state: State = { kind: 'normal' };
  // Indices of `;` seen at top level. We treat a query as multi-statement if
  // any of these has non-whitespace content after it.
  const topLevelSemicolons: number[] = [];

  while (i < n) {
    const ch = sql[i]!;
    const next = i + 1 < n ? sql[i + 1] : '';

    switch (state.kind) {
      case 'normal': {
        if (ch === "'") {
          state = { kind: 'single' };
          i++;
          break;
        }
        if (ch === '"') {
          state = { kind: 'double' };
          i++;
          break;
        }
        if (ch === '-' && next === '-') {
          state = { kind: 'line-comment' };
          i += 2;
          break;
        }
        if (ch === '/' && next === '*') {
          state = { kind: 'block-comment', depth: 1 };
          i += 2;
          break;
        }
        // Dollar-quoted string start: $tag$ where tag is [A-Za-z_][A-Za-z0-9_]*
        // (or empty for $$). We scan forward looking for the matching closing $.
        if (ch === '$') {
          const tag = readDollarTag(sql, i);
          if (tag !== null) {
            state = { kind: 'dollar', tag };
            i += tag.length + 2; // skip $tag$
            break;
          }
        }
        if (ch === ';') {
          topLevelSemicolons.push(i);
        }
        i++;
        break;
      }
      case 'single': {
        if (ch === "'" && next === "'") {
          i += 2;
          break;
        }
        if (ch === "'") {
          state = { kind: 'normal' };
        }
        i++;
        break;
      }
      case 'double': {
        if (ch === '"' && next === '"') {
          i += 2;
          break;
        }
        if (ch === '"') {
          state = { kind: 'normal' };
        }
        i++;
        break;
      }
      case 'line-comment': {
        if (ch === '\n') {
          state = { kind: 'normal' };
        }
        i++;
        break;
      }
      case 'block-comment': {
        if (ch === '/' && next === '*') {
          state = { kind: 'block-comment', depth: state.depth + 1 };
          i += 2;
          break;
        }
        if (ch === '*' && next === '/') {
          const newDepth: number = state.depth - 1;
          if (newDepth === 0) {
            state = { kind: 'normal' };
          } else {
            state = { kind: 'block-comment', depth: newDepth };
          }
          i += 2;
          break;
        }
        i++;
        break;
      }
      case 'dollar': {
        // Look for the closing $tag$ matching the open tag.
        const closer = `$${state.tag}$`;
        if (sql.startsWith(closer, i)) {
          state = { kind: 'normal' };
          i += closer.length;
          break;
        }
        i++;
        break;
      }
    }
  }

  // No top-level semicolons → single statement.
  if (topLevelSemicolons.length === 0) return false;

  // Multi-statement iff anything after some `;` is non-whitespace.
  for (const semi of topLevelSemicolons) {
    for (let j = semi + 1; j < n; j++) {
      const c = sql[j]!;
      if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ';') continue;
      return true;
    }
  }
  return false;
}

/**
 * If `sql[start]` is the start of a dollar-quote opener `$tag$`, return the
 * tag (which may be empty for `$$`). Otherwise return null.
 *
 * Per PG docs, tag is an optional identifier matching [A-Za-z_][A-Za-z0-9_]*.
 */
function readDollarTag(sql: string, start: number): string | null {
  // We're at a `$`. Scan forward for the closing `$` of the tag.
  let j = start + 1;
  const n = sql.length;
  // Tag must start with letter/underscore (or be empty)
  while (j < n) {
    const c = sql[j]!;
    if (c === '$') {
      return sql.slice(start + 1, j);
    }
    // Tag chars: alnum + underscore (no digits at start, but allowed later)
    if (!/[A-Za-z0-9_]/.test(c)) return null;
    j++;
  }
  return null;
}
