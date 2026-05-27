import { z } from 'zod';

export const BackupListItemSchema = z.object({
  id: z.string().uuid(),
  inserted_at: z.string().datetime(),
  status: z.enum(['COMPLETED', 'MISSING', 'FAILED']),
  kind: z.literal('physical_backup'),
  size_bytes: z.number().nullable(),
});

export const PhysicalBackupDataSchema = z.object({
  earliest_physical_backup_date_at: z.string().datetime().nullable(),
  latest_physical_backup_date_at: z.string().datetime().nullable(),
});

export const BackupsListResponseSchema = z.object({
  backups: z.array(BackupListItemSchema),
  physical_backup_data: PhysicalBackupDataSchema,
  region: z.string(),
  pitr_enabled: z.boolean(),
  walg_enabled: z.boolean(),
});

export const RestoreRequestSchema = z
  .object({
    backup_id: z.string().uuid().optional(),
    recovery_time_target: z.string().datetime().optional(),
  })
  .refine((d) => d.backup_id !== undefined || d.recovery_time_target !== undefined, {
    message: 'Either backup_id or recovery_time_target is required',
  });

export const RestoreJobResponseSchema = z.object({
  restore_job_id: z.string().uuid(),
  status: z.enum(['pending', 'running', 'success', 'failed']),
  backup_id: z.string().uuid(),
});

export const RestoreJobRecordSchema = z.object({
  id: z.string().uuid(),
  backup_id: z.string().uuid(),
  status: z.enum(['pending', 'running', 'success', 'failed']),
  started_at: z.string().datetime().nullable(),
  completed_at: z.string().datetime().nullable(),
  error_message: z.string().nullable(),
});

export const RestoreStatusResponseSchema = z.object({
  current: RestoreJobRecordSchema.nullable(),
  history: z.array(RestoreJobRecordSchema),
});

export type BackupListItem = z.infer<typeof BackupListItemSchema>;
export type BackupsListResponse = z.infer<typeof BackupsListResponseSchema>;
export type RestoreRequest = z.infer<typeof RestoreRequestSchema>;
export type RestoreJobResponse = z.infer<typeof RestoreJobResponseSchema>;
export type RestoreJobRecord = z.infer<typeof RestoreJobRecordSchema>;
export type RestoreStatusResponse = z.infer<typeof RestoreStatusResponseSchema>;
