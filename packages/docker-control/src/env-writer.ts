/**
 * The single writer for every per-instance Compose environment file
 * (feature 121, FR-013 / contracts/env-writer-contract.md C1–C5, C7).
 *
 * Before this module there were three writers with three different escaping
 * behaviours — bare concatenation at provision time, quote-on-whitespace at
 * runtime-config time, and regex line patching on key adoption. The safety rule
 * existed and was correct; it was applied by none of them consistently. Every
 * path now goes through `renderEnvFile` or `updateEnvFile`, and neither takes a
 * "skip validation" parameter. A caller that wants an exemption has to delete
 * code, not pass a flag.
 *
 * Two guarantees, not one:
 *
 *  1. **Character rule** — no value may carry a character Compose reads as
 *     structure (`@supastack/crypto`'s `findEnvViolation`).
 *  2. **Structural parse-back** — the writer parses its own output with
 *     Compose's dotenv semantics and refuses to return content that would not
 *     be delivered exactly as supplied. This is what catches the classes the
 *     character rule deliberately does not enumerate: a value whose trailing
 *     space would be stripped, or whose ` #` would truncate it into a comment.
 *     If a value ever injected a line, parse-back yields more pairs than were
 *     written and the render fails.
 *
 * Nothing here touches the filesystem. Rejection therefore cannot leave a
 * partial file behind (FR-003 / C4) — the caller never receives content to
 * write.
 */
import { assertSafeForEnv, assertSafeForEnvValue } from '@supastack/crypto';

/**
 * Which rule a value is held to.
 *
 * - `generated` — server CSPRNG / HKDF output. No whitespace at all.
 * - `operator`  — everything a human can influence, plus the platform-derived
 *   constants that turn out to derive from a human-supplied value (that is how
 *   `SMTP_SENDER_NAME` became unsafe). Identical rule minus the space.
 *
 * There is no third option, and in particular no `trusted`. Writer 3's values
 * are server-generated and would have qualified — and would have reintroduced
 * exactly the drift this module exists to prevent.
 */
export type EnvTrustClass = 'generated' | 'operator';

export interface EnvFileSpec {
  /** Values the server minted. Held to the strict no-whitespace rule. */
  generated: Record<string, string | number>;
  /** Everything else. Held to the same rule with the literal space permitted. */
  operator: Record<string, string | number>;
}

export interface EnvEntry {
  name: string;
  value: string;
}

/** Variable names we are willing to emit. Compose accepts more; we do not. */
const ENV_KEY_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;

function assertValue(name: string, value: string, trust: EnvTrustClass): void {
  if (!ENV_KEY_RE.test(name)) {
    throw new Error(
      `env-writer: refusing to emit variable with unsafe name ${JSON.stringify(name)}`,
    );
  }
  if (trust === 'generated') assertSafeForEnv(value, name);
  else assertSafeForEnvValue(value, name);
}

/**
 * Parse env-file content the way Compose does, so the result is what the
 * container would actually receive — not what the file looks like.
 *
 * Established empirically against Compose v5.0.2 (specs/121 research.md Q5):
 * surrounding whitespace is stripped, ` #` begins an inline comment, `a#b` is
 * literal. Only unquoted values are modelled, because this writer never quotes:
 * quoting is what let `$` through in the writer this one replaces.
 *
 * Returns entries rather than a map so a duplicate key — the signature of an
 * injected line — is visible to the caller.
 */
export function parseEnvFile(content: string): EnvEntry[] {
  const entries: EnvEntry[] = [];
  for (const line of content.split('\n')) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    entries.push({ name: line.slice(0, eq).trim(), value: parseEnvValue(line.slice(eq + 1)) });
  }
  return entries;
}

