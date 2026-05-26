/**
 * OAuth 2.1 + OpenID-style discovery metadata.
 *
 * - GET /.well-known/oauth-authorization-server (RFC 8414)
 *
 * Served at the api process root (no /v1 prefix). The protected-resource
 * metadata (RFC 9728) is served by the MCP service at mcp.<apex>.
 *
 * Spec: 014-mcp-http-oauth — FR-006, contracts/oauth-discovery-endpoints.md.
 */
import type { FastifyPluginAsync } from 'fastify';

export const oauthDiscoveryRoutes: FastifyPluginAsync = async (app) => {
  app.get('/.well-known/oauth-authorization-server', async (_req, reply) => {
    const apex = process.env.SELFBASE_APEX;
    if (!apex) {
      reply.status(503);
      return { message: 'apex not configured yet', code: 'not_ready' };
    }
    const base = `https://api.${apex}`;
    reply.header('Cache-Control', 'max-age=3600');
    return {
      issuer: base,
      authorization_endpoint: `${base}/v1/oauth/authorize`,
      token_endpoint: `${base}/v1/oauth/token`,
      registration_endpoint: `${base}/v1/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['platform'],
      response_modes_supported: ['query'],
    };
  });
};
