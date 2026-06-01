import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Caddy NEVER emits a layer4 block — Postgres routing is owned by the
 * pg-edge-proxy in the api container (feature 005). This test guards
 * against regressing back to caddy-l4 routing.
 */

const fixtures = {
  orgRow: null as { apexDomain: string | null } | null,
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
    fixtures.orgRow = null;
    fixtures.certRows = [];
    fixtures.instances = [];
    resetDbCallIndex();
  });

  it('never emits layer4 when no apex + no cert', async () => {
    const cfg = (await buildCaddyConfig()) as CaddyConfig;
    expect(cfg.apps.layer4).toBeUndefined();
  });

  it('never emits layer4 even with apex + wildcard cert + instances', async () => {
    fixtures.orgRow = { apexDomain: 'selfbase.example.com' };
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
