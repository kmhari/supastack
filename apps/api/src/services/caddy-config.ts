import { eq, not, inArray } from 'drizzle-orm';
import { db, schema } from '@selfbase/db';

/**
 * Build the complete Caddy JSON config from the current DB state. Atomic:
 * the caller POSTs the result to Caddy admin `/load`, which swaps in one step.
 *
 * Hostnames:
 *  - org.apex_domain (the dashboard) → reverse-proxy to `web:80` and `/api/*` → `api:3001`
 *  - <ref>.<apex> for each non-deleted instance → /studio* → studio container,
 *    /* → kong container (both on the host network at the allocated ports)
 */
export async function buildCaddyConfig(): Promise<unknown> {
  const orgRows = await db().select().from(schema.org).limit(1);
  const org = orgRows[0];
  const apex = org?.apexDomain;

  const instances = await db()
    .select({
      ref: schema.supabaseInstances.ref,
      status: schema.supabaseInstances.status,
      portKong: schema.supabaseInstances.portKong,
      portStudio: schema.supabaseInstances.portStudio,
    })
    .from(schema.supabaseInstances)
    .where(not(inArray(schema.supabaseInstances.status, ['deleting'])));

  const servers: Record<string, unknown> = {};

  // 1. Dashboard apex (if configured)
  if (apex) {
    servers.dashboard = {
      listen: [':443'],
      automatic_https: { disable_redirects: false },
      routes: [
        {
          match: [{ host: [apex] }],
          handle: [
            {
              handler: 'subroute',
              routes: [
                // /api/* → API container
                {
                  match: [{ path: ['/api/*'] }],
                  handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
                },
                // /socket.io/* → API container (websocket)
                {
                  match: [{ path: ['/socket.io/*'] }],
                  handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'api:3001' }] }],
                },
                // everything else → web (the React dashboard)
                {
                  handle: [{ handler: 'reverse_proxy', upstreams: [{ dial: 'web:80' }] }],
                },
              ],
            },
          ],
          terminal: true,
        },
      ],
      tls_connection_policies: [{ default_sni: apex }],
    };
  }

  // 2. Per-instance subdomains
  for (const inst of instances) {
    if (!apex) continue; // can't route an instance without an apex
    const hostname = `${inst.ref}.${apex}`;
    servers[`inst_${inst.ref}`] = {
      listen: [':443'],
      automatic_https: { disable_redirects: false },
      routes: [
        {
          match: [{ host: [hostname] }],
          handle: [
            {
              handler: 'subroute',
              routes: [
                // /studio* → per-instance Studio container (on host network, allocated port)
                {
                  match: [{ path: ['/studio*'] }],
                  handle: [
                    {
                      handler: 'reverse_proxy',
                      upstreams: [{ dial: `host.docker.internal:${inst.portStudio}` }],
                    },
                  ],
                },
                // everything else → Kong
                {
                  handle: [
                    {
                      handler: 'reverse_proxy',
                      upstreams: [{ dial: `host.docker.internal:${inst.portKong}` }],
                    },
                  ],
                },
              ],
            },
          ],
          terminal: true,
        },
      ],
      tls_connection_policies: [{ on_demand: true }],
    };
  }

  return {
    admin: { listen: ':2019' },
    apps: {
      tls: {
        automation: {
          on_demand: {
            ask: 'http://api:3001/internal/tls/ask',
          },
        },
      },
      http: {
        servers,
      },
    },
  };
}
