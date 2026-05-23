import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * T009 (feature 005): unit tests for buildCaddyConfig()'s layer4 emission.
 *
 * Verifies:
 *  - Backward compat: no layer4 block when no wildcard cert (FR-008)
 *  - Layer4 emitted with correct shape when wildcard cert + apex are present
 *  - Empty subroute when wildcard cert exists but no instances
 *  - SNI patterns and upstream dial targets are correct per data-model.md
 */

// Hold mutable test fixtures the mocked db() will read.
const fixtures = {
  orgRow: null as { apexDomain: string | null } | null,
  certRows: [] as { apex: string }[],
  instances: [] as { ref: string; portKong: number; portStudio: number; portPostgres: number }[],
};

// Mock @selfbase/db before importing caddy-config.
// The mock tracks the call order: caddy-config does (1) org, (2) wildcardCerts,
// (3) supabaseInstances in that exact order on each invocation of buildCaddyConfig().
vi.mock('@selfbase/db', () => {
  let callIndex = 0;

  const chain = (rows: unknown[]) => {
    const obj: Record<string, unknown> = {
      from: () => obj,
      where: () => obj,
      limit: () => Promise.resolve(rows),
      then: (resolve: (v: unknown) => unknown) => Promise.resolve(rows).then(resolve),
    };
    return obj;
  };

  return {
    __reset: () => { callIndex = 0; },
    db: () => ({
      select: () => {
        const idx = callIndex++;
        if (idx === 0) return chain(fixtures.orgRow ? [fixtures.orgRow] : []);
        if (idx === 1) return chain(fixtures.certRows);
        if (idx === 2) return chain(fixtures.instances);
        return chain([]);
      },
    }),
    schema: {
      org: { id: {}, name: {}, apexDomain: {} },
      wildcardCerts: { apex: {}, status: {} },
      supabaseInstances: {
        ref: {}, portKong: {}, portStudio: {}, portPostgres: {}, status: {},
      },
    },
  };
});

// Reset the call counter before each test
const dbMod = await import('@selfbase/db');
const resetDbCallIndex = (dbMod as unknown as { __reset: () => void }).__reset;

// Import AFTER mock is registered.
const { buildCaddyConfig } = await import('../../src/services/caddy-config.js');

interface CaddyConfig {
  apps: {
    layer4?: {
      servers: {
        postgres: {
          listen: string[];
          routes: Array<{
            handle: Array<{
              handler: string;
              routes?: Array<{
                match: Array<{ tls: { sni: string[] } }>;
                handle: Array<{
                  handler: string;
                  upstreams?: Array<{ dial: string[] }>;
                }>;
              }>;
            }>;
          }>;
        };
      };
    };
  };
}

describe('buildCaddyConfig — layer4 emission', () => {
  beforeEach(() => {
    fixtures.orgRow = null;
    fixtures.certRows = [];
    fixtures.instances = [];
    resetDbCallIndex();
  });

  it('omits layer4 entirely when there is no wildcard cert', async () => {
    fixtures.orgRow = { apexDomain: 'selfbase.example.com' };
    fixtures.certRows = []; // no issued cert
    fixtures.instances = [
      { ref: 'a'.repeat(20), portKong: 30000, portStudio: 30001, portPostgres: 30002 },
    ];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeUndefined();
  });

  it('omits layer4 when wildcard cert exists but no apex configured', async () => {
    fixtures.orgRow = { apexDomain: null };
    fixtures.certRows = [{ apex: 'orphan.example.com' }];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeUndefined();
  });

  it('emits layer4 with one subroute per instance when cert + apex are active', async () => {
    fixtures.orgRow = { apexDomain: 'selfbase.example.com' };
    fixtures.certRows = [{ apex: 'selfbase.example.com' }];
    fixtures.instances = [
      { ref: 'a'.repeat(20), portKong: 30000, portStudio: 30001, portPostgres: 30002 },
      { ref: 'b'.repeat(20), portKong: 30010, portStudio: 30011, portPostgres: 30012 },
    ];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeDefined();
    expect(cfg.apps.layer4!.servers.postgres.listen).toEqual([':5432']);
    const outer = cfg.apps.layer4!.servers.postgres.routes[0]!;
    const subroute = outer.handle[0]!;
    expect(subroute.handler).toBe('subroute');
    expect(subroute.routes!).toHaveLength(2);
    expect(subroute.routes![0]!.match[0]!.tls.sni).toEqual([
      'db.aaaaaaaaaaaaaaaaaaaa.selfbase.example.com',
    ]);
    expect(subroute.routes![0]!.handle[1]!.upstreams![0]!.dial).toEqual([
      'host.docker.internal:30002',
    ]);
    expect(subroute.routes![1]!.match[0]!.tls.sni).toEqual([
      'db.bbbbbbbbbbbbbbbbbbbb.selfbase.example.com',
    ]);
    expect(subroute.routes![1]!.handle[1]!.upstreams![0]!.dial).toEqual([
      'host.docker.internal:30012',
    ]);
  });

  it('emits layer4 with empty subroute when cert + apex but zero instances', async () => {
    fixtures.orgRow = { apexDomain: 'selfbase.example.com' };
    fixtures.certRows = [{ apex: 'selfbase.example.com' }];
    fixtures.instances = [];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeDefined();
    const outer = cfg.apps.layer4!.servers.postgres.routes[0]!;
    const subroute = outer.handle[0]!;
    expect(subroute.routes!).toEqual([]);
  });

  it('uses postgres matcher, subroute handler, then tls + proxy in subroute', async () => {
    fixtures.orgRow = { apexDomain: 'selfbase.example.com' };
    fixtures.certRows = [{ apex: 'selfbase.example.com' }];
    fixtures.instances = [
      { ref: 'a'.repeat(20), portKong: 30000, portStudio: 30001, portPostgres: 30002 },
    ];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    const outer = cfg.apps.layer4!.servers.postgres.routes[0]!;
    // The postgres matcher (not a handler) consumes the SSLRequest exchange,
    // so the outer handle chain has only the subroute (no separate postgres handler).
    expect(outer.handle).toHaveLength(1);
    expect(outer.handle[0]!.handler).toBe('subroute');
    const inner = outer.handle[0]!.routes![0]!;
    expect(inner.handle[0]!.handler).toBe('tls');
    expect(inner.handle[1]!.handler).toBe('proxy');
  });
});
