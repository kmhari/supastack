import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { Client } from 'pg';
import {
  vaultListAll,
  vaultFindIdByName,
  vaultCreate,
  vaultUpdate,
  vaultDeleteByNames,
} from '../../src/services/vault-client.js';

/**
 * T008: unit tests for vault-client SQL helpers.
 *
 * The connection/auth path (decryptJson + host.docker.internal pg client) is
 * exercised by live E2E. These pure tests verify the SQL each helper issues
 * — they're the security-sensitive bit (parameterized queries, no string
 * concatenation of user-controlled values).
 */

function makeFakeClient(rowsByQuery: Record<string, unknown[]>): Client {
  const calls: { sql: string; values: unknown[] }[] = [];
  const fake = {
    calls,
    async query(sql: string, values?: unknown[]) {
      calls.push({ sql, values: values ?? [] });
      const key = Object.keys(rowsByQuery).find((k) => sql.includes(k));
      return { rows: key ? rowsByQuery[key] : [] };
    },
  };
  return fake as unknown as Client;
}

describe('vault-client SQL helpers', () => {
  let calls: { sql: string; values: unknown[] }[];

  beforeEach(() => {
    calls = [];
  });

  it('vaultListAll selects from decrypted_secrets, filters key_id, orders by name', async () => {
    const client = makeFakeClient({
      'vault.decrypted_secrets': [
        { name: 'A', decrypted_secret: 'a-val', updated_at: new Date('2026-01-01') },
        { name: 'B', decrypted_secret: 'b-val', updated_at: new Date('2026-01-02') },
      ],
    });
    const rows = await vaultListAll(client);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toEqual({
      name: 'A',
      decryptedSecret: 'a-val',
      updatedAt: new Date('2026-01-01'),
    });
    const queryCall = (client as unknown as { calls: { sql: string }[] }).calls[0]!;
    expect(queryCall.sql).toContain('FROM vault.decrypted_secrets');
    expect(queryCall.sql).toContain('WHERE name IS NOT NULL');
    expect(queryCall.sql).toContain('ORDER BY name');
  });

  it('vaultFindIdByName uses parameterized query with name', async () => {
    const client = makeFakeClient({ 'SELECT id FROM vault.secrets': [{ id: 'uuid-1' }] });
    const id = await vaultFindIdByName(client, 'OPENAI_API_KEY');
    expect(id).toBe('uuid-1');
    const call = (client as unknown as { calls: { sql: string; values: unknown[] }[] }).calls[0]!;
    expect(call.values).toEqual(['OPENAI_API_KEY']);
    expect(call.sql).toContain('$1');
    expect(call.sql).not.toContain('OPENAI_API_KEY');
  });

  it('vaultFindIdByName returns null when no row', async () => {
    const client = makeFakeClient({});
    expect(await vaultFindIdByName(client, 'MISSING')).toBeNull();
  });

  it('vaultCreate calls vault.create_secret with value first, name second (upstream signature)', async () => {
    const client = makeFakeClient({});
    await vaultCreate(client, 'NAME_X', 'value-x');
    const call = (client as unknown as { calls: { sql: string; values: unknown[] }[] }).calls[0]!;
    expect(call.sql).toContain('vault.create_secret');
    // Param order matches upstream: (new_secret text, new_name text)
    expect(call.values).toEqual(['value-x', 'NAME_X']);
  });

  it('vaultUpdate calls vault.update_secret with id then value', async () => {
    const client = makeFakeClient({});
    await vaultUpdate(client, '00000000-0000-0000-0000-000000000001', 'new-value');
    const call = (client as unknown as { calls: { sql: string; values: unknown[] }[] }).calls[0]!;
    expect(call.sql).toContain('vault.update_secret');
    expect(call.values).toEqual(['00000000-0000-0000-0000-000000000001', 'new-value']);
  });

  it('vaultDeleteByNames passes names array as parameter, returns deleted names', async () => {
    const client = makeFakeClient({
      'DELETE FROM vault.secrets': [{ name: 'A' }, { name: 'B' }],
    });
    const deleted = await vaultDeleteByNames(client, ['A', 'B', 'NOT_PRESENT']);
    expect(deleted).toEqual(['A', 'B']);
    const call = (client as unknown as { calls: { sql: string; values: unknown[] }[] }).calls[0]!;
    expect(call.sql).toContain('WHERE name = ANY($1::text[])');
    expect(call.values).toEqual([['A', 'B', 'NOT_PRESENT']]);
  });

  it('vaultDeleteByNames short-circuits empty list (no query issued)', async () => {
    const client = makeFakeClient({});
    expect(await vaultDeleteByNames(client, [])).toEqual([]);
    expect((client as unknown as { calls: unknown[] }).calls).toHaveLength(0);
  });
});
