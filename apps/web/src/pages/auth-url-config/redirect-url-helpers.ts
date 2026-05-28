/**
 * Pure helpers for the URL Configuration page's Redirect URL allow-list.
 *
 * Spec: specs/022-url-configuration/data-model.md "Validation rules"
 * Research: R1 (wildcard tolerance), R4 (WHATWG URL), R5 (CSV encoding)
 */

export const MAX_REDIRECT_URLS = 50;

/**
 * Lightweight URL-shape check. Accepts http:// or https:// followed by at
 * least one non-whitespace character. Tolerates glob wildcards (*, **, ?)
 * anywhere — including in the port or hostname — because WHATWG `URL`
 * rejects `http://localhost:*` (port must be numeric), and we want
 * operators to be able to paste the patterns GoTrue accepts.
 *
 * Rejects: empty, whitespace anywhere, non-http(s) schemes (javascript:,
 * data:, file:).
 */
export function looksLikeValidUrl(input: string): boolean {
  if (!input || /\s/.test(input)) return false;
  return /^https?:\/\/[^/\s][^\s]*$/.test(input);
}

/**
 * Split a URL into (scheme + authority) + (path + query + fragment).
 * Authority = `host[:port]`. Returns null on shape mismatch.
 */
function splitAuthority(input: string): { schemeAuth: string; rest: string } | null {
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/?#]+)(.*)$/.exec(input);
  if (!m || m[1] === undefined || m[2] === undefined) return null;
  return { schemeAuth: m[1] + m[2], rest: m[3] ?? '' };
}

/**
 * Lowercase scheme + authority; preserve path/query byte-for-byte. Used
 * for duplicate-detection only — entries are still stored verbatim.
 *
 * WHATWG-equivalent normalisation: a URL with no path component is treated
 * as having path `/`. `http://localhost:3000` and `http://localhost:3000/`
 * fold to the same dedup key. This matches GoTrue's runtime behaviour.
 */
export function dedupKey(input: string): string {
  const parts = splitAuthority(input);
  if (!parts) return input;
  const rest = parts.rest === '' ? '/' : parts.rest;
  return parts.schemeAuth.toLowerCase() + rest;
}

export function parseAllowList(csv: string | null | undefined): string[] {
  if (!csv) return [];
  return csv
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

export function serializeAllowList(urls: ReadonlyArray<string>): string {
  return urls.join(',');
}

export function isDuplicate(needle: string, haystack: ReadonlyArray<string>): boolean {
  const key = dedupKey(needle);
  return haystack.some((u) => dedupKey(u) === key);
}
