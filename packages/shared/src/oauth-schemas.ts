/**
 * OAuth 2.1 wire-shape Zod schemas — feature 014.
 *
 * Pinned against:
 * - RFC 6749 (OAuth 2.0 core) + OAuth 2.1 hardening (PKCE mandatory, no plain)
 * - RFC 7591 (Dynamic Client Registration)
 * - RFC 7636 (PKCE)
 * - RFC 8414 (Authorization Server Metadata)
 * - RFC 9728 (Protected Resource Metadata)
 *
 * Spec: 014-mcp-http-oauth — contracts/oauth-*-endpoint.md.
 */
import { z } from 'zod';

// ─── /v1/oauth/authorize query params ──────────────────────────────────────

export const OAuthAuthorizeQuerySchema = z
  .object({
    response_type: z.literal('code'),
    client_id: z.string().uuid(),
    redirect_uri: z.string().url(),
    state: z.string().min(1),
    code_challenge: z.string().min(43).max(128),
    code_challenge_method: z.literal('S256'),
    scope: z.string().optional().default('platform'),
  })
  .strict();
export type OAuthAuthorizeQuery = z.infer<typeof OAuthAuthorizeQuerySchema>;

// ─── /v1/oauth/token request bodies (discriminated by grant_type) ──────────

export const OAuthTokenAuthCodeBodySchema = z
  .object({
    grant_type: z.literal('authorization_code'),
    code: z.string().min(1),
    redirect_uri: z.string().url(),
    client_id: z.string().uuid(),
    code_verifier: z.string().min(43).max(128),
  })
  .strict();

export const OAuthTokenRefreshBodySchema = z
  .object({
    grant_type: z.literal('refresh_token'),
    refresh_token: z.string().min(1),
    client_id: z.string().uuid(),
    scope: z.string().optional(),
  })
  .strict();

export const OAuthTokenRequestSchema = z.discriminatedUnion('grant_type', [
  OAuthTokenAuthCodeBodySchema,
  OAuthTokenRefreshBodySchema,
]);
export type OAuthTokenRequest = z.infer<typeof OAuthTokenRequestSchema>;

// ─── /v1/oauth/register request (RFC 7591) ─────────────────────────────────

export const OAuthRedirectUriSchema = z
  .string()
  .max(2048)
  .refine((s) => /^https?:\/\//.test(s), {
    message: 'redirect_uri must use http:// or https:// scheme',
  });

export const OAuthRegisterRequestSchema = z
  .object({
    client_name: z.string().min(1).max(200),
    redirect_uris: z.array(OAuthRedirectUriSchema).min(1),
    token_endpoint_auth_method: z.literal('none').optional(),
    grant_types: z.array(z.enum(['authorization_code', 'refresh_token'])).optional(),
    response_types: z.array(z.literal('code')).optional(),
    logo_uri: z.string().url().optional(),
    tos_uri: z.string().url().optional(),
    policy_uri: z.string().url().optional(),
  })
  .passthrough(); // preserve extra RFC 7591 metadata for future use
export type OAuthRegisterRequest = z.infer<typeof OAuthRegisterRequestSchema>;

// ─── /v1/oauth/token response (200) ────────────────────────────────────────

export const OAuthTokenResponseSchema = z
  .object({
    access_token: z.string(),
    token_type: z.literal('Bearer'),
    expires_in: z.number().int().positive(),
    refresh_token: z.string(),
    scope: z.string(),
  })
  .strict();
export type OAuthTokenResponse = z.infer<typeof OAuthTokenResponseSchema>;

// ─── /v1/oauth/register response (201) ─────────────────────────────────────

export const OAuthRegisterResponseSchema = z
  .object({
    client_id: z.string().uuid(),
    client_name: z.string(),
    redirect_uris: z.array(z.string()),
    token_endpoint_auth_method: z.literal('none'),
    grant_types: z.array(z.string()),
    response_types: z.array(z.string()),
    client_id_issued_at: z.number().int(),
  })
  .strict();
export type OAuthRegisterResponse = z.infer<typeof OAuthRegisterResponseSchema>;

// ─── /.well-known/oauth-authorization-server (RFC 8414) ────────────────────

export const OAuthDiscoveryMetadataSchema = z
  .object({
    issuer: z.string().url(),
    authorization_endpoint: z.string().url(),
    token_endpoint: z.string().url(),
    registration_endpoint: z.string().url(),
    response_types_supported: z.array(z.string()),
    grant_types_supported: z.array(z.string()),
    code_challenge_methods_supported: z.array(z.string()),
    token_endpoint_auth_methods_supported: z.array(z.string()),
    scopes_supported: z.array(z.string()),
    response_modes_supported: z.array(z.string()),
  })
  .strict();
export type OAuthDiscoveryMetadata = z.infer<typeof OAuthDiscoveryMetadataSchema>;

// ─── /.well-known/oauth-protected-resource (RFC 9728) ──────────────────────

export const OAuthProtectedResourceMetadataSchema = z
  .object({
    resource: z.string().url(),
    authorization_servers: z.array(z.string().url()),
    scopes_supported: z.array(z.string()),
    bearer_methods_supported: z.array(z.string()),
  })
  .strict();
export type OAuthProtectedResourceMetadata = z.infer<typeof OAuthProtectedResourceMetadataSchema>;
