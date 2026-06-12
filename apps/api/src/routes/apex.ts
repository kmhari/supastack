import { randomBytes } from 'node:crypto';
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
 * Probe name used to verify a wildcard A record is in place. The wildcard
 * `*.<apex>` matches any label, so a RANDOM label per probe gives the same
 * answer as a fixed one — except it can never be negatively cached. A fixed
 * label queried before the operator added the record got its NXDOMAIN
 * cached by the public resolvers for the zone's negative TTL (5–15 min),
 * which is exactly the "records added but wizard won't confirm" stall seen
 * on the shipfan.xyz install. Underscore-prefixed (illegal in instance
 * refs, `[a-z0-9]{20}`) so it never collides with a real instance.
 */
export function wildcardProbeName(apex: string): string {
  return `_wcprobe-${randomBytes(4).toString('hex')}.${apex}`;
}

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
    resolveA(wildcardProbeName(apex)),
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
  app.get<{ Querystring: { probe?: string } }>('/apex', async (req, reply) => {
    app.authorize(req, 'org.read');
    // probe=0: return the apex + expected IP WITHOUT any DNS lookups. The
    // setup wizard uses this for its initial render (it needs the values to
    // DISPLAY the records) — querying DNS before the operator has added the
    // records poisons the public resolvers' negative caches and stalls the
    // later verification for the zone's negative TTL.
    if (req.query.probe === '0') {
      return reply.send({
        apex: getApex(),
        expectedIp: await getPlatformIp(),
        observedIps: [],
        dnsResolved: false,
        wildcardObservedIps: [],
        wildcardResolved: false,
        httpsReachable: false,
        cert: null,
      } satisfies ApexStatus);
    }
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
