import { randomInt } from 'node:crypto';

const LOWER_ALNUM = 'abcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Generate a 20-character lowercase alphanumeric ref. Matches Supabase Cloud's
 * project-ref format (e.g., `apbkobhfnmcqqzqeeqss`). Used as the immutable
 * primary key and the URL subdomain for each managed instance.
 */
export function generateRef(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += LOWER_ALNUM.charAt(randomInt(0, LOWER_ALNUM.length));
  }
  return out;
}

const REF_RE = /^[a-z0-9]{20}$/;
export function isValidRef(s: string): boolean {
  return REF_RE.test(s);
}
