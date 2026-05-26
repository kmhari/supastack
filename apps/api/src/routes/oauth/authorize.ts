/**
 * GET /v1/oauth/authorize — OAuth 2.1 authorization code flow entry.
 * POST /v1/oauth/authorize — consent handler (Authorize/Deny submit).
 *
 * Browser-facing. Server-rendered consent UI; no React route required.
 * Session anchor: existing dashboard session cookie. If no session →
 * 302 to login with `?next=<urlencoded-authorize-path>`.
 *
 * Spec: 014-mcp-http-oauth — FR-001..003, FR-024b,
 *   contracts/oauth-authorize-endpoint.md.
 */
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import { db, schema } from '@selfbase/db';
import { logger } from '@selfbase/shared';

import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';
import { getClientById, validateRedirectUri } from '../../services/oauth-clients-store.js';
import { issueCode } from '../../services/oauth-codes-store.js';

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

interface ConsentParams extends AuthorizeParams {
  decision: 'authorize' | 'deny';
}

export const oauthAuthorizeRoutes: FastifyPluginAsync = async (app) => {
  // GET — render consent page (or redirect to login)
  app.get<{ Querystring: Partial<AuthorizeParams> }>('/oauth/authorize', async (req, reply) => {
    const params = validateParams(req.query);
    const client = await getClientById(params.client_id);
    if (!client) {
      throw new ManagementApiError(400, 'unknown client_id', 'invalid_client');
    }
    if (!validateRedirectUri(client, params.redirect_uri)) {
      throw new ManagementApiError(400, 'redirect_uri not in allow-list', 'invalid_request');
    }

    // Session check
    const userId = req.session?.userId;
    if (!userId) {
      const next = buildAuthorizePath(params);
      if (next.length > 4096) {
        throw new ManagementApiError(400, 'authorize URL too long', 'invalid_request');
      }
      return reply.redirect(`/dashboard/login?next=${encodeURIComponent(next)}`);
    }

    // Resolve operator identity for the consent UI label
    const [userRow] = await db()
      .select({ email: schema.users.email })
      .from(schema.users)
      .where(eq(schema.users.id, userId))
      .limit(1);
    if (!userRow) {
      // Session points at a removed user — clear it + bounce to login
      if (req.session) await req.session.destroy();
      const next = buildAuthorizePath(params);
      return reply.redirect(`/dashboard/login?next=${encodeURIComponent(next)}`);
    }

    reply.header('Content-Type', 'text/html; charset=utf-8');
    return renderConsentHtml({
      clientName: client.clientName,
      redirectUris: client.redirectUris,
      operatorEmail: userRow.email,
      scope: params.scope ?? ALLOWED_SCOPE,
      params,
    });
  });

  // POST — handle consent
  app.post<{ Body: Partial<ConsentParams> }>('/oauth/authorize', async (req, reply) => {
    const params = validateParams(req.body);
    const decision = req.body?.decision;
    if (decision !== 'authorize' && decision !== 'deny') {
      throw new ManagementApiError(400, 'missing decision', 'invalid_request');
    }
    const client = await getClientById(params.client_id);
    if (!client) {
      throw new ManagementApiError(400, 'unknown client_id', 'invalid_client');
    }
    if (!validateRedirectUri(client, params.redirect_uri)) {
      throw new ManagementApiError(400, 'redirect_uri not in allow-list', 'invalid_request');
    }
    const userId = req.session?.userId;
    if (!userId) {
      throw new ManagementApiError(401, 'session required', 'unauthenticated');
    }

    const stateParam = encodeURIComponent(params.state);

    if (decision === 'deny') {
      void emitAudit(userId, 'oauth.consent.denied', { client_id: client.id });
      return reply.redirect(
        `${params.redirect_uri}${params.redirect_uri.includes('?') ? '&' : '?'}error=access_denied&state=${stateParam}`,
      );
    }

    const { code } = await issueCode({
      clientId: client.id,
      userId,
      redirectUri: params.redirect_uri,
      codeChallenge: params.code_challenge,
      scope: params.scope ?? ALLOWED_SCOPE,
    });
    void emitAudit(userId, 'oauth.code.issued', {
      client_id: client.id,
      scope: params.scope ?? ALLOWED_SCOPE,
      redirect_uri: params.redirect_uri,
    });
    return reply.redirect(
      `${params.redirect_uri}${params.redirect_uri.includes('?') ? '&' : '?'}code=${encodeURIComponent(code)}&state=${stateParam}`,
    );
  });
};

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

