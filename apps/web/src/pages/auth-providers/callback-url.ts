/**
 * Build the OAuth callback URL for a given project. Pre-filled into every
 * provider drawer's read-only Callback URL field. Operators paste this into
 * the IdP console (Google Cloud Console, GitHub OAuth App settings, etc.).
 *
 * Spec: specs/020-auth-providers-dashboard/spec.md FR-015
 * Contract: specs/020-auth-providers-dashboard/contracts/provider-form-templates.md
 * Research: specs/020-auth-providers-dashboard/research.md R-004 (canonical for all providers)
 */
export function buildCallbackUrl(ref: string, apex: string | null | undefined): string {
  if (!apex) {
    // Setup not yet complete — apex unknown. Show a clearly-templated string
    // rather than a broken URL so the operator knows to finish setup.
    return `https://${ref}.<your-apex-domain>/auth/v1/callback`;
  }
  return `https://${ref}.${apex}/auth/v1/callback`;
}
