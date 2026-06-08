/**
 * GET /v1/oauth/authorize — OAuth 2.1 authorization code flow entry (feature 115).
 *
 * Browser-facing and UNAUTHENTICATED. Validates the OAuth 2.1 PKCE params,
 * stashes them in a short-lived server-side session (Redis, keyed by a UUID
 * `auth_id`), and 303-redirects to the upstream Studio consent page
 * (`https://<apex>/dashboard/authorize?auth_id=<UUID>`). The Studio page handles
 * its own auth gate and drives consent via the `/platform/oauth/authorizations/*`
 * endpoints (see routes/platform-misc.ts). No inline HTML; no POST handler —
 * the endpoint is GET-only, matching upstream Supabase.
 *
 * Spec: 115-oauth-authorize-flow — FR-001, FR-008; contracts/oauth-authorize-endpoint.md.
 */
import type { FastifyPluginAsync } from 'fastify';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getClientById, validateRedirectUri } from '../../services/oauth-clients-store.js';
import { createAuthSession } from '../../services/oauth-auth-sessions-store.js';

const ALLOWED_SCOPE = 'platform';

interface AuthorizeParams {
  response_type: string;
  client_id: string;
  redirect_uri: string;
  state: string;
  code_challenge: string;
  code_challenge_method: string;
  scope?: string;
}

export const oauthAuthorizeRoutes: FastifyPluginAsync = async (app) => {
  // GET — validate params, store the session, redirect to the Studio consent page.
  app.get<{ Querystring: Partial<AuthorizeParams> }>('/oauth/authorize', async (req, reply) => {
    const params = validateParams(req.query);
    const client = await getClientById(params.client_id);
    if (!client) {
      throw new ManagementApiError(400, 'unknown client_id', 'invalid_client');
    }
    if (!validateRedirectUri(client, params.redirect_uri)) {
      throw new ManagementApiError(400, 'redirect_uri not in allow-list', 'invalid_request');
    }

    const metadata = (client.metadata ?? {}) as { website?: unknown; icon?: unknown };
    const authId = await createAuthSession({
      client_id: client.id,
      client_name: client.clientName,
      client_website: typeof metadata.website === 'string' ? metadata.website : '',
      client_icon: typeof metadata.icon === 'string' ? metadata.icon : null,
      client_domain: safeHostname(params.redirect_uri),
      redirect_uri: params.redirect_uri,
      state: params.state,
      code_challenge: params.code_challenge,
      code_challenge_method: 'S256',
      scopes: (params.scope ?? ALLOWED_SCOPE).split(' ').filter(Boolean),
    });

    const apex = process.env.SUPASTACK_APEX ?? '';
    return reply.redirect(303, `https://${apex}/dashboard/authorize?auth_id=${authId}`);
  });
};

function safeHostname(uri: string): string {
  try {
    return new URL(uri).hostname;
  } catch {
    return '';
  }
}

function validateParams(input: Partial<AuthorizeParams> = {}): AuthorizeParams {
  if (input.response_type !== 'code') {
    throw new ManagementApiError(400, 'response_type must be "code"', 'unsupported_response_type');
  }
  if (typeof input.client_id !== 'string' || !UUID_RE.test(input.client_id)) {
    throw new ManagementApiError(400, 'client_id must be a UUID', 'invalid_request');
  }
  if (typeof input.redirect_uri !== 'string' || !/^https?:\/\//.test(input.redirect_uri)) {
    throw new ManagementApiError(400, 'redirect_uri must be a valid URL', 'invalid_request');
  }
  if (typeof input.state !== 'string' || input.state.length < 1) {
    throw new ManagementApiError(400, 'state required', 'invalid_request');
  }
  if (
    typeof input.code_challenge !== 'string' ||
    input.code_challenge.length < 43 ||
    input.code_challenge.length > 128
  ) {
    throw new ManagementApiError(400, 'code_challenge must be 43-128 chars', 'invalid_request');
  }
  if (input.code_challenge_method !== 'S256') {
    throw new ManagementApiError(
      400,
      'code_challenge_method must be S256 (OAuth 2.1 hardening — no plain)',
      'invalid_request',
    );
  }
  const scope = input.scope ?? ALLOWED_SCOPE;
  if (scope !== ALLOWED_SCOPE) {
    throw new ManagementApiError(400, `scope must be "${ALLOWED_SCOPE}"`, 'invalid_scope');
  }
  return {
    response_type: input.response_type,
    client_id: input.client_id,
    redirect_uri: input.redirect_uri,
    state: input.state,
    code_challenge: input.code_challenge,
    code_challenge_method: input.code_challenge_method,
    scope,
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
