import { errors, getApex } from '@supastack/shared';
import type { FastifyPluginAsync } from 'fastify';
import { reloadCaddy } from '../services/caddy-reload.js';
import { probeHttpsCert, type CertProbeResult } from '../services/cert-probe.js';
import { getPlatformIp, resolveA } from '../services/platform-ip.js';

interface ApexStatus {
  apex: string | null;
  expectedIp: string | null;
  observedIps: string[];
  dnsResolved: boolean;
  /**
   * Wildcard check: resolves a probe label `<random>.<apex>` and confirms
   * it lands on the same IP. Without a wildcard A record (`*.<apex> → IP`),
   * every per-instance subdomain we provision is unreachable.
   */
  wildcardObservedIps: string[];
  wildcardResolved: boolean;
  httpsReachable: boolean;
  cert: CertProbeResult | null;
}

/**
 * Probe label used to verify a wildcard A record is in place.
 *
 * Uses an underscore-prefixed label (illegal in our instance refs, which
 * are `[a-z0-9]{20}`) so it never collides with a real instance. The
 * registrar's wildcard `*.<apex>` should match this and return the
 * platform IP; a missing wildcard returns NXDOMAIN.
 */
const WILDCARD_PROBE_LABEL = '_supastack-wildcard-probe';

async function buildStatus(): Promise<ApexStatus> {
  const apex = getApex();

  const expectedIp = await getPlatformIp();

  if (!apex) {
    return {
      apex: null,
      expectedIp,
      observedIps: [],
      dnsResolved: false,
      wildcardObservedIps: [],
      wildcardResolved: false,
      httpsReachable: false,
      cert: null,
    };
  }

  const [observedIps, wildcardObservedIps] = await Promise.all([
    resolveA(apex),
    resolveA(`${WILDCARD_PROBE_LABEL}.${apex}`),
  ]);
  const apexOk = expectedIp !== null && observedIps.includes(expectedIp);
  const wildcardOk = expectedIp !== null && wildcardObservedIps.includes(expectedIp);
  const dnsResolved = apexOk && wildcardOk;

  // Only probe TLS once BOTH apex and wildcard DNS land on us — otherwise
  // we just hit Caddy's fallback cert for an unrelated SNI and learn
  // nothing useful.
  const cert = dnsResolved ? await probeHttpsCert(apex) : null;

  let httpsReachable = false;
  if (cert?.issued) {
    try {
      const res = await fetch(`https://${apex}/api/v1/health`, {
        signal: AbortSignal.timeout(5000),
      });
      httpsReachable = res.ok;
    } catch {
      httpsReachable = false;
    }
  }

  return {
    apex,
    expectedIp,
    observedIps,
    dnsResolved,
    wildcardObservedIps,
    wildcardResolved: wildcardOk,
    httpsReachable,
    cert,
  };
}

export const apexRoutes: FastifyPluginAsync = async (app) => {
  app.get('/apex', async (req, reply) => {
    app.authorize(req, 'org.read');
    // CI e2e mode: skip real DNS + cert probes (no DNS for test.local on the
    // runner, no ACME). Returning a "fully configured" status lets the
    // RequireAuth gate fall through to the actual page; otherwise every
    // browser-test navigation is intercepted into the Setup wizard.
    if (process.env.SUPASTACK_TEST_FAKE_DOCKER === '1') {
      const apex = getApex() ?? 'test.local';
      return reply.send({
        apex,
        expectedIp: '127.0.0.1',
        observedIps: ['127.0.0.1'],
        dnsResolved: true,
        wildcardObservedIps: ['127.0.0.1'],
        wildcardResolved: true,
        httpsReachable: true,
        cert: { reachable: true, issued: true },
      });
    }
    return reply.send(await buildStatus());
  });

  app.post('/apex/recheck', async (req, reply) => {
    app.authorize(req, 'org.update');
    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload during apex recheck failed');
    }
    return reply.send(await buildStatus());
  });

  app.post('/apex/issue', async (req, reply) => {
    app.authorize(req, 'org.update');

    try {
      await reloadCaddy();
    } catch (err) {
      req.log.warn({ err }, 'caddy reload during apex issue failed');
    }

    const initial = await buildStatus();
    if (!initial.apex) {
      throw errors.invalidInput('apex domain is not configured');
    }
    if (!initial.wildcardResolved) {
      throw errors.invalidInput(
        `Wildcard A record for *.${initial.apex} does not resolve to ${initial.expectedIp ?? 'this server'} yet. Add it at your DNS registrar — every per-instance subdomain depends on it.`,
      );
    }
    if (!initial.dnsResolved) {
      throw errors.invalidInput(
        `DNS for ${initial.apex} does not resolve to ${initial.expectedIp ?? 'this server'} yet`,
      );
    }
    if (initial.cert?.issued) return reply.send(initial);

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