function buildAuthorizePath(p: AuthorizeParams): string {
  const params = new URLSearchParams({
    response_type: p.response_type,
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    state: p.state,
    code_challenge: p.code_challenge,
    code_challenge_method: p.code_challenge_method,
    scope: p.scope ?? ALLOWED_SCOPE,
  });
  return `/v1/oauth/authorize?${params.toString()}`;
}

function renderConsentHtml(args: {
  clientName: string;
  redirectUris: string[];
  operatorEmail: string;
  scope: string;
  params: AuthorizeParams;
}): string {
  // Inline form POST submits consent decision. Hidden inputs preserve params.
  const esc = (s: string): string =>
    s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const hidden = (Object.entries(args.params) as [string, string][])
    .map(([k, v]) => `<input type="hidden" name="${esc(k)}" value="${esc(v)}">`)
    .join('\n      ');
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <title>Authorize ${esc(args.clientName)}</title>
  <style>
    body { font: 14px/1.5 system-ui, sans-serif; max-width: 480px; margin: 4em auto; padding: 0 1em; color: #222; }
    h1 { font-size: 1.4em; margin-bottom: 0.5em; }
    .client { font-weight: 600; }
    .who { color: #666; font-size: 0.9em; margin-top: 0.25em; }
    .perms { background: #f5f5f5; border-radius: 6px; padding: 1em; margin: 1.5em 0; }
    .perms h2 { font-size: 0.9em; margin: 0 0 0.5em; text-transform: uppercase; letter-spacing: 0.05em; color: #555; }
    .redirect { color: #666; font-size: 0.85em; margin-top: 1em; }
    button { font: inherit; padding: 0.5em 1em; border-radius: 4px; border: 1px solid #ccc; background: #fff; cursor: pointer; margin-right: 0.5em; }
    button[name="decision"][value="authorize"] { background: #2563eb; color: #fff; border-color: #2563eb; }
    button:hover { opacity: 0.9; }
  </style>
</head>
<body>
  <h1>Authorize MCP client?</h1>
  <p><span class="client">${esc(args.clientName)}</span> wants to access your selfbase deployment.</p>
  <p class="who">Signed in as <strong>${esc(args.operatorEmail)}</strong></p>
  <div class="perms">
    <h2>Permissions requested</h2>
    <p>Full platform access (read and manage all your projects).</p>
  </div>
  <p class="redirect">Will redirect to: <code>${esc(args.redirectUris.join(', '))}</code></p>
  <form method="POST" action="/v1/oauth/authorize">
    ${hidden}
    <button type="submit" name="decision" value="authorize">Authorize</button>
    <button type="submit" name="decision" value="deny">Deny</button>
  </form>
</body>
</html>`;
}

async function emitAudit(
  userId: string,
  action: 'oauth.code.issued' | 'oauth.consent.denied',
  payload: Record<string, unknown>,
): Promise<void> {
  try {
    await db()
      .insert(schema.auditLog)
      .values({
        actorUserId: userId,
        action,
        targetKind: 'oauth_client',
        targetId: (payload.client_id as string) ?? null,
        payload,
      });
  } catch (err) {
    logger.warn({ err, action }, 'oauth audit emit failed');
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Drizzle eq used in user lookup
import { eq } from 'drizzle-orm';

// Suppress unused import warning if FastifyRequest ever drops out
void (null as unknown as FastifyRequest);
