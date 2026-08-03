import { describe, expect, test } from 'vitest';
import { isFirstPartyOnlySurface } from '../../src/plugins/surface.js';

/**
 * Feature 122 US1 (SEC-042) — the audience boundary. Every PAT-minting endpoint
 * lives on a first-party-only surface; the MCP-forwarded `/v1/*` Management API
 * is the one third-party-allowed surface. Risk 1 mitigation: if a future mint
 * route ever lands under `/v1/*`, this table fails and flags the regression.
 */
describe('isFirstPartyOnlySurface', () => {
  // Real PAT-mint / credential-issuing sites — all must be first-party-only.
  const FIRST_PARTY_ONLY = [
    '/platform/profile/access-tokens',
    '/platform/profile/scoped-access-tokens',
    '/platform/projects/abcdefghijklmnop/api-keys/temporary',
    '/api/v1/auth/me',
    '/api/v1/admin/credentials',
    '/platform/organizations/acme/members/uuid',
    '/', // health
    '/v1x/not-really-v1', // adjacent prefix must NOT be treated as /v1
    '/api/v1', // exact /api/v1 is first-party, not the Management surface
  ];

  // Third-party-allowed Management API surface (MCP forwards raw OAuth here).
  const THIRD_PARTY_ALLOWED = [
    '/v1',
    '/v1/projects',
    '/v1/projects/abcdefghijklmnop/api-keys',
    '/v1/organizations',
  ];

  test.each(FIRST_PARTY_ONLY)('%s → first-party-only (refuses OAuth)', (path) => {
    expect(isFirstPartyOnlySurface(path)).toBe(true);
  });

  test.each(THIRD_PARTY_ALLOWED)('%s → third-party-allowed (accepts OAuth)', (path) => {
    expect(isFirstPartyOnlySurface(path)).toBe(false);
  });
});
