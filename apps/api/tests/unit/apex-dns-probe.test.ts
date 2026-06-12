/**
 * DNS-verification anti-negative-cache guards (shipfan.xyz install stall):
 * public resolvers cache NXDOMAIN for the zone's negative TTL, so (a) the
 * wildcard probe must use a RANDOM label per query — a fixed label queried
 * before the operator added the record stays "missing" for minutes — and
 * (b) GET /apex?probe=0 must answer without ANY DNS lookup so the wizard
 * can display the records without poisoning the caches.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import Fastify from 'fastify';

const resolveACalls: string[] = [];
vi.mock('../../src/services/platform-ip.js', () => ({
  getPlatformIp: vi.fn(async () => '203.0.113.7'),
  resolveA: vi.fn(async (host: string) => {
    resolveACalls.push(host);
    return [];
  }),
}));
vi.mock('../../src/services/caddy-reload.js', () => ({ reloadCaddy: vi.fn(async () => {}) }));
vi.mock('../../src/services/cert-probe.js', () => ({ probeHttpsCert: vi.fn(async () => null) }));
vi.mock('@supastack/shared', async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  getApex: () => 'shipfan.test',
}));

import { apexRoutes, wildcardProbeName } from '../../src/routes/apex.js';

async function buildApp() {
  const app = Fastify();
  app.decorate('authorize', () => {});
  await app.register(apexRoutes);
  return app;
}

beforeEach(() => {
  resolveACalls.length = 0;
});

describe('wildcardProbeName', () => {
  it('is underscore-prefixed, random-labelled, and scoped to the apex', () => {
    expect(wildcardProbeName('shipfan.test')).toMatch(/^_wcprobe-[0-9a-f]{8}\.shipfan\.test$/);
  });
  it('never repeats — a fixed label would pin a negatively-cached NXDOMAIN', () => {
    const labels = new Set(Array.from({ length: 20 }, () => wildcardProbeName('shipfan.test')));
    expect(labels.size).toBe(20);
  });
});

describe('GET /apex', () => {
  it('?probe=0 answers apex + expectedIp with ZERO DNS lookups', async () => {
    const app = await buildApp();
    const res = await app.inject({ method: 'GET', url: '/apex?probe=0' });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      apex: 'shipfan.test',
      expectedIp: '203.0.113.7',
      dnsResolved: false,
      cert: null,
    });
    expect(resolveACalls).toEqual([]);
  });

  it('full probe resolves the apex plus a FRESH random wildcard name each call', async () => {
    const app = await buildApp();
    await app.inject({ method: 'GET', url: '/apex' });
    await app.inject({ method: 'GET', url: '/apex' });

    const wildcardQueries = resolveACalls.filter((h) => h.startsWith('_wcprobe-'));
    expect(resolveACalls).toContain('shipfan.test');
    expect(wildcardQueries).toHaveLength(2);
    expect(wildcardQueries[0]).toMatch(/^_wcprobe-[0-9a-f]{8}\.shipfan\.test$/);
    expect(wildcardQueries[0]).not.toBe(wildcardQueries[1]);
  });
});
