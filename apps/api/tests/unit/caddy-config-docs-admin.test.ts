import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * Feature 116 (US1) — buildCaddyConfig() must route `/docs*` + `/admin*` to
 * web:80 in the dashboard subroutes, BEFORE the setup-gate catch-all, so the
 * public docs + admin console are always reachable (not redirected to /setup).
 * DB call order matches buildCaddyConfig: 0 installation, 1 wildcardCerts,
 * 2 setup_state, 3 instances.
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
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => settle().then(res, rej),
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
        if (idx === 0) return chain([{ id: 1, apexDomain: APEX }]);
        if (idx === 1) return chain([{ apex: APEX, status: 'issued' }]);
        if (idx === 2) return chain([{ completedAt: new Date() }]); // setup done → catch-all = studio
        return chain([]);
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

beforeEach(() => reset());

function findDashboardSubroutes(cfg: any): any[] {
  let found: any[] | undefined;
  const walk = (node: any): void => {
    if (!node || typeof node !== 'object') return;
    if (Array.isArray(node)) return node.forEach(walk);
    if (
      node.handler === 'subroute' &&
      Array.isArray(node.routes) &&
      node.routes.some((r: any) => r.match?.some((m: any) => m.path?.includes('/docs*')))
    ) {
      found = node.routes;
    }
    Object.values(node).forEach(walk);
  };
  walk(cfg);
  if (!found) throw new Error('dashboard subroutes with /docs* not found');
  return found;
}

describe('buildCaddyConfig — /docs* + /admin* routing (feature 116)', () => {
  it('routes /setup*, /docs*, /admin* to web:80 in one rule', async () => {
    const routes = findDashboardSubroutes(await buildCaddyConfig());
    const webRoute = routes.find((r: any) => r.match?.some((m: any) => m.path?.includes('/docs*')));
    expect(webRoute).toBeTruthy();
    const paths = webRoute.match[0].path as string[];
    expect(paths).toEqual(expect.arrayContaining(['/setup*', '/docs*', '/admin*']));
    expect(webRoute.handle[0].handler).toBe('reverse_proxy');
    expect(webRoute.handle[0].upstreams[0].dial).toBe('web:80');
  });

  it('also routes the SPA static assets to web:80 (regression: blank /docs + /admin)', async () => {
    // The live bug: only the HTML routes (/docs*, /admin*) reached web, so the
    // bundle's /assets/* + /fonts/* + /favicon.ico fell through to the studio
    // catch-all → 404 → blank page. The same web rule MUST carry the asset paths.
    const routes = findDashboardSubroutes(await buildCaddyConfig());
    const webRoute = routes.find((r: any) => r.match?.some((m: any) => m.path?.includes('/docs*')));
    const paths = webRoute.match[0].path as string[];
    expect(paths).toEqual(expect.arrayContaining(['/assets/*', '/fonts/*', '/favicon.ico']));
  });

  it('the web route precedes the setup-gate catch-all (so /docs + /admin are never redirected)', async () => {
    const routes = findDashboardSubroutes(await buildCaddyConfig());
    const webIdx = routes.findIndex((r: any) => r.match?.some((m: any) => m.path?.includes('/docs*')));
    const catchAllIdx = routes.findIndex((r: any) => !r.match);
    expect(webIdx).toBeGreaterThanOrEqual(0);
    expect(catchAllIdx).toBeGreaterThan(webIdx);
  });
});
