import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Feature 086 US5 — setup-completion gate. `buildCaddyConfig()` reads
 * `setup_state.completed_at` and emits the dashboard catch-all as either:
 *   - a 302 → /setup redirect  (setup NOT done, or unknowable — fail-safe), or
 *   - reverse_proxy → studio:3000  (setup done).
 *
 * DB call order in buildCaddyConfig: 0 installation, 1 wildcardCerts,
 * 2 setup_state, 3 instances.
 */

const fixtures = {
  setupRows: [] as { completedAt: Date | null }[],
  throwOnSetup: false,
};

vi.mock('@supastack/db', () => {
  let callIndex = 0;
  const chain = (rows: unknown[], throwIt = false) => {
    const settle = () =>
      throwIt ? Promise.reject(new Error('db down')) : Promise.resolve(rows);
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      limit: () => settle(),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        settle().then(resolve, reject),
    };
    return obj;
  };
  return {
    __reset: () => {
      callIndex = 0;
    },
    db: () => ({
      select: () => {
        const idx = callIndex++;
        if (idx === 0) return chain([]); // installation — no apex
        if (idx === 1) return chain([]); // wildcardCerts — none issued
        if (idx === 2) return chain(fixtures.setupRows, fixtures.throwOnSetup); // setup_state
        return chain([]); // instances — none
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

/** The dashboard catch-all is the LAST subroute of the LAST (:443) fallback route. */
function catchAllHandler(cfg: unknown): Record<string, unknown> {
  const c = cfg as {
    apps: { http: { servers: { openfront_https: { routes: any[] } } } };
  };
  const routes = c.apps.http.servers.openfront_https.routes;
  const fallback = routes[routes.length - 1]; // dashboardFallback
  const subroutes = fallback.handle[0].routes as any[];
  return subroutes[subroutes.length - 1].handle[0] as Record<string, unknown>;
}

describe('buildCaddyConfig — setup-completion gate (feature 086 US5)', () => {
  beforeEach(() => {
    fixtures.setupRows = [];
    fixtures.throwOnSetup = false;
    reset();
  });

  it('setup incomplete (completed_at null) → catch-all 302 → /setup', async () => {
    fixtures.setupRows = [{ completedAt: null }];
    const h = catchAllHandler(await buildCaddyConfig());
    expect(h.handler).toBe('static_response');
    expect(h.status_code).toBe(302);
    expect((h.headers as { Location: string[] }).Location).toEqual(['/setup']);
  });

  it('no setup_state row → gated (302 → /setup)', async () => {
    fixtures.setupRows = [];
    const h = catchAllHandler(await buildCaddyConfig());
    expect(h.handler).toBe('static_response');
    expect(h.status_code).toBe(302);
  });

  it('setup complete → catch-all reverse_proxy → studio:3000', async () => {
    fixtures.setupRows = [{ completedAt: new Date() }];
    const h = catchAllHandler(await buildCaddyConfig());
    expect(h.handler).toBe('reverse_proxy');
    expect((h.upstreams as { dial: string }[])[0]!.dial).toBe('studio:3000');
  });

  it('fail-safe: setup_state read throws → gated (302 → /setup)', async () => {
    fixtures.throwOnSetup = true;
    const h = catchAllHandler(await buildCaddyConfig());
    expect(h.handler).toBe('static_response');
    expect(h.status_code).toBe(302);
  });
});