/** Apply Compose's unquoted-value semantics: inline comment, then trim. */
function parseEnvValue(raw: string): string {
  const comment = raw.search(/\s#/);
  return (comment >= 0 ? raw.slice(0, comment) : raw).trim();
}

/** `parseEnvFile` collapsed to a map. Last assignment wins, as Compose does. */
export function parseEnvMap(content: string): Record<string, string> {
  const map: Record<string, string> = {};
  for (const { name, value } of parseEnvFile(content)) map[name] = value;
  return map;
}

/**
 * Render a complete per-instance `.env`. Keys are sorted for deterministic
 * diffs — byte-identical to the emitter this replaces (SC-003).
 *
 * Throws, without producing content, if any value fails the character rule or
 * would not survive parse-back.
 */
export function renderEnvFile(spec: EnvFileSpec): string {
  const merged = new Map<string, string>();

  for (const [trust, group] of [
    ['generated', spec.generated],
    ['operator', spec.operator],
  ] as const) {
    for (const [name, raw] of Object.entries(group)) {
      const value = String(raw);
      assertValue(name, value, trust);
      if (merged.has(name)) {
        throw new Error(`env-writer: ${name} supplied twice — one variable, one value`);
      }
      merged.set(name, value);
    }
  }

  const names = [...merged.keys()].sort();
  const content = names.map((n) => `${n}=${merged.get(n)}`).join('\n') + '\n';
  assertRoundTrips(content, merged);
  return content;
}

/**
 * Render the per-instance OPERATOR env file (feature 124) — the tenant/operator
 * config delivered to `auth`/`rest` via `env_file: format: raw`.
 *
 * Raw delivery is fundamentally different from the `.env` above, verified in a
 * container on Compose v5.0.0: raw does NOT interpolate `${...}`, does NOT treat
 * ` #` as a comment, does NOT strip quotes, does NOT trim whitespace. Every
 * character reaches the process verbatim. That is the whole point — it is how a
 * tenant's `${MASTER_KEY}`, `#fff`, quoted HTML, or `pa$$word` all arrive intact
 * and the master key never expands.
 *
 * So this writer does the OPPOSITE of `renderEnvFile`'s validation:
 *  - NO character rule. `$`, backtick, quote, `#`, space are all data here.
 *  - The ONLY corrupting character is a line break, which would split one
 *    assignment into two. That is rejected (a value cannot legitimately contain
 *    one; the multi-line template fields are separately non-functional).
 *  - Keys are still validated as safe env names.
 *  - An absent value (null / undefined / '') emits NO line — GoTrue distinguishes
 *    an absent var (nil → compiled default) from an empty one (feature 024).
 *
 * `fields` is keyed by the FINAL container env name (callers resolve short keys
 * via config-final-names first). Never echoes a value in an error (C5).
 */
export function renderOperatorEnv(fields: Record<string, string | number | null | undefined>): string {
  const merged = new Map<string, string>();
  for (const [name, raw] of Object.entries(fields)) {
    if (raw === null || raw === undefined || raw === '') continue; // absent ≠ empty
    if (!ENV_KEY_RE.test(name)) {
      throw new Error(
        `env-writer: refusing to emit operator variable with unsafe name ${JSON.stringify(name)}`,
      );
    }
    const value = String(raw);
    if (/[\n\r]/.test(value)) {
      throw new Error(
        `env-writer: ${name} contains a line break — a raw env-file value is one line; ` +
          'refusing to split it into two assignments',
      );
    }
    merged.set(name, value);
  }

  const names = [...merged.keys()].sort();
  const content = names.map((n) => `${n}=${merged.get(n)}`).join('\n') + (names.length ? '\n' : '');
  assertRawRoundTrips(content, merged);
  return content;
}

/**
 * Raw round-trip: split on newline, each non-empty line is exactly one intended
 * `KEY=value` with the value byte-identical. Raw semantics, so NO comment strip
 * and NO trim — unlike `assertRoundTrips`, which models the interpolated `.env`.
 */
function assertRawRoundTrips(content: string, expected: Map<string, string>): void {
  const lines = content.split('\n').filter((l) => l !== '');
  if (lines.length !== expected.size) {
    throw new Error(
      `env-writer: emitted ${lines.length} line(s) for ${expected.size} operator variable(s) — a value split a line`,
    );
  }
  for (const line of lines) {
    const eq = line.indexOf('=');
    const name = eq >= 0 ? line.slice(0, eq) : line;
    const value = eq >= 0 ? line.slice(eq + 1) : '';
    if (!expected.has(name)) {
      throw new Error(`env-writer: emitted an unintended operator variable ${name}`);
    }
    if (expected.get(name) !== value) {
      throw new Error(`env-writer: ${name} would not reach the container as supplied`);
    }
  }
}

/**
 * Replace the value of existing variables in an env file, preserving every
 * other line byte-for-byte (comments, ordering, spacing included).
 *
 * Replaces the regex line patching on the key-adoption path. The difference
 * that matters is not the mechanism but the two checks around it: values are
 * held to the rule before anything is rewritten, and the result is parsed back
 * and compared against the intended map before it is returned. A value that
 * carried a line break used to silently corrupt the file into two assignments;
 * now it cannot be written at all.
 *
 * A key absent from `existing` is appended. A key present twice is refused —
 * patching the first occurrence would leave a stale second one live.
 */
export function updateEnvFile(
  existing: string,
  updates: Record<string, string | number>,
  trust: EnvTrustClass,
): string {
  const wanted = new Map<string, string>();
  for (const [name, raw] of Object.entries(updates)) {
    const value = String(raw);
    assertValue(name, value, trust);
    wanted.set(name, value);
  }

  const before = parseEnvFile(existing);
  for (const name of wanted.keys()) {
    if (before.filter((e) => e.name === name).length > 1) {
      throw new Error(`env-writer: ${name} is assigned more than once in the existing file`);
    }
  }

  const replaced = new Set<string>();
  const lines = existing.split('\n').map((line) => {
    const eq = line.indexOf('=');
    if (eq < 1 || line.trim().startsWith('#')) return line;
    const name = line.slice(0, eq).trim();
    if (!wanted.has(name) || replaced.has(name)) return line;
    replaced.add(name);
    return `${name}=${wanted.get(name)}`;
  });

  const appended = [...wanted.keys()].filter((n) => !replaced.has(n)).sort();
  if (appended.length > 0) {
    const trailing = lines.length > 0 && lines[lines.length - 1] === '' ? lines.pop() : undefined;
    lines.push(...appended.map((n) => `${n}=${wanted.get(n)}`));
    if (trailing !== undefined) lines.push(trailing);
  }

  const content = lines.join('\n');
  const expected = new Map<string, string>();
  for (const { name, value } of before) expected.set(name, value);
  for (const [name, value] of wanted) expected.set(name, value);
  assertRoundTrips(content, expected);
  return content;
}

/**
 * C2 / C3 — the emitted content must parse back to exactly `expected`: same
 * count, same names, same values. Messages name the variable and never the
 * value (C5).
 */
function assertRoundTrips(content: string, expected: Map<string, string>): void {
  const entries = parseEnvFile(content);

  // Duplicate detection runs BEFORE the count check on purpose. Both fire on a
  // file that assigns one name twice, but only this one names the variable.
  // `updateEnvFile` refuses a duplicate of a key it is updating; a duplicate of
  // an unrelated key reaches here, and reporting that as "a value injected a
  // line" would blame the caller's value for a file that was already malformed.
  const seen = new Set<string>();
  for (const { name } of entries) {
    if (seen.has(name)) {
      throw new Error(
        `env-writer: ${name} is assigned more than once — refusing to write a file ` +
          'whose later assignment would silently override the earlier one',
      );
    }
    seen.add(name);
  }

  if (entries.length !== expected.size) {
    throw new Error(
      `env-writer: emitted ${entries.length} assignment(s) for ${expected.size} variable(s) — ` +
        'a value injected or swallowed a line',
    );
  }

  for (const { name, value } of entries) {
    if (!expected.has(name)) {
      throw new Error(`env-writer: emitted an unintended variable ${name}`);
    }
    const intended = expected.get(name);
    if (intended !== value) {
      throw new Error(
        `env-writer: ${name} would not reach the container as supplied — ${explainUndeliverable(intended ?? '')}`,
      );
    }
  }
}

/**
 * Say *why* a value would not survive Compose's parse, in terms of what to
 * change. The character rule deliberately does not enumerate these — they are
 * caught structurally — so this message is the only guidance an operator gets,
 * and "it would not round-trip" is not guidance.
 *
 * Ideally this never reaches an operator at all: rejecting at the request
 * boundary gives a field-level error long before a render is attempted. That is
 * feature 121's FR-005, deferred with T017 pending the Supabase-compatibility
 * decision recorded in plan.md. Until it lands, this is the whole diagnostic.
 *
 * Never includes the value — it may be a secret (FR-004 / C5).
 */
function explainUndeliverable(intended: string): string {
  if (/\s#/.test(intended)) {
    return "it contains a space followed by '#', which Compose reads as the start of an " +
      'inline comment and discards from there on. Remove the space before the #, or the # itself.';
  }
  if (intended !== intended.trim()) {
    return 'it has leading or trailing whitespace, which Compose strips. Remove it.';
  }
  return "Compose's parse would alter it.";
}
