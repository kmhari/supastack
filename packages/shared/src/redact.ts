/**
 * Mask secret-bearing substrings before they reach an operator's screen or a
 * stored snapshot. Used by the admin Queues view (failed-job reasons, FR-022)
 * and the worker observer's control-plane log tails (Constitution II). Feature 116.
 *
 * Best-effort: covers the high-frequency leak shapes (Postgres connection
 * strings, PATs, Bearer tokens, password=… pairs, legacy keys). Not a
 * cryptographic guarantee — the console is admin-only — but it stops the
 * common cases. Lives in @supastack/shared so the api AND the worker reuse it.
 */
const PATTERNS: RegExp[] = [
  /postgres(?:ql)?:\/\/\S+/gi, // connection strings (incl. embedded creds)
  /\bsbp_(?:oauth_)?[a-z0-9]+/gi, // supastack PATs
  /\bBearer\s+[A-Za-z0-9._\-]+/gi, // bearer tokens
  /\bpassword\s*=\s*\S+/gi, // password=… / password = …
  /\bsb_[a-z0-9]{16,}/gi, // legacy service/anon keys
];

const REDACTED = '[REDACTED]';

export function redactSensitive(text: string | null | undefined): string {
  if (!text) return text ?? '';
  let out = text;
  for (const re of PATTERNS) out = out.replace(re, REDACTED);
  return out;
}
