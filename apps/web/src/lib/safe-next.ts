/**
 * Validate a `?next=…` parameter from the URL before using it as a redirect
 * target after login. Prevents open-redirect attacks where someone tricks an
 * operator into clicking `/login?next=https://evil.com` and gets bounced
 * off-site after auth.
 *
 * Rules:
 *   - MUST start with '/' (same-origin path)
 *   - MUST NOT start with '//' (protocol-relative)
 *   - MUST NOT contain '://' (absolute URL)
 *   - On any failure, fall back to '/dashboard'.
 *
 * Spec: specs/011-cli-device-login/research.md Decision 6.
 */
export function safeNext(raw: string | null | undefined): string {
  const fallback = '/dashboard';
  if (!raw) return fallback;
  let decoded: string;
  try {
    decoded = decodeURIComponent(raw);
  } catch {
    return fallback;
  }
  if (!decoded.startsWith('/')) return fallback;
  if (decoded.startsWith('//')) return fallback;
  if (decoded.includes('://')) return fallback;
  return decoded;
}
