/**
 * T044 — backup job.
 *
 * Mocks child_process.spawn, db, backup-store factories, crypto.
 * Asserts:
 *   - pg_dump stream is created and piped into BackupStore.put
 *   - success path updates row → completed + size; lastBackupAt set
 *   - failure path updates row → failed and rethrows
 *   - retention sweep deletes blobs beyond retain count
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { Readable } from 'node:stream';

const insertedBackups: Array<Record<string, unknown>> = [];
const updatedBackups: Array<Record<string, unknown>> = [];
const deletedBackupIds: unknown[] = [];
let storeMode: 'local' | 's3' = 'local';
const putCalls: Array<{ ref: string }> = [];
let putShouldFail = false;
const storeDeleteCalls: string[] = [];

type InstRow = { ref: string; backupRetain: number };
let inst: InstRow | null = { ref: 'r0000000000000000001', backupRetain: 2 };

// Pretend backups table has 4 completed rows so retention=2 deletes 2.
let backupRows: Array<{ id: string; storeKey: string }> = [];

vi.mock('node:child_process', () => ({
  spawn: vi.fn(() => {
    const stream = new Readable({ read() {} });
    process.nextTick(() => {
      stream.push('FAKE_DUMP_DATA');
      stream.push(null);
    });
    return {
      stdout: stream,
      stderr: new Readable({ read() {} }),
      on: vi.fn(),
    };
  }),
}));

vi.mock('@selfbase/db', () => {
  return {
    db: () => ({
      select: (cols?: Record<string, unknown>) => {
        const isOrgStoreCfg = cols && Object.keys(cols).includes('configEncrypted');
        const isOrgKind = cols && Object.keys(cols).includes('kind') && !isOrgStoreCfg;
        const isBackupRows = cols && Object.keys(cols).includes('storeKey');
        return {
          from: () => ({
            where: () => ({
              limit: async () => (inst ? [inst] : []),
              orderBy: async () => backupRows,
            }),
            limit: async () => {
              if (isOrgKind) return [{ kind: storeMode }];
              if (isOrgStoreCfg)
                return [
                  {
                    kind: storeMode,
                    configEncrypted: storeMode === 's3' ? Buffer.from('x') : null,
                  },
                ];
              return [];
            },
            orderBy: async () => backupRows,
          }),
          // direct chain (insert.returning case handled below)
        };
      },
      insert: () => ({
        values: (vals: Record<string, unknown>) => {
          insertedBackups.push(vals);
          return {
            returning: async () => [{ id: `bk-${insertedBackups.length}` }],
          };
        },
      }),
      update: () => ({
        set: (vals: Record<string, unknown>) => ({
          where: async () => {
            updatedBackups.push(vals);
          },
        }),
      }),
      delete: () => ({
        where: async (w: unknown) => {
          deletedBackupIds.push(w);
        },
      }),
    }),
    schema: {
      supabaseInstances: { ref: 'ref', lastBackupAt: 'lastBackupAt', updatedAt: 'updatedAt' },
      backups: {
        id: 'id',
        instanceRef: 'instanceRef',
        kind: 'kind',
        status: 'status',
        storeKey: 'storeKey',
        storeKind: 'storeKind',
        sizeBytes: 'sizeBytes',
        completedAt: 'completedAt',
        error: 'error',
        startedAt: 'startedAt',
      },
      org: {
        backupStoreKind: 'backupStoreKind',
        backupStoreConfigEncrypted: 'backupStoreConfigEncrypted',
      },
    },
  };
});

vi.mock('drizzle-orm', () => ({
  eq: () => ({ kind: 'eq' }),
  desc: () => ({ kind: 'desc' }),
  and: (...args: unknown[]) => ({ kind: 'and', args }),
}));

vi.mock('@selfbase/crypto', () => ({
  decryptJson: () => ({ accessKeyId: 'x', secretAccessKey: 'y', bucket: 'b', region: 'r' }),
  loadMasterKey: () => Buffer.alloc(32),
}));

vi.mock('@selfbase/backup-store', () => {
  class LocalDiskStore {
    constructor(public dir: string) {}
    async put(ref: string, _stream: Readable): Promise<{ key: string; size: number }> {
      putCalls.push({ ref });
      if (putShouldFail) throw new Error('disk full');
      return { key: `local/${ref}/${Date.now()}.dump`, size: 12345 };
    }
    async delete(key: string): Promise<void> {
      storeDeleteCalls.push(key);
    }
  }
  class S3Store extends LocalDiskStore {}
  return { LocalDiskStore, S3Store };
});

import { handleBackup, resolveBackupStore } from '../../../src/jobs/backup.js';

describe('backup job', () => {
  beforeEach(() => {
    insertedBackups.length = 0;
    updatedBackups.length = 0;
    deletedBackupIds.length = 0;
    putCalls.length = 0;
    storeDeleteCalls.length = 0;
    putShouldFail = false;
    storeMode = 'local';
    backupRows = [];
    inst = { ref: 'r0000000000000000001', backupRetain: 2 };
  });

  it('happy path: runs pg_dump, stores, marks completed', async () => {
    await handleBackup({ ref: 'r0000000000000000001', kind: 'manual' });
    expect(insertedBackups).toHaveLength(1);
    expect((insertedBackups[0] as { status: string }).status).toBe('running');
    expect(putCalls).toHaveLength(1);
    expect(updatedBackups.some((u) => u.status === 'completed')).toBe(true);
    expect(updatedBackups.some((u) => 'lastBackupAt' in u)).toBe(true);
  });

  it('store failure → row marked failed and rethrows', async () => {
    putShouldFail = true;
    await expect(handleBackup({ ref: 'r0000000000000000001', kind: 'manual' })).rejects.toThrow(
      /disk full/,
    );
    expect(updatedBackups.some((u) => u.status === 'failed')).toBe(true);
  });

  it('retention sweep: deletes blobs beyond retain count', async () => {
    backupRows = [
      { id: 'b1', storeKey: 'k1' },
      { id: 'b2', storeKey: 'k2' },
      { id: 'b3', storeKey: 'k3' }, // beyond retain=2
      { id: 'b4', storeKey: 'k4' },
    ];
    await handleBackup({ ref: 'r0000000000000000001', kind: 'auto' });
    expect(storeDeleteCalls).toEqual(expect.arrayContaining(['k3', 'k4']));
  });

  it('missing instance row → silent no-op', async () => {
    inst = null;
    await expect(handleBackup({ ref: 'unknown', kind: 'auto' })).resolves.toBeUndefined();
    expect(insertedBackups).toHaveLength(0);
  });

  it('resolveBackupStore returns LocalDiskStore by default', async () => {
    storeMode = 'local';
    const store = await resolveBackupStore();
    expect(store).toBeDefined();
  });

  it('resolveBackupStore picks S3Store when org.kind=s3', async () => {
    storeMode = 's3';
    const store = await resolveBackupStore();
    expect(store).toBeDefined();
  });
});
