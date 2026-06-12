import { Resolver } from 'node:dns';
import { request } from 'undici';

/**
 * Public resolvers (Cloudflare + Google + Quad9) instead of the system
 * resolver — the container's resolver may have cached NXDOMAIN moments
 * before the operator added the record.
 *
 * Queried in PARALLEL with answers unioned, not as a node server list:
 * node only fails over on timeout/refusal, and NXDOMAIN is a *valid* answer
 * — so a single resolver's negatively-cached NXDOMAIN (from a poll that ran
 * before the operator added the record) would pin "not resolved" for the
 * zone's full negative TTL. Any one resolver seeing the record wins.
 */
const PUBLIC_DNS_SERVERS = ['1.1.1.1', '8.8.8.8', '9.9.9.9'];

function resolve4With(server: string, host: string): Promise<string[]> {
  const r = new Resolver();
  r.setServers([server]);
  return new Promise<string[]>((resolve) => {
    r.resolve4(host, (err, addrs) => {
      if (err || !addrs) resolve([]);
      else resolve(addrs);
    });
  });
}

const FALLBACK_LOOKUP_URLS = [
  'https://api.ipify.org',
  'https://ifconfig.me/ip',
  'https://checkip.amazonaws.com',
];

let cached: { ip: string; at: number } | null = null;
const TTL_MS = 30 * 60 * 1000;

/**
 * Returns the IPv4 the operator should point their apex A record at.
 * Reads SUPASTACK_PUBLIC_IP env first; otherwise asks a few public "what's
 * my IP" services. Cached 30 minutes. Lifted from
 * /Users/lord/Code/open-frontend/apps/api/src/services/platform-ip.ts.
 */
export async function getPlatformIp(): Promise<string | null> {
  const fromEnv = process.env.SUPASTACK_PUBLIC_IP?.trim();
  if (fromEnv) return fromEnv;
  if (cached && Date.now() - cached.at < TTL_MS) return cached.ip;
  for (const url of FALLBACK_LOOKUP_URLS) {
    try {
      const res = await request(url, { headersTimeout: 3000, bodyTimeout: 3000 });
      if (res.statusCode === 200) {
        const ip = (await res.body.text()).trim();
        if (/^\d{1,3}(\.\d{1,3}){3}$/.test(ip)) {
          cached = { ip, at: Date.now() };
          return ip;
        }
      } else {
        await res.body.dump();
      }
    } catch {
      /* try the next one */
    }
  }
  return null;
}

/**
 * Look up A records for a hostname across all public resolvers, unioned.
 * Returns the empty array when nothing resolves anywhere (NXDOMAIN, timeout,
 * network) — callers treat that as "not resolved yet" and keep polling.
 */
export async function resolveA(host: string): Promise<string[]> {
  const answers = await Promise.all(PUBLIC_DNS_SERVERS.map((s) => resolve4With(s, host)));
  return [...new Set(answers.flat())];
}
