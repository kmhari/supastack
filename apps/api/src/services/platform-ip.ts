import { request } from 'undici';
import { Resolver } from 'node:dns';

/**
 * Use public resolvers (Cloudflare + Google + Quad9) instead of the system
 * resolver. This avoids stale-cache false negatives when the operator
 * adds the A record while we were already polling — the container's
 * resolver may have cached NXDOMAIN moments earlier. Pattern lifted from
 * /Users/lord/Code/open-frontend/apps/api/src/routes/wildcard-cert.ts.
 */
function publicResolver(): InstanceType<typeof Resolver> {
  const r = new Resolver();
  r.setServers(['1.1.1.1', '8.8.8.8', '9.9.9.9']);
  return r;
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
 * Reads SELFBASE_PUBLIC_IP env first; otherwise asks a few public "what's
 * my IP" services. Cached 30 minutes. Lifted from
 * /Users/lord/Code/open-frontend/apps/api/src/services/platform-ip.ts.
 */
export async function getPlatformIp(): Promise<string | null> {
  const fromEnv = process.env.SELFBASE_PUBLIC_IP?.trim();
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
 * Look up A records for a hostname via public DNS resolvers. Returns the
 * empty array on any error (NXDOMAIN, timeout, network) — callers treat
 * that as "not resolved yet" and keep polling.
 */
export async function resolveA(host: string): Promise<string[]> {
  const r = publicResolver();
  return new Promise<string[]>((resolve) => {
    r.resolve4(host, (err, addrs) => {
      if (err || !addrs) resolve([]);
      else resolve(addrs);
    });
  });
}
