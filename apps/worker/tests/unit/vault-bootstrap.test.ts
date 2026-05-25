import { describe, expect, it } from 'vitest';
import type { Client } from 'pg';
import { bootstrapVault, VaultBootstrapError } from '../../src/services/vault-bootstrap.js';

/**
 * T009: vault-bootstrap unit tests. Mocks `pg.Client.query` to verify the
 * SQL sequence + idempotency markers + error propagation.
 */

type Capture = { sql: string; params?: unknown[] };

function makeFakeClient(behavior: {
  installedExtensions?: string[];
  failAt?: string; // substring of SQL that should throw
}): { client: Client; calls: Capture[] } {
  const calls: Capture[] = [];
  const client = {
    async query(sql: string, params?: unknown[]) {
      calls.push({ sql, params });
      if (behavior.failAt && sql.includes(behavior.failAt)) {
        throw new Error(`simulated failure at ${behavior.failAt}`);
      }
      if (sql.includes('FROM pg_extension')) {
        const installed = behavior.installedExtensions ?? ['pgsodium', 'supabase_vault'];
        return { rows: installed.map((extname) => ({ extname })) };
      }
      return { rows: [] };
    },
  } as unknown as Client;
  return { client, calls };
}

describe('bootstrapVault', () => {
  it('issues SQL in order: pgsodium → root-key → vault → verify → smoke-test', async () => {
    const { client, calls } = makeFakeClient({});
    await bootstrapVault(client);
    expect(calls.length).toBeGreaterThanOrEqual(5);
    expect(calls[0]!.sql).toContain('CREATE EXTENSION IF NOT EXISTS pgsodium');
    expect(calls[1]!.sql).toContain('pgsodium.create_key');
    expect(calls[2]!.sql).toContain('CREATE EXTENSION IF NOT EXISTS supabase_vault');
    expect(calls[3]!.sql).toContain('FROM pg_extension');
    expect(calls[4]!.sql).toContain('vault.create_secret');
    expect(calls[4]!.sql).toContain('vault.decrypted_secrets');
    expect(calls[4]!.sql).toContain('DELETE FROM vault.secrets');
  });

  it('every CREATE EXTENSION uses IF NOT EXISTS (idempotent)', async () => {
    const { client, calls } = makeFakeClient({});
    await bootstrapVault(client);
    const createCalls = calls.filter((c) => c.sql.includes('CREATE EXTENSION'));
    expect(createCalls.length).toBe(2);
    for (const c of createCalls) {
      expect(c.sql).toContain('IF NOT EXISTS');
    }
  });

  it('pgsodium key creation guarded by NOT EXISTS (idempotent on re-run)', async () => {
    const { client, calls } = makeFakeClient({});
    await bootstrapVault(client);
    const keySql = calls.find((c) => c.sql.includes('pgsodium.create_key'))!;
    expect(keySql.sql).toContain('IF NOT EXISTS');
    expect(keySql.sql).toContain("name = 'default'");
  });

  it('throws VaultBootstrapError tagged with stage on pgsodium failure', async () => {
    const { client } = makeFakeClient({ failAt: 'CREATE EXTENSION IF NOT EXISTS pgsodium' });
    await expect(bootstrapVault(client)).rejects.toBeInstanceOf(VaultBootstrapError);
    await expect(bootstrapVault(client)).rejects.toMatchObject({
      code: 'vault_bootstrap_failed',
      message: expect.stringContaining('create-pgsodium'),
    });
  });

  it('throws VaultBootstrapError when verify finds extensions missing', async () => {
    const { client } = makeFakeClient({ installedExtensions: ['pgsodium'] /* vault missing */ });
    await expect(bootstrapVault(client)).rejects.toMatchObject({
      code: 'vault_bootstrap_failed',
      message: expect.stringContaining('verify-extensions'),
    });
  });

  it('smoke-test failure (e.g., libsodium missing at runtime) is surfaced', async () => {
    const { client } = makeFakeClient({ failAt: 'vault.create_secret' });
    await expect(bootstrapVault(client)).rejects.toMatchObject({
      code: 'vault_bootstrap_failed',
      message: expect.stringContaining('smoke-test'),
    });
  });
});
