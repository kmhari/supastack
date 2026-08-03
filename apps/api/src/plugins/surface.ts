/**
 * Feature 122 US1 (SEC-042) — the audience boundary is a *surface* boundary.
 *
 * An OAuth access token carries an `azp` claim identifying the third-party
 * application it was issued to. The MCP server forwards the caller's raw OAuth
 * JWT straight to the Management API (`apps/mcp/src/server.ts` →
 * `createSupabaseApiPlatform` hitting `/v1/*`), so `azp`-bearing credentials are
 * *legitimate* on `/v1/*` and must keep working there (Principle IV).
 *
 * They are NOT legitimate on the api's own first-party surfaces (`/api/v1/*`,
 * `/platform/*`) — a browser session on those carries a GoTrue JWT, not an OAuth
 * token — and every PAT-minting endpoint lives on exactly those two surfaces.
 * Refusing OAuth credentials there breaks the credential-escalation chain at its
 * first link while breaking no working integration (research.md Part E).
 *
 * This is a pure function so it is unit-testable with no Fastify instance, and
 * so the security boundary is one enumerable rule rather than a per-route check.
 */

/**
 * True when `path` belongs to a first-party-only surface — one that must refuse
 * a credential issued to a third-party application.
 *
 * `/v1/*` (and exactly `/v1`) is the third-party-allowed Management API surface.
 * Everything else — `/api/v1/*`, `/platform/*`, health, etc. — is first-party.
 *
 * `path` must be the pathname only (no query string). Callers strip it.
 */
export function isFirstPartyOnlySurface(path: string): boolean {
  return !(path === '/v1' || path.startsWith('/v1/'));
}
