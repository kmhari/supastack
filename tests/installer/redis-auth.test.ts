import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

/**
 * Redis is authenticated (feature 118 US1). The control-plane Redis holds
 * operator sessions, BullMQ queues, and the OAuth revocation list; it had no
 * `requirepass` — only network isolation. These guards lock in that the store
 * requires auth, every client carries the credential, the credential is
 * generated idempotently, and the password is never leaked or network-exposed.
 *
 * Contract: specs/118-redis-auth-security-audit/contracts/redis-auth.md
 */
const here = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(here, '../..', rel), 'utf8');

const installSh = read('install.sh');
const compose = read('infra/docker-compose.yml');

// The `redis:` service block, up to the next top-level service key.
function redisBlock(): string {
  const m = compose.match(/\n {2}redis:\n([\s\S]*?)\n {2}[a-z][a-z0-9_-]*:\n/);
  if (!m) throw new Error('redis service block not found in infra/docker-compose.yml');
  return m[1];
}

describe('install.sh — Redis credential generation', () => {
  it('generates REDIS_PASSWORD idempotently via ensure_env (never overwrites)', () => {
    // ensure_env only appends when the key is absent → re-run safe (FR-002/006).
    expect(installSh).toMatch(/ensure_env\s+REDIS_PASSWORD\s+"\$\(openssl rand -hex 32\)"/);
  });
});

describe('infra/docker-compose.yml — Redis requires auth', () => {
  const block = redisBlock();

  it('redis-server is started with --requirepass from ${REDIS_PASSWORD} (FR-001)', () => {
    expect(block).toMatch(/--requirepass/);
    expect(block).toMatch(/\$\{REDIS_PASSWORD\}/);
  });

  it('healthcheck authenticates via REDISCLI_AUTH, not -a (no log/argv leak — FR-007/009)', () => {
    expect(block).toMatch(/REDISCLI_AUTH:\s*\$\{REDIS_PASSWORD\}/);
    // The healthcheck must NOT pass the password on the command line.
    const healthcheck = block.match(/healthcheck:[\s\S]*?(?=\n {4}[a-z]|\n {2}[a-z]|$)/)?.[0] ?? '';
    expect(healthcheck).not.toMatch(/-a\s/);
    expect(healthcheck).not.toMatch(/\$\{REDIS_PASSWORD\}/);
  });

  it('redis stays internal-only — no host-published port (FR-008)', () => {
    expect(block).not.toMatch(/\n\s*ports:/);
  });
});

describe('infra/docker-compose.yml — all clients carry the credential (FR-004)', () => {
  it('every REDIS_URL is authenticated; none is a bare redis://redis:6379', () => {
    const urls = [...compose.matchAll(/REDIS_URL:\s*(\S+)/g)].map((m) => m[1]);
    expect(urls.length).toBe(3); // api, worker, mcp
    for (const url of urls) {
      expect(url).toBe('redis://default:${REDIS_PASSWORD}@redis:6379');
    }
    expect(compose).not.toMatch(/REDIS_URL:\s*redis:\/\/redis:6379\b/);
  });
});

describe('no committed secret value', () => {
  it('only the ${REDIS_PASSWORD} placeholder appears — never a literal hex secret', () => {
    // A 64-hex literal assigned to REDIS_PASSWORD would be a committed secret.
    expect(compose).not.toMatch(/REDIS_PASSWORD[=:]\s*[0-9a-f]{32,}/i);
    expect(installSh).not.toMatch(/REDIS_PASSWORD[=:]\s*[0-9a-f]{32,}/i);
  });
});
