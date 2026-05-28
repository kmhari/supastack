import { and, desc, eq, inArray, lte, not } from 'drizzle-orm';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import {
  LocalDiskStore,
  S3Store,
  type BackupStore,
  type S3StoreConfig,
} from '@selfbase/backup-store';
import type {
  BackupsListResponse,
  RestoreJobResponse,
  RestoreStatusResponse,
} from '@selfbase/shared';

const execFileAsync = promisify(execFile);

const BACKUPS_DIR = process.env.BACKUPS_DIR ?? '/var/selfbase/backups';
const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';

export async function resolveBackupStore(): Promise<{ kind: 'local' | 's3'; store: BackupStore }> {
  const [row] = await db()
    .select({ kind: schema.org.backupStoreKind, cfg: schema.org.backupStoreConfigEncrypted })
    .from(schema.org)
    .limit(1);
  if (!row || row.kind === 'local') {
    return { kind: 'local', store: new LocalDiskStore(BACKUPS_DIR) };
  }
  if (!row.cfg) throw new Error('s3 backup-store config missing');
  const cfg = decryptJson<S3StoreConfig>(row.cfg, loadMasterKey());
  return { kind: 's3', store: new S3Store(cfg) };
}

export async function listBackupsForCli(ref: string): Promise<BackupsListResponse> {
  const rows = await db()
    .select({
      id: schema.backups.id,
      insertedAt: schema.backups.startedAt,
      status: schema.backups.status,
      sizeBytes: schema.backups.sizeBytes,
    })
    .from(schema.backups)
    .where(
      and(eq(schema.backups.instanceRef, ref), not(inArray(schema.backups.status, ['running']))),
    )
    .orderBy(desc(schema.backups.startedAt));

  const completed = rows.filter((r) => r.status === 'completed');
  const earliest = completed.length
    ? completed[completed.length - 1]!.insertedAt.toISOString()
    : null;
  const latest = completed.length ? completed[0]!.insertedAt.toISOString() : null;

  return {
    backups: rows.map((r) => ({
      id: r.id,
      inserted_at: r.insertedAt.toISOString(),
      status: r.status === 'completed' ? 'COMPLETED' : r.status === 'failed' ? 'FAILED' : 'MISSING',
      kind: 'physical_backup',
      size_bytes: r.sizeBytes ?? null,
    })),
    physical_backup_data: {
      earliest_physical_backup_date_at: earliest,
      latest_physical_backup_date_at: latest,
    },
    region: 'local',
    pitr_enabled: false,
    walg_enabled: false,
  };
}

export async function initiateRestore(
  ref: string,
  input: { backup_id?: string; recovery_time_target?: string },
): Promise<RestoreJobResponse> {
  // Resolve backup_id
  let backupId: string;
  if (input.backup_id) {
    backupId = input.backup_id;
  } else {
    const rtt = new Date(input.recovery_time_target!);
    const [row] = await db()
      .select({ id: schema.backups.id })
      .from(schema.backups)
      .where(
        and(
          eq(schema.backups.instanceRef, ref),
          eq(schema.backups.status, 'completed'),
          lte(schema.backups.startedAt, rtt),
        ),
      )
      .orderBy(desc(schema.backups.startedAt))
      .limit(1);
    if (!row)
      throw new RestoreError('invalid_target', 'No backup found before recovery_time_target');
    backupId = row.id;
  }

  // Validate backup row
  const [backup] = await db()
    .select()
    .from(schema.backups)
    .where(and(eq(schema.backups.id, backupId), eq(schema.backups.instanceRef, ref)))
    .limit(1);
  if (!backup) throw new RestoreError('invalid_target', 'Backup not found for this project');
  if (backup.status !== 'completed') {
    throw new RestoreError('backup_status_invalid', `Backup status is ${backup.status}`);
  }

  // Verify blob exists in store
  const { store } = await resolveBackupStore();
  try {
    const stream = await store.get(backup.storeKey);
    stream.destroy();
  } catch {
    throw new RestoreError('backup_blob_missing', 'Backup blob not found in storage');
  }

  // Compute timeout budget: 300 + ceil(size_bytes / 1e9) * 60 + 300
  const sizeGb = Math.ceil((backup.sizeBytes ?? 0) / 1e9);
  const timeoutBudgetSeconds = 300 + sizeGb * 60 + 300;

  // TX: insert restore_jobs + update instance status to 'restoring'
  const [job] = await db().transaction(async (tx) => {
    const inserted = await tx
      .insert(schema.restoreJobs)
      .values({
        instanceRef: ref,
        backupId,
        timeoutBudgetSeconds,
      })
      .returning();
    await tx
      .update(schema.supabaseInstances)
      .set({ status: 'restoring', updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));
    return inserted;
  });

  return {
    restore_job_id: job!.id,
    status: 'pending',
    backup_id: backupId,
  };
}

async function checkDiskSpace(dataDir: string, backupSizeBytes: number): Promise<void> {
  let dataDirBytes = 0;
  try {
    const { stdout } = await execFileAsync('du', ['-sb', dataDir]);
    dataDirBytes = parseInt(stdout.split('\t')[0]!, 10) || 0;
  } catch {
    // If du fails (dir doesn't exist yet), skip the check
    return;
  }
  const required = dataDirBytes * 2;

  let availableBytes = 0;
  try {
    const { stdout } = await execFileAsync('df', ['--output=avail', '-B1', dataDir]);
    const lines = stdout.trim().split('\n');
    availableBytes = parseInt(lines[lines.length - 1]!.trim(), 10) || 0;
  } catch {
    return;
  }

  if (availableBytes < required) {
    const err = new RestoreError(
      'disk_space_insufficient',
      `Need ${required} bytes, only ${availableBytes} available`,
    );
    (err as any).details = {
      required_bytes: required,
      available_bytes: availableBytes,
      data_dir_bytes: dataDirBytes,
    };
    throw err;
  }
}

export async function getRestoreStatus(ref: string): Promise<RestoreStatusResponse> {
  const rows = await db()
    .select({
      id: schema.restoreJobs.id,
      backupId: schema.restoreJobs.backupId,
      status: schema.restoreJobs.status,
      startedAt: schema.restoreJobs.startedAt,
      completedAt: schema.restoreJobs.completedAt,
      errorMessage: schema.restoreJobs.errorMessage,
    })
    .from(schema.restoreJobs)
    .where(eq(schema.restoreJobs.instanceRef, ref))
    .orderBy(desc(schema.restoreJobs.createdAt))
    .limit(11);

  const toRecord = (r: (typeof rows)[number]) => ({
    id: r.id,
    backup_id: r.backupId,
    status: r.status,
    started_at: r.startedAt?.toISOString() ?? null,
    completed_at: r.completedAt?.toISOString() ?? null,
    error_message: r.errorMessage ?? null,
  });

  const terminal = new Set(['success', 'failed']);
  const inflight = rows.find((r) => !terminal.has(r.status));
  const current = inflight ?? rows[0] ?? null;
  const history = rows.filter((r) => terminal.has(r.status)).slice(0, 10);

  return {
    current: current ? toRecord(current) : null,
    history: history.map(toRecord),
  };
}

export class RestoreError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'RestoreError';
  }
}
