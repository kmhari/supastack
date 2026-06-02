import { db, schema } from '@supastack/db';
import { eq, inArray, not } from 'drizzle-orm';

const CERTS_DIR = process.env.SUPASTACK_CERTS_DIR ?? '/var/supastack/certs';

/**
 * Build the complete Caddy JSON config from the current DB state.
 *
 * Three invariants — borrowed from /Users/lord/Code/open-frontend's
 * apps/edge/src/reload.ts:
 *
 *   1. ALWAYS emit both a :80 and a :443 server, even when there are zero
 *      instances and no apex configured. The :80 server serves the dashboard
 *      over plain HTTP so /setup is reachable before DNS exists.
 *
 *   2. The :443 server always has the on-demand-TLS automation policy
 *      pointing at /internal/tls/ask. Per-instance and apex routes are
 *      appended to the same server's routes table.
 *
 *   3. The dashboard route (whether apex or wildcard host match) is the
 *      catch-all FALLBACK after per-instance routes. This way an operator
 *      who hasn't configured DNS yet still reaches the dashboard from any
 *      hostname that happens to resolve to the box.
 *
 * The caller POSTs the result to Caddy admin `/load` which swaps atomically.
 */
export async function buildCaddyConfig(): Promise<unknown> {
  const orgRows = await db().select().from(schema.installation).limit(1);
  const org = orgRows[0];
  const apex = org?.apexDomain ?? null;

  // Check for an issued wildcard cert to use instead of per-subdomain on-demand TLS.
  const certRows = await db()
    .select({ apex: schema.wildcardCerts.apex })
    .from(schema.wildcardCerts)
    .where(eq(schema.wildcardCerts.status, 'issued'))
    .limit(1);
  const wildcardCert = certRows[0] ?? null;

  const instances = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      portKong: schema.supabaseInstances.portKong,
      portStudio: schema.supabaseInstances.portStudio,
      portPostgres: schema.supabaseInstances.portPostgres,
    })
    .from(schema.supabaseInstances)
    .where(not(inArray(schema.supabaseInstances.status, ['deleting'])));

  // ─── Routes shared by both listeners ───────────────────────────────────
  // /api/* and /socket.io/* always go to the API container.
  // /internal/* always 404s externally.
  // Per-instance hostnames are matched explicitly; everything else falls
  // through to the web (dashboard) container.
  const dashboardSubroutes = [
    {
      // ACME HTTP-01 challenges for per-project Postgres certs (feature 005
      // Option B). Routed to api regardless of hostname. Must come BEFORE
      // /api/* so the well-known path always wins.
      match: [{ path: ['/.well-known/acme-challenge/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
    },
    {
      match: [{ path: ['/api/get-deployment-commit', '/api/incident-banner'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
    },
    {
      // Same two overrides under the Studio basePath (/dashboard, feature 025).
      // Studio fetches them as `${BASE_PATH}/api/...`, which would otherwise fall
      // through to Studio's own routes — incident-banner hits Supabase's status
      // page and 500s self-hosted. Strip /dashboard so the api's root handlers
      // (server.ts) serve them. MUST precede the studio catch-all below.
      match: [
        { path: ['/dashboard/api/get-deployment-commit', '/dashboard/api/incident-banner'] },
      ],
      handle: [
        { handler: 'rewrite', strip_path_prefix: '/dashboard' },
        { handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] },
      ],
    },
    {
      // /api/v1/v1/* — double-v1 paths from Studio IS_PLATFORM=true.
      // Handled by Fastify catch-all that strips the outer /api/v1 internally.
      match: [{ path: ['/api/v1*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
    },
    {
      // Platform proxy routes (feature 025 — shared Studio IS_PLATFORM=true).
      match: [{ path: ['/platform/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
    },
    {
      // Feature 084 — control-plane GoTrue. Studio + clients hit /auth/v1/*;
      // strip the prefix and forward to the `auth` (GoTrue) container at :9999.
      match: [{ path: ['/auth/v1/*'] }],
      handle: [
        { handler: 'rewrite', strip_path_prefix: '/auth/v1' },
        { handler: 'reverse_proxy', upstreams: [{ dial: 'auth:9999' }] },
      ],
    },
    {
      match: [{ path: ['/socket.io/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
    },
    {
      match: [{ path: ['/internal/*'] }],
      handle: [{ handler: 'static_response', status_code: 404 }],
    },
    {
      // Setup wizard + Supastack-specific admin pages stay on the web SPA.
      match: [{ path: ['/setup*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'web:80' }] }],
    },
    {
      // Catch-all: shared Studio serves all remaining paths (feature 025).
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'studio:3000' }] }],
    },
  ];

  /**
   * Per-instance data-plane subdomain (`<ref>.<apex>`) → Kong. Kong demuxes:
   *   /rest/v1/*       → PostgREST
   *   /auth/v1/*       → GoTrue
   *   /realtime/v1/*   → Realtime
   *   /storage/v1/*    → Storage
   *   /functions/v1/*  → Edge Functions
   *   /pg/*            → pg-meta
   * Kong's `dashboard` catch-all was removed from kong.yml when Studio moved
   * to its own subdomain (see below) — the data subdomain is API-only now.
   */
  const instanceRoute = (ref: string, portKong: number, hostname: string) => ({
    match: [{ host: [hostname] }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `host.docker.internal:${portKong}` }],
      },
    ],
    terminal: true,
  });

  /**
   * Per-instance Studio subdomain (`studio-<ref>.<apex>`) → that project's
   * Studio container directly, bypassing Kong. Studio is the upstream
   * `supabase/studio:<sha>` image (no basePath, served at root), so its
   * same-origin /api/* fetches resolve to the same Studio container.
   */
  const instanceStudioRoute = (ref: string, portStudio: number, hostname: string) => ({
    match: [{ host: [hostname] }],
    handle: [
      {
        handler: 'reverse_proxy',
        upstreams: [{ dial: `host.docker.internal:${portStudio}` }],
      },
    ],
    terminal: true,
  });

  /**
   * Feature 010 — Studio's bundled `/project/default/functions/secrets` page
   * is a documentation-only stub (no CRUD). Redirect to the working supastack
   * dashboard page at /dashboard/project/<ref>/secrets, preserving any
   * query string. Path-precise so other /functions/* pages pass through.
   * Must be inserted BEFORE instanceStudioRoute for the same hostname so
   * Caddy matches the path filter first.
   *
   * Spec: 010-secrets-management — FR-019..022, contracts/caddy-redirect.md.
   */
  const studioSecretsRedirectRoute = (ref: string, hostname: string) => ({
    match: [
      {
        host: [hostname],
        path: ['/project/default/functions/secrets', '/project/default/functions/secrets/*'],
      },
    ],
    handle: [
      {
        handler: 'static_response',
        status_code: 302,
        headers: {
          Location: apex
            ? [
                `https://${apex}/dashboard/project/${ref}/secrets{http.request.uri.query_string_with_question_mark}`,
              ]
            : [`/dashboard/project/${ref}/secrets`],
        },
      },
    ],
    terminal: true,
  });

  const dashboardFallback = {
    handle: [{ handler: 'subroute', routes: dashboardSubroutes }],
    terminal: true,
  };

  // Routes match top-down:
  //   1. <ref>.<apex>         → Kong (data plane)
  //   2. studio-<ref>.<apex>  → Studio (UI)
  //   3. api.<apex>           → api:3001 (Supabase CLI-compat management surface)
  //   4. <apex>/* + everything else → supastack web (dashboard catch-all)
  const dataHost = (ref: string): string => (apex ? `${ref}.${apex}` : `${ref}.localhost`);
  const studioHost = (ref: string): string =>
    apex ? `studio-${ref}.${apex}` : `studio-${ref}.localhost`;

  /**
   * Management-API host (`api.<apex>`) — receives traffic from the upstream
   * `supabase` CLI configured with our profile.toml. Proxies the WHOLE host
   * to api:3001; the api Fastify instance demuxes by path (`/v1/*` for the
   * cloud-compatible management surface, anything else 404s here).
   *
   * No new env, no new container — same api container that serves the
   * dashboard's `/api/*` calls from the apex host.
   */
  const apiHostRoute = apex
    ? [
        {
          match: [{ host: [`api.${apex}`] }],
          handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
          terminal: true,
        },
      ]
    : [];

  /**
   * MCP service host (`mcp.<apex>`) — feature 014. Routes to the supastack-mcp
   * container which serves the OAuth-gated Streamable HTTP transport at /mcp
   * and the protected-resource discovery at /.well-known/oauth-protected-resource.
   */
  const mcpHostRoute = apex
    ? [
        {
          match: [{ host: [`mcp.${apex}`] }],
          handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'mcp:3002' }] }],
          terminal: true,
        },
      ]
    : [];

  const httpsRoutes = [
    ...instances.map((i) => instanceRoute(i.ref, i.portKong, dataHost(i.ref))),
    // Feature 010 — redirect Studio's broken /functions/secrets URL to supastack.
    // MUST appear before instanceStudioRoute (path-precise match evaluated first).
    ...instances.map((i) => studioSecretsRedirectRoute(i.ref, studioHost(i.ref))),
    ...instances.map((i) => instanceStudioRoute(i.ref, i.portStudio, studioHost(i.ref))),
    ...apiHostRoute,
    ...mcpHostRoute,
    dashboardFallback,
  ];

  const httpRoutes = [
    // Plain HTTP carries the same per-instance routes (for dev/testing without DNS).
    ...instances.map((i) => instanceRoute(i.ref, i.portKong, dataHost(i.ref))),
    // Feature 010 — redirect Studio's broken /functions/secrets URL to supastack.
    // MUST appear before instanceStudioRoute (path-precise match evaluated first).
    ...instances.map((i) => studioSecretsRedirectRoute(i.ref, studioHost(i.ref))),
    ...instances.map((i) => instanceStudioRoute(i.ref, i.portStudio, studioHost(i.ref))),
    ...apiHostRoute,
    ...mcpHostRoute,
    dashboardFallback,
  ];

  const tlsApp: Record<string, unknown> = {
    automation: {
      policies: [{ on_demand: true }],
      on_demand: {
        // Caddy 2.7+ replaced `ask: <url>` with a `permission` module.
        // The http permission module hits the same endpoint we already expose.
        permission: { module: 'http', endpoint: 'http://api:3001/internal/tls/ask' },
      },
    },
  };

  // When a wildcard cert is issued, load it from disk via load_files so Caddy
  // serves *.apex and apex from the single cert without triggering on-demand ACME.
  if (wildcardCert) {
    tlsApp.certificates = {
      load_files: [
        {
          certificate: `${CERTS_DIR}/${wildcardCert.apex}/cert.pem`,
          key: `${CERTS_DIR}/${wildcardCert.apex}/key.pem`,
          tags: [`wildcard:${wildcardCert.apex}`],
        },
      ],
    };
  }

  // tls_connection_policies: when the wildcard exists, route apex + *.apex
  // SNI to the pre-loaded cert. The trailing empty policy {} is required —
  // without it any SNI not matching the first policy gets TLS alert 80.
  const httpsConnectionPolicies = wildcardCert
    ? [
        {
          match: { sni: [wildcardCert.apex, `*.${wildcardCert.apex}`] },
          certificate_selection: { any_tag: [`wildcard:${wildcardCert.apex}`] },
        },
        {},
      ]
    : undefined;

  // Postgres routing (port 5432) is handled OUTSIDE Caddy — the api container's
  // pg-edge-proxy owns it. See apps/api/src/services/pg-edge-proxy.ts and
  // specs/005-postgres-public-endpoint/. caddy-l4's postgres matcher can't
  // complete the Postgres STARTTLS handshake (no 'S' response), so we built
  // a small TCP/TLS proxy in the api container instead.

  return {
    // Caddy 2.7+ enforces an origin check on the admin endpoint. Allow the
    // internal Docker hostnames that need to POST /load (api, worker, caddy
    // itself). The admin port is NOT published externally.
    admin: {
      listen: ':2019',
      // Caddy 2.7+ Origin/Host check requires exact Host header match (incl. port).
      origins: ['caddy:2019', 'api:2019', 'worker:2019', 'localhost:2019', '127.0.0.1:2019'],
    },
    apps: {
      tls: tlsApp,
      http: {
        servers: {
          openfront_http: {
            listen: [':80'],
            routes: httpRoutes,
          },
          openfront_https: {
            listen: [':443'],
            automatic_https: { disable_redirects: true },
            ...(httpsConnectionPolicies
              ? { tls_connection_policies: httpsConnectionPolicies }
              : {}),
            routes: httpsRoutes,
          },
        },
      },
    },
  };
}
