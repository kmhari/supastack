import type { FastifyPluginAsync } from 'fastify';
import { db, schema } from '@selfbase/db';
import { errors } from '@selfbase/shared';
import { getPlatformIp, resolveA } from '../services/platform-ip.js';
import { probeHttpsCert, type CertProbeResult } from '../services/cert-probe.js';
import { reloadCaddy } from '../services/caddy-reload.js';

interface ApexStatus {
  apex: string | null;
  expectedIp: string | null;
  observedIps: string[];
  dnsResolved: boolean;
  cert: CertProbeResult | null;
}

async function buildStatus(): Promise<ApexStatus> {
  const [orgRow] = await db()
    .select({ apex: schema.org.apexDomain })
    .from(schema.org)
    .limit(1);
  const apex = orgRow?.apex ?? null;

  const expectedIp = await getPlatformIp();

  if (!apex) {
    return { apex: null, expectedIp, observedIps: [], dnsResolved: false, cert: null };
  }

  const observedIps = await resolveA(apex);
  const dnsResolved = expectedIp !== null && observedIps.includes(expectedIp);

  // Only probe TLS once DNS resolves to the right host — otherwise we just
  // hit Caddy's fallback cert for an unrelated SNI and learn nothing useful.
  const cert = dnsResolved ? await probeHttpsCert(apex) : null;

  return { apex, expectedIp, observedIps, dnsResolved, cert };
}

export const apexRoutes: FastifyPluginAsync = async (app) => {
  app.get('/apex', async (req, reply) => {
    app.authorize(req, 'org.read');
    return reply.send(await buildStatus());
  });

  app.post('/apex/recheck', async (req, reply) => {
    app.authorize(req, 'org.update');
    // Re-push Caddy config — covers the case where Caddy lost state on
    // restart and is missing the apex route. Mirrors open-frontend.
    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload during apex recheck failed');
    }
    return reply.send(await buildStatus());
  });

  /**
   * POST /apex/issue — explicit "issue the HTTPS cert now" trigger.
   *
   * Does NOT rely on the user's browser visiting the apex. Instead it
   * fires up to N probe handshakes from inside the docker network
   * (api → caddy:443 with SNI=<apex>), which is what Caddy's on-demand
   * TLS treats as the issuance signal. Once a real-CA cert appears or
   * the budget runs out, returns the current status.
   *
   * Total wall time: up to ~45s. Caddy typically completes ACME HTTP-01
   * in 5-10s when DNS is good; we give a generous budget for slow ACME.
   */
  app.post('/apex/issue', async (req, reply) => {
    app.authorize(req, 'org.update');

    // Always reload Caddy first so the apex is in the latest config.
    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload during apex issue failed');
    }

    const initial = await buildStatus();
    if (!initial.apex) {
      throw errors.invalidInput('apex domain is not configured');
    }
    if (!initial.dnsResolved) {
      throw errors.invalidInput(
        `DNS for ${initial.apex} does not resolve to ${initial.expectedIp ?? 'this server'} yet`,
      );
    }
    if (initial.cert?.issued) return reply.send(initial);

    // Issue loop. Each probe attempts a TLS handshake which Caddy uses
    // as the on-demand trigger. Caddy may stall the first few handshakes
    // while ACME is in flight — that's fine, we retry.
    const deadline = Date.now() + 45_000;
    let last = initial;
    while (Date.now() < deadline) {
      last = await buildStatus();
      if (last.cert?.issued) break;
      await new Promise((r) => setTimeout(r, 3_000));
    }
    return reply.send(last);
  });
};
