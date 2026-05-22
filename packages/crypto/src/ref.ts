import { randomInt } from 'node:crypto';

/**
 * Lowercase LETTERS only — must match the upstream Supabase CLI's hard-coded
 * client-side regex `^[a-z]{20}$` (apps/cli-go/internal/utils/misc.go:70).
 * Including digits causes the CLI to reject the ref with "Invalid project
 * ref format. Must be like `abcdefghijklmnopqrst`." before any HTTP call.
 *
 * Older selfbase instances created with a digit-containing ref are
 * dashboard-functional but NOT CLI-compatible — they need to be recreated
 * to participate in CLI workflows.
 */
const LOWER_ALPHA = 'abcdefghijklmnopqrstuvwxyz';

/**
 * Generate a 20-character lowercase ref. Matches Supabase Cloud's project-ref
 * format (e.g., `apbkobhfnmcqqzqeeqss`) AND the upstream CLI's regex. Used
 * as the immutable primary key and the URL subdomain for each managed
 * instance.
 */
export function generateRef(length = 20): string {
  let out = '';
  for (let i = 0; i < length; i++) {
    out += LOWER_ALPHA.charAt(randomInt(0, LOWER_ALPHA.length));
  }
  return out;
}

// Accepts pre-CLI-compat refs (with digits) for backward compatibility with
// existing dashboard-only instances. The CLI itself enforces a stricter rule.
const REF_RE = /^[a-z0-9]{20}$/;
export function isValidRef(s: string): boolean {
  return REF_RE.test(s);
}
