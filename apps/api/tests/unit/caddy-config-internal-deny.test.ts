// @vitest-environment node
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Feature 120 — `/internal/*` must be refused on EVERY public host, from BOTH
 * config sources.
 *
 * The five `/internal/*` routes are unauthenticated by design and each documents
 * the assumption that it is unreachable from outside the Docker network
 * (`tls-ask.ts` says so outright). A guard existed, but only where it happened to
 * be reached: it sat inside the dashboard subroutes at the END of the route list,
 * while `apiHostRoute` is `terminal: true` and appears EARLIER — so on
 * `api.<apex>` it was never consulted and every internal route was publicly
 * reachable.
 *
 * Two sources, so two kinds of test:
 *  - runtime JSON: assert the deny route is FIRST, which is what makes it beat
 *    every terminal host route including hosts that do not exist yet
 *  - boot Caddyfile: Caddy site blocks do not cascade (the most specific matching
 *    address wins; requests never fall through to another block), so there is no
 *    place to express this once. Assert instead that every public site block
 *    carries its own guard — this test IS the default-deny mechanism for that
 *    file, and it is what catches a newly added host.
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
        if (idx === 0) return chain([{ apex: APEX, status: 'issued' }]); // wildcardCerts
        if (idx === 1) return chain([{ completedAt: new Date() }]); // setup_state
        return chain([{ ref: 'abcdefghijklmnopqrst', portKong: 8001, portStudio: 3101 }]);
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

const servers = (cfg: unknown) => (cfg as any).apps.http.servers;
const isInternalDeny = (r: any) =>
  r.match?.some((m: any) => m.path?.includes('/internal/*')) &&
  r.handle?.[0]?.handler === 'static_response' &&
  r.handle[0].status_code === 404;

describe('runtime config — /internal/* default-deny', () => {
  it.each(['openfront_https', 'openfront_http'])('%s denies /internal/* first', async (server) => {
    const cfg = await buildCaddyConfig();
    const routes = servers(cfg)[server].routes;
    expect(routes.length, 'expected routes to exist').toBeGreaterThan(0);
    expect(isInternalDeny(routes[0]), `${server}[0] must be the /internal/* deny`).toBe(true);
    expect(routes[0].terminal, 'the deny must stop evaluation').toBe(true);
  });

  it.each(['openfront_https', 'openfront_http'])(
    '%s: the deny precedes every terminal host route',
    async (server) => {
      const cfg = await buildCaddyConfig();
      const routes = servers(cfg)[server].routes;
      const denyIdx = routes.findIndex(isInternalDeny);
      const firstTerminalHost = routes.findIndex(
        (r: any) => r.terminal === true && r.match?.some((m: any) => m.host),
      );
      expect(denyIdx).toBeGreaterThanOrEqual(0);
      // A terminal host route ahead of the deny would shadow it — that is
      // exactly how api.<apex> was left open.
      if (firstTerminalHost >= 0) expect(denyIdx).toBeLessThan(firstTerminalHost);
    },
  );

  it('holds for a host that did not exist when the guard was written', async () => {
    // The deny matches on path with no host constraint, so any future host
    // inherits it. Asserting the absence of a host key is what encodes that.
    const cfg = await buildCaddyConfig();
    const deny = servers(cfg).openfront_https.routes.find(isInternalDeny);
    expect(deny.match.every((m: any) => m.host === undefined)).toBe(true);
  });
});

describe('boot Caddyfile — every public site block carries the guard', () => {
  /**
   * Resolve from THIS file, not from `process.cwd()` — vitest's cwd differs
   * between a root `pnpm test` and a per-package run, and a wrong path here
   * fails the suite rather than silently skipping it.
   */
  function repoFile(rel: string): string {
    let dir = path.dirname(fileURLToPath(import.meta.url));
    for (let up = 0; up < 8; up++) {
      const candidate = path.join(dir, rel);
      if (existsSync(candidate)) return candidate;
      dir = path.dirname(dir);
    }
    throw new Error(`could not locate ${rel} from ${fileURLToPath(import.meta.url)}`);
  }

  const caddyfile = readFileSync(repoFile('infra/Caddyfile'), 'utf8');

  /** Top-level site blocks: a line at column 0 ending in `{`. */
  function siteBlocks(src: string): { address: string; body: string }[] {
    const out: { address: string; body: string }[] = [];
    const lines = src.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] ?? '';
      if (!/^[^\s#].*\{\s*$/.test(line)) continue;
      const address = line.replace(/\s*\{\s*$/, '').trim();
      let depth = 1;
      const body: string[] = [];
      for (let j = i + 1; j < lines.length && depth > 0; j++) {
        const l = lines[j] ?? '';
        depth += (l.match(/\{/g) ?? []).length - (l.match(/\}/g) ?? []).length;
        if (depth > 0) body.push(l);
      }
      out.push({ address, body: body.join('\n') });
    }
    return out;
  }

  const blocks = siteBlocks(caddyfile);

  it('finds the expected public site blocks', () => {
    // Guards the parser itself — a silently-empty block list would make every
    // assertion below vacuously pass.
    expect(blocks.length).toBeGreaterThanOrEqual(4);
    const addrs = blocks.map((b) => b.address);
    expect(addrs).toContain('api.{$SUPASTACK_APEX}');
    expect(addrs).toContain('mcp.{$SUPASTACK_APEX}');
  });

  it.each(blocks.map((b) => b.address))('%s refuses /internal/*', (address) => {
    const block = blocks.find((b) => b.address === address)!;
    expect(
      /handle\s+\/internal\/\*\s*\{[^}]*respond\s+404/m.test(block.body),
      `site block "${address}" has no '/internal/* → 404' guard. Caddy site blocks do ` +
        'not cascade, so every public block needs its own. Add it here AND keep ' +
        'apps/api/src/services/caddy-config.ts in sync.',
    ).toBe(true);
  });
});
