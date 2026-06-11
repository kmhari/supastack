import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';

/**
 * Caddy NEVER emits a layer4 block — Postgres routing is owned by the
 * pg-edge-proxy in the api container (feature 005). This test guards
 * against regressing back to caddy-l4 routing.
 */

const fixtures = {
  certRows: [] as { apex: string }[],
  instances: [] as {
    ref: string;
    portKong: number;
    portStudio: number;
    portPostgres: number;
    portDbDirect: number | null;
  }[],
};

vi.mock('@supastack/db', () => {
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
    __reset: () => {
      callIndex = 0;
    },
    db: () => ({
      select: () => {
        const idx = callIndex++;
        // feature 117 — buildCaddyConfig no longer selects installation (apex from env).
        if (idx === 0) return chain(fixtures.certRows);
        if (idx === 1) return chain([{ completedAt: new Date() }]); // setup_state (feature 086 US5)
        if (idx === 2) return chain(fixtures.instances);
        return chain([]);
      },
    }),
    schema: {
      installation: { id: {}, apexDomain: {} },
      setupState: { completedAt: {} },
      org: { id: {}, name: {}, apexDomain: {} },
      wildcardCerts: { apex: {}, status: {} },
      supabaseInstances: {
        ref: {},
        portKong: {},
        portStudio: {},
        portPostgres: {},
        portDbDirect: {},
        status: {},
      },
    },
  };
});

const dbMod = await import('@supastack/db');
const resetDbCallIndex = (dbMod as unknown as { __reset: () => void }).__reset;

const { buildCaddyConfig } = await import('../../src/services/caddy-config.js');

interface CaddyConfig {
  apps: { layer4?: unknown; tls: unknown; http: unknown };
}

describe('buildCaddyConfig — no layer4 emission (feature 005)', () => {
  beforeEach(() => {
    fixtures.certRows = [];
    fixtures.instances = [];
    delete process.env.SUPASTACK_APEX;
    resetDbCallIndex();
  });
  afterEach(() => {
    delete process.env.SUPASTACK_APEX;
  });

  it('never emits layer4 when no apex + no cert', async () => {
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeUndefined();
  });

  it('never emits layer4 even with apex + wildcard cert + instances', async () => {
    process.env.SUPASTACK_APEX = 'selfbase.example.com';
    fixtures.certRows = [{ apex: 'selfbase.example.com' }];
    fixtures.instances = [
      {
        ref: 'a'.repeat(20),
        portKong: 30000,
        portStudio: 30001,
        portPostgres: 30002,
        portDbDirect: 30005,
      },
      {
        ref: 'b'.repeat(20),
        portKong: 30010,
        portStudio: 30011,
        portPostgres: 30012,
        portDbDirect: 30015,
      },
    ];
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeUndefined();
    // tls + http still present
    expect(cfg.apps.tls).toBeDefined();
    expect(cfg.apps.http).toBeDefined();
  });
});
