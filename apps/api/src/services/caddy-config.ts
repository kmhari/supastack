import { not, inArray } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';

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
  const orgRows = await db().select().from(schema.org).limit(1);
  const org = orgRows[0];
  const apex = org?.apexDomain ?? null;

  const instances = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      portKong: schema.supabaseInstances.portKong,
      portStudio: schema.supabaseInstances.portStudio,
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
      match: [{ path: ['/api/*'] }],
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
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
      handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'web:80' }] }],
    },
  ];

  const instanceRoute = (ref: string, portKong: number, portStudio: number, hostname: string) => ({
    match: [{ host: [hostname] }],
    handle: [
      {
        handler: 'subroute',
        routes: [
          {
            match: [{ path: ['/studio*'] }],
            handle: [
              {
                handler: 'reverse_proxy',
                upstreams: [{ dial: `host.docker.internal:${portStudio}` }],
              },
            ],
          },
          {
            handle: [
              {
                handler: 'reverse_proxy',
                upstreams: [{ dial: `host.docker.internal:${portKong}` }],
              },
            ],
          },
        ],
      },
    ],
    terminal: true,
  });

  const dashboardFallback = {
    handle: [{ handler: 'subroute', routes: dashboardSubroutes }],
    terminal: true,
  };

  // Routes are matched top-down. Per-instance hostname matches first, then
  // fall through to the dashboard catch-all.
  const httpsRoutes = [
    ...instances.map((i) =>
      instanceRoute(i.ref, i.portKong, i.portStudio, apex ? `${i.ref}.${apex}` : `${i.ref}.localhost`),
    ),
    dashboardFallback,
  ];

  const httpRoutes = [
    // Plain HTTP can also serve instance APIs (for dev/testing without DNS).
    // Same per-instance route table; same fallback.
    ...instances.map((i) =>
      instanceRoute(i.ref, i.portKong, i.portStudio, apex ? `${i.ref}.${apex}` : `${i.ref}.localhost`),
    ),
    dashboardFallback,
  ];

  return {
    admin: { listen: ':2019' },
    apps: {
      tls: {
        automation: {
          // An explicit catch-all automation policy with on_demand:true is
          // REQUIRED for Caddy to actually trigger ACME on unknown SNIs.
          // Without this Caddy answers handshakes with TLS alert 80
          // (internal_error) and never calls /internal/tls/ask. The global
          // `automation.on_demand` block below is only the GATE URL —
          // the policy is what enables on-demand at all.
          policies: [{ on_demand: true }],
          on_demand: {
            ask: 'http://api:3001/internal/tls/ask',
          },
        },
      },
      http: {
        servers: {
          // ALWAYS-ON plain-HTTP listener. Reachable from boot even with no
          // apex configured. Lets /setup work before DNS exists.
          openfront_http: {
            listen: [':80'],
            routes: httpRoutes,
          },
          // HTTPS listener. `automatic_https.disable_redirects` keeps
          // Caddy's cert-provisioning machinery engaged while preventing
          // the default :80 → :443 redirect that would otherwise break
          // plain-HTTP /setup access. Combined with the automation policy
          // above, Caddy will start ACME for any unknown SNI that the
          // tls-ask gate approves.
          openfront_https: {
            listen: [':443'],
            automatic_https: { disable_redirects: true },
            routes: httpsRoutes,
          },
        },
      },
    },
  };
}
