import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';

/**
 * Feature 107 — `buildCaddyConfig()` emits an explicit terminal `api.<apex>` host
 * route → `api:3001` (the dedicated API host; the api demuxes /platform + /v1 and
 * 404s anything else, so it does NOT serve the studio). DB call order matches
 * buildCaddyConfig: 0 installation, 1 wildcardCerts, 2 setup_state, 3 instances.
 */

const APEX = 'example.test';

vi.mock('@supastack/db', () => {
  let i = 0;
  const chain = (rows: unknown[]) => {
    const settle = () => Promise.resolve(rows);
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      limit: () => settle(),
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) =>
        settle().then(res, rej),
    };
    return obj;
  };
  return {
    __reset: () => {
      i = 0;
    },
    db: () => ({
      select: () => {
        const idx = i++;
        // feature 117 — buildCaddyConfig no longer selects installation (apex from env).
        if (idx === 0) return chain([{ apex: APEX, status: 'issued' }]); // wildcardCerts
        if (idx === 1) return chain([{ completedAt: new Date() }]); // setup_state — done
        return chain([]); // instances
      },
    }),
    schema: {
      installation: { id: {}, apexDomain: {} },
      setupState: { completedAt: {} },
      wildcardCerts: { apex: {}, status: {} },
      supabaseInstances: { ref: {}, portKong: {}, portStudio: {}, portPostgres: {}, status: {} },
    },
  };
});

const dbMod = await import('@supastack/db');
const reset = (dbMod as unknown as { __reset: () => void }).__reset;
const { buildCaddyConfig } = await import('../../src/services/caddy-config.js');

beforeEach(() => {
  reset();
  process.env.SUPASTACK_APEX = APEX;
});
afterEach(() => {
  delete process.env.SUPASTACK_APEX;
});

function httpsRoutes(cfg: unknown): any[] {
  return (cfg as any).apps.http.servers.openfront_https.routes;
}
function hostRoute(cfg: unknown, host: string): any | undefined {
  return httpsRoutes(cfg).find((r: any) => r.match?.some((m: any) => m.host?.includes(host)));
}

describe('buildCaddyConfig — api.<apex> host route (feature 107)', () => {
  it('emits a terminal api.<apex> route → api:3001', async () => {
    const cfg = await buildCaddyConfig();
    const r = hostRoute(cfg, `api.${APEX}`);
    expect(r, 'expected an api.<apex> host route').toBeTruthy();
    expect(r.terminal).toBe(true);
    expect(r.handle[0].handler).toBe('reverse_proxy');
    expect(r.handle[0].upstreams[0].dial).toBe('api:3001');
  });

  it('the api.<apex> route does NOT fan into the studio (proxies to api, which 404s non-routes)', async () => {
    const cfg = await buildCaddyConfig();
    const r = hostRoute(cfg, `api.${APEX}`);
    const serialized = JSON.stringify(r.handle);
    expect(serialized).toContain('api:3001');
    expect(serialized).not.toContain('studio:3000');
  });

  it('is matched before the dashboard fallback (so api.<apex>/ never hits the studio catch-all)', async () => {
    const cfg = await buildCaddyConfig();
    const routes = httpsRoutes(cfg);
    const apiIdx = routes.findIndex((r: any) =>
      r.match?.some((m: any) => m.host?.includes(`api.${APEX}`)),
    );
    const fallbackIdx = routes.length - 1; // dashboardFallback is last
    expect(apiIdx).toBeGreaterThanOrEqual(0);
    expect(apiIdx).toBeLessThan(fallbackIdx);
  });
});
