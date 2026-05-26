/**
 * Bearer-auth helper for the MCP HTTP transport.
 *
 * Verifies JWT signature + claims via @selfbase/oauth, then checks Redis
 * revocation. On any failure, throws an `AuthError` that the HTTP layer
 * translates into 401 + RFC 6750 `WWW-Authenticate` header.
 *
 * Spec: 014-mcp-http-oauth — FR-014.
 */
import {
  verifyAccessToken,
  isRevoked,
  type OAuthAccessTokenClaims,
  ExpiredTokenError,
  InvalidSignatureError,
  InvalidIssuerError,
  InvalidAudienceError,
  MalformedTokenError,
} from '@selfbase/oauth';
import type { MinimalRedisClient } from '@selfbase/oauth';

export class AuthError extends Error {
  constructor(
    public readonly status: number,
    public readonly errorCode: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ResolveBearerArgs {
  authHeader: string | undefined;
  masterKey: Buffer;
  expectedIss: string;
  expectedAud: string;
  redis: MinimalRedisClient;
}

export async function resolveBearer(args: ResolveBearerArgs): Promise<OAuthAccessTokenClaims> {
  if (!args.authHeader || !args.authHeader.startsWith('Bearer ')) {
    throw new AuthError(401, 'unauthenticated', 'Bearer token required');
  }
  const token = args.authHeader.slice('Bearer '.length).trim();
  let claims: OAuthAccessTokenClaims;
  try {
    claims = verifyAccessToken({
      masterKey: args.masterKey,
      token,
      expectedIss: args.expectedIss,
      expectedAud: args.expectedAud,
    });
  } catch (err) {
    if (
      err instanceof ExpiredTokenError ||
      err instanceof InvalidSignatureError ||
      err instanceof InvalidIssuerError ||
      err instanceof InvalidAudienceError ||
      err instanceof MalformedTokenError
    ) {
      throw new AuthError(401, 'invalid_token', err.message);
    }
    throw err;
  }
  if (await isRevoked(args.redis, claims.jti)) {
    throw new AuthError(401, 'invalid_token', 'token revoked');
  }
  return claims;
}

/** RFC 6750 — Bearer WWW-Authenticate header for 401 responses. */
export function wwwAuthenticateHeader(apex: string, errorCode: string): string {
  return `Bearer realm="selfbase", resource="https://mcp.${apex}/mcp", authorization_uri="https://api.${apex}/.well-known/oauth-authorization-server", error="${errorCode}"`;
}
