import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * T024: secret-store vault-backed behavior.
 *
 * Mocks vault-client so we can verify:
 *   - validation rejects reserved names with 409 (preserves wire contract)
 *   - validation rejects bad names with 422
 *   - empty value rejected with 422
 *   - batch upsert wraps SELECT/INSERT/UPDATE in BEGIN..COMMIT
 *   - existing name → vaultUpdate, new name → vaultCreate
 *   - any per-entry failure rolls back the batch (ROLLBACK issued)
 *   - listSecrets filters reserved + computes sha256 server-side
 *
 * Pure name-validation helpers are covered by the existing
 * `secret-store-name.test.ts`.
 */

const mocks = vi.hoisted(() => {
  class FakeInstanceNotFoundForVaultError extends Error {
    code = 'instance_not_found' as const;
  }
  class FakeVaultUnreachableError extends Error {
    code = 'vault_unreachable' as const;
  }
  return {
    withVaultClient: vi.fn(),
    vaultListAll: vi.fn(),
    vaultFindIdByName: vi.fn(),
    vaultCreate: vi.fn(),
    vaultUpdate: vi.fn(),
    vaultDeleteByNames: vi.fn(),
    InstanceNotFoundForVaultError: FakeInstanceNotFoundForVaultError,
    VaultUnreachableError: FakeVaultUnreachableError,
  };
});

vi.mock('../../src/services/vault-client.js', () => mocks);

import { setSecrets, deleteSecrets, listSecrets } from '../../src/services/secret-store.js';

const {
  withVaultClient,
  vaultListAll,
  vaultFindIdByName,
  vaultCreate,
  vaultUpdate,
  vaultDeleteByNames,
  InstanceNotFoundForVaultError: FakeInstanceNotFoundForVaultError,
  VaultUnreachableError: FakeVaultUnreachableError,
} = mocks;

type SqlCall = { sql: string; params?: unknown[] };

function makeFakeClient(): { client: { query: ReturnType<typeof vi.fn> }; sqlCalls: SqlCall[] } {
  const sqlCalls: SqlCall[] = [];
  const client = {
    query: vi.fn(async (sql: string, params?: unknown[]) => {
      sqlCalls.push({ sql, params });
      return { rows: [] };
    }),
  };
  return { client, sqlCalls };
}

beforeEach(() => {
  withVaultClient.mockReset();
  vaultListAll.mockReset();
  vaultFindIdByName.mockReset();
  vaultCreate.mockReset();
  vaultUpdate.mockReset();
  vaultDeleteByNames.mockReset();
});

