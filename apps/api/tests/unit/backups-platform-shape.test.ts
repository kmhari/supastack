import { describe, expect, it, beforeEach, vi } from 'vitest';

/**
 * Feature 086 US6 — `listBackupsForPlatform` emits the vendored-Studio Cloud
 * shape (numeric `seq` id, UPPERCASE status, unix-sec dates), and
 * `resolveBackupSeq` is ref-scoped (the cross-project IDOR guard lives in its
 * `WHERE seq=$seq AND instance_ref=$ref` — here we assert the null-on-no-row
 * contract, which is what a wrong-ref seq produces).
 */

vi.mock('drizzle-orm', () => ({
  and: () => ({}),
  desc: () => ({}),
  eq: () => ({}),
  inArray: () => ({}),
  lte: () => ({}),
  not: () => ({}),
}));

const fixtures = {
  listRows: [] as { seq: number | null; startedAt: Date; status: string }[],
  resolveRows: [] as { id: string }[],
};

vi.mock('@supastack/db', () => {
  const obj: Record<string, unknown> = {
    from: () => obj,
    where: () => obj,
    orderBy: () => Promise.resolve(fixtures.listRows),
    limit: () => Promise.resolve(fixtures.resolveRows),
  };
  return {
    db: () => ({ select: () => obj }),
    schema: {
      backups: { id: {}, seq: {}, instanceRef: {}, startedAt: {}, status: {} },
      installation: { backupStoreKind: {}, backupStoreConfigEncrypted: {} },
    },
  };
});
vi.mock('@supastack/crypto', () => ({
  decryptJson: () => ({}),
  loadMasterKey: () => Buffer.alloc(32),
}));

const { listBackupsForPlatform, resolveBackupSeq, hashRefToInt } =
  await import('../../src/services/backups-mgmt-service.js');

describe('listBackupsForPlatform — Studio Cloud shape (feature 086 US6)', () => {
  beforeEach(() => {
    fixtures.listRows = [];
    fixtures.resolveRows = [];
  });

  it('maps native rows → numeric id, UPPERCASE status, unix-sec dates', async () => {
    const t = new Date('2026-06-03T22:33:36.852Z');
    fixtures.listRows = [{ seq: 819014003, startedAt: t, status: 'completed' }];
    const res = await listBackupsForPlatform('a'.repeat(20));

    expect(res.region).toBe('local');
    expect(res.pitr_enabled).toBe(false);
    expect(res.walg_enabled).toBe(false);
    expect(res.backups).toHaveLength(1);
    const b = res.backups[0]!;
    expect(typeof b.id).toBe('number');
    expect(b.id).toBe(819014003);
    expect(b.isPhysicalBackup).toBe(true);
    expect(b.status).toBe('COMPLETED');
    expect(b.inserted_at).toBe(t.toISOString());
    expect(typeof b.project_id).toBe('number');
    expect(res.physicalBackupData.latestPhysicalBackupDateUnix).toBe(
      Math.floor(t.getTime() / 1000),
    );
  });

  it('drift guard: exact top-level + per-row keys match the vendored Studio type', async () => {
    fixtures.listRows = [{ seq: 1, startedAt: new Date(), status: 'completed' }];
    const res = await listBackupsForPlatform('b'.repeat(20));
    expect(Object.keys(res).sort()).toEqual(
      ['backups', 'physicalBackupData', 'pitr_enabled', 'region', 'walg_enabled'].sort(),
    );
    expect(Object.keys(res.backups[0]!).sort()).toEqual(
      ['id', 'inserted_at', 'isPhysicalBackup', 'project_id', 'status'].sort(),
    );
  });

  it('empty project → empty backups[] with wrapper fields present', async () => {
    fixtures.listRows = [];
    const res = await listBackupsForPlatform('c'.repeat(20));
    expect(res.backups).toEqual([]);
    expect(res.physicalBackupData.earliestPhysicalBackupDateUnix).toBeNull();
  });
});

describe('resolveBackupSeq — ref-scoped (feature 086 US6)', () => {
  beforeEach(() => {
    fixtures.resolveRows = [];
  });

  it('happy: a seq belonging to this ref → its uuid', async () => {
    fixtures.resolveRows = [{ id: '11111111-1111-1111-1111-111111111111' }];
    expect(await resolveBackupSeq('a'.repeat(20), 42)).toBe('11111111-1111-1111-1111-111111111111');
  });

  it('IDOR guard: a seq NOT in this ref (no row) → null (never falls back to a global lookup)', async () => {
    fixtures.resolveRows = [];
    expect(await resolveBackupSeq('a'.repeat(20), 999)).toBeNull();
  });
});

describe('hashRefToInt — stable positive 31-bit int', () => {
  it('is deterministic and positive', () => {
    const a = hashRefToInt('abcdefghijklmnopqrst');
    expect(a).toBe(hashRefToInt('abcdefghijklmnopqrst'));
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThanOrEqual(0x7fffffff);
    expect(hashRefToInt('abcdefghijklmnopqrst')).not.toBe(hashRefToInt('tsrqponmlkjihgfedcba'));
  });
});
