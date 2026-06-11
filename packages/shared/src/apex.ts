/**
 * Single source of truth for the installation apex domain (feature 117).
 *
 * The apex is set once at install time in `SUPASTACK_APEX` (the `.env` compose
 * reads) and read directly here — there is no DB copy (the installation column
 * was dropped in migration 0024). `getApex`/`getApexOrThrow` are
 * server-only (they read `process.env`); `isRealApex` is a pure predicate safe
 * to import anywhere (e.g. the web bundle) as long as it is fed an apex value
 * obtained elsewhere — never call `getApex()` in the browser.
 */

/** The configured apex, or null when unset/empty. */
export function getApex(): string | null {
  const v = process.env.SUPASTACK_APEX;
  return v && v.length > 0 ? v : null;
}

/** The configured apex; throws if unset (a boot-time defect on the control plane). */
export function getApexOrThrow(): string {
  const apex = getApex();
  if (!apex) throw new Error('SUPASTACK_APEX is not set');
  return apex;
}

/**
 * True iff `apex` is a real public domain — set, not `localhost`, and dotted.
 * Pure (no env/IO): safe to import in the web bundle. DNS-01 + a public
 * wildcard cert are meaningless for a non-real apex, so `/setup` blocks on it.
 */
export function isRealApex(apex: string | null | undefined): boolean {
  return typeof apex === 'string' && apex !== 'localhost' && apex.includes('.');
}
