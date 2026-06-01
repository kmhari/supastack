import { describe, expect, it, vi, beforeEach } from 'vitest';

/**
 * T010: vault-enable-job unit tests.
 *
 * Mocks: pg.Client, @supastack/db, @supastack/crypto, vault-bootstrap.
 * Verifies: success path updates vault_enabled_at + emits audit; bootstrap
 * failure does NOT update the marker or emit success audit.
 */

const mockClient = {
  connect: vi.fn().mockResolvedValue(undefined),
  end: vi.fn().mockResolvedValue(undefined),
  query: vi.fn().mockResolvedValue({ rows: [] }),
};

vi.mock('pg', () => ({
  default: { Client: vi.fn().mockImplementation(() => mockClient) },
}));

const auditInserts: unknown[] = [];
const instanceUpdates: unknown[] = [];
const mockDb = {
  select: vi.fn().mockReturnValue({
    from: vi.fn().mockReturnValue({
      where: vi.fn().mockReturnValue({
        limit: vi.fn().mockResolvedValue([
          {
            ref: 'r0000000000000000001',
            encryptedSecrets: Buffer.from('fake'),
            portDbDirect: 5433,
            portPostgres: 5432,
          },
        ]),
      }),
    }),
  }),
  update: vi.fn().mockReturnValue({
    set: vi.fn().mockImplementation((vals: unknown) => ({
      where: vi.fn().mockImplementation(() => {
        instanceUpdates.push(vals);
        return Promise.resolve(undefined);
      }),
    })),
  }),
  insert: vi.fn().mockReturnValue({
    values: vi.fn().mockImplementation((vals: unknown) => {
      auditInserts.push(vals);
      return Promise.resolve(undefined);
    }),
  }),
};

vi.mock('@supastack/db', () => ({
  db: () => mockDb,
  schema: {
    supabaseInstances: { ref: {}, encryptedSecrets: {}, portDbDirect: {}, portPostgres: {} },
    auditLog: {},
  },
}));

vi.mock('@supastack/crypto', () => ({
  decryptJson: vi.fn().mockReturnValue({ postgresPassword: 'fake-pw' }),
  loadMasterKey: vi.fn().mockReturnValue(Buffer.alloc(32)),
}));

vi.mock('../../src/services/vault-bootstrap.js', () => ({
  bootstrapVault: vi.fn().mockResolvedValue(undefined),
  VaultBootstrapError: class extends Error {
    code = 'vault_bootstrap_failed';
  },
}));

import { handleVaultEnable } from '../../src/jobs/vault-enable-job.js';
import { bootstrapVault } from '../../src/services/vault-bootstrap.js';

describe('handleVaultEnable', () => {
  beforeEach(() => {
    auditInserts.length = 0;
    instanceUpdates.length = 0;
    (bootstrapVault as unknown as ReturnType<typeof vi.fn>).mockReset();
    (bootstrapVault as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    mockClient.connect.mockClear();
    mockClient.end.mockClear();
  });

  it('happy path: connects, bootstraps, updates marker, emits audit', async () => {
    const res = await handleVaultEnable({
      ref: 'r0000000000000000001',
      source: 'dashboard-button',
    });
    expect(res.ref).toBe('r0000000000000000001');
    expect(typeof res.durationMs).toBe('number');

    expect(mockClient.connect).toHaveBeenCalledOnce();
    expect(bootstrapVault).toHaveBeenCalledOnce();
    expect(mockClient.end).toHaveBeenCalled();

    // vault_enabled_at set
    expect(instanceUpdates).toHaveLength(1);
    expect((instanceUpdates[0] as Record<string, unknown>).vaultEnabledAt).toBeInstanceOf(Date);

    // audit emitted with source
    expect(auditInserts).toHaveLength(1);
    const audit = auditInserts[0] as { action: string; payload: { source: string; ref: string } };
    expect(audit.action).toBe('instance.vault.enabled');
    expect(audit.payload.source).toBe('dashboard-button');
    expect(audit.payload.ref).toBe('r0000000000000000001');
  });

  it('bootstrap failure: NO marker update, NO success audit, error propagated', async () => {
    (bootstrapVault as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('simulated bootstrap failure'),
    );

    await expect(
      handleVaultEnable({ ref: 'r0000000000000000001', source: 'provision' }),
    ).rejects.toThrow(/simulated bootstrap failure/);

    expect(instanceUpdates).toHaveLength(0);
    expect(auditInserts).toHaveLength(0);
    expect(mockClient.end).toHaveBeenCalled(); // cleanup happened
  });

  it('source=provision is preserved in the audit payload', async () => {
    await handleVaultEnable({ ref: 'r0000000000000000001', source: 'provision' });
    const audit = auditInserts[0] as { payload: { source: string } };
    expect(audit.payload.source).toBe('provision');
  });
});