describe('setSecrets (vault-backed)', () => {
  it('rejects reserved name with 409 reserved_name (wire-contract preservation, SC-008)', async () => {
    await expect(
      setSecrets('r0000000000000000001', [{ name: 'SUPABASE_URL', value: 'x' }], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'reserved_name' });
    expect(withVaultClient).not.toHaveBeenCalled();
  });

  it('rejects invalid name with 422 validation', async () => {
    await expect(
      setSecrets('r0000000000000000001', [{ name: 'lower_case', value: 'x' }], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'validation' });
  });

  it('rejects empty value with 422', async () => {
    await expect(
      setSecrets('r0000000000000000001', [{ name: 'GOOD', value: '' }], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 422, code: 'validation' });
  });

  it('wraps batch in BEGIN/COMMIT and dispatches update vs create per row', async () => {
    const { client, sqlCalls } = makeFakeClient();
    withVaultClient.mockImplementation(
      async (_ref: string, fn: (c: typeof client) => Promise<void>) => fn(client),
    );
    // Existing row for FOO, new for BAR
    vaultFindIdByName.mockImplementation(async (_c, name) =>
      name === 'FOO' ? 'uuid-foo' : null,
    );

    await setSecrets(
      'r0000000000000000001',
      [
        { name: 'FOO', value: 'foo-val' },
        { name: 'BAR', value: 'bar-val' },
      ],
      { userId: 'u' },
    );

    expect(sqlCalls[0]?.sql).toBe('BEGIN');
    expect(sqlCalls[sqlCalls.length - 1]?.sql).toBe('COMMIT');
    expect(vaultUpdate).toHaveBeenCalledWith(client, 'uuid-foo', 'foo-val');
    expect(vaultCreate).toHaveBeenCalledWith(client, 'BAR', 'bar-val');
  });

  it('rolls back batch on per-entry failure (ROLLBACK issued)', async () => {
    const { client, sqlCalls } = makeFakeClient();
    withVaultClient.mockImplementation(
      async (_ref: string, fn: (c: typeof client) => Promise<void>) => fn(client),
    );
    vaultFindIdByName.mockResolvedValue(null);
    vaultCreate.mockImplementationOnce(async () => {
      throw new Error('simulated vault.create failure');
    });

    await expect(
      setSecrets(
        'r0000000000000000001',
        [{ name: 'WILL_FAIL', value: 'x' }],
        { userId: 'u' },
      ),
    ).rejects.toThrow();

    expect(sqlCalls.find((c) => c.sql === 'ROLLBACK')).toBeTruthy();
    expect(sqlCalls.find((c) => c.sql === 'COMMIT')).toBeUndefined();
  });

  it('translates InstanceNotFoundForVaultError → 404 not_found', async () => {
    withVaultClient.mockRejectedValueOnce(
      new FakeInstanceNotFoundForVaultError('instance r0000000000000000001 not found'),
    );
    await expect(
      setSecrets('r0000000000000000001', [{ name: 'OK', value: 'v' }], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 404, code: 'not_found' });
  });

  it('translates VaultUnreachableError → 503 vault_unreachable', async () => {
    withVaultClient.mockRejectedValueOnce(new FakeVaultUnreachableError('connect ECONNREFUSED'));
    await expect(
      setSecrets('r0000000000000000001', [{ name: 'OK', value: 'v' }], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 503, code: 'vault_unreachable' });
  });
});

describe('listSecrets', () => {
  it('returns [{ name, value: sha256 }] shape, filters reserved names defensively', async () => {
    withVaultClient.mockImplementation(async (_ref: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({}),
    );
    vaultListAll.mockResolvedValue([
      { name: 'OPENAI_KEY', decryptedSecret: 'sk-abc', updatedAt: new Date() },
      // Should be filtered even though api shouldn't have let this in:
      { name: 'JWT_SECRET', decryptedSecret: 'platform-shadow', updatedAt: new Date() },
    ]);
    const rows = await listSecrets('r0000000000000000001');
    expect(rows).toHaveLength(1);
    expect(rows[0]!.name).toBe('OPENAI_KEY');
    // sha256 of 'sk-abc' — verify shape (64 hex chars)
    expect(rows[0]!.value).toMatch(/^[a-f0-9]{64}$/);
  });
});

describe('deleteSecrets', () => {
  it('short-circuits empty names array (no vault call)', async () => {
    await deleteSecrets('r0000000000000000001', [], { userId: 'u' });
    expect(withVaultClient).not.toHaveBeenCalled();
  });

  it('rejects reserved name in delete request with 409', async () => {
    await expect(
      deleteSecrets('r0000000000000000001', ['SUPABASE_URL'], { userId: 'u' }),
    ).rejects.toMatchObject({ statusCode: 409, code: 'reserved_name' });
  });

  it('delegates to vaultDeleteByNames on happy path', async () => {
    withVaultClient.mockImplementation(async (_ref: string, fn: (c: unknown) => Promise<unknown>) =>
      fn({}),
    );
    await deleteSecrets('r0000000000000000001', ['ONE', 'TWO'], { userId: 'u' });
    expect(vaultDeleteByNames).toHaveBeenCalledWith({}, ['ONE', 'TWO']);
  });
});
