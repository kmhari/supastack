/**
 * Zod schemas for GET/PUT /v1/projects/:ref/config/database/postgres.
 *
 * Shape matches upstream:
 * — components.schemas.PostgresConfigResponse (GET + PUT response)
 * — components.schemas.UpdatePostgresConfigBody (PUT input)
 * Ref: specs/009-runtime-config-tunables/upstream-openapi-snapshot.json
 */
import { z } from 'zod';

const timePattern = /^(-?[0-9]+(?:\.[0-9]+)?)(us|ms|s|min|h|d)?$/;

const timeStr = z.string().regex(timePattern);
const memStr = z.string().min(1); // e.g. "128MB", "4GB"

export const PostgresConfigResponseSchema = z.object({
  effective_cache_size: memStr.optional(),
  logical_decoding_work_mem: memStr.optional(),
  maintenance_work_mem: memStr.optional(),
  track_activity_query_size: memStr.optional(),
  max_connections: z.number().int().min(1).max(262143).optional(),
  max_locks_per_transaction: z.number().int().min(10).max(2147483640).optional(),
  max_parallel_maintenance_workers: z.number().int().min(0).max(1024).optional(),
  max_parallel_workers: z.number().int().min(0).max(1024).optional(),
  max_parallel_workers_per_gather: z.number().int().min(0).max(1024).optional(),
  max_replication_slots: z.number().int().optional(),
  max_slot_wal_keep_size: memStr.optional(),
  max_standby_archive_delay: timeStr.optional(),
  max_standby_streaming_delay: timeStr.optional(),
  max_wal_size: memStr.optional(),
  max_wal_senders: z.number().int().optional(),
  max_worker_processes: z.number().int().min(0).max(262143).optional(),
  session_replication_role: z.enum(['origin', 'replica', 'local']).optional(),
  shared_buffers: memStr.optional(),
  statement_timeout: timeStr.optional(),
  track_commit_timestamp: z.boolean().optional(),
  wal_keep_size: memStr.optional(),
  wal_sender_timeout: timeStr.optional(),
  work_mem: memStr.optional(),
  checkpoint_timeout: timeStr.optional(),
  hot_standby_feedback: z.boolean().optional(),
});

export const UpdatePostgresConfigBodySchema = PostgresConfigResponseSchema.extend({
  restart_database: z.boolean().optional(),
}).strict();

export type PostgresConfigResponse = z.infer<typeof PostgresConfigResponseSchema>;
export type UpdatePostgresConfigBody = z.infer<typeof UpdatePostgresConfigBodySchema>;

export const POSTGRES_INTEGER_FIELDS = new Set([
  'max_connections',
  'max_locks_per_transaction',
  'max_parallel_maintenance_workers',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'max_replication_slots',
  'max_wal_senders',
  'max_worker_processes',
]);

export const POSTGRES_BOOLEAN_FIELDS = new Set([
  'track_commit_timestamp',
  'hot_standby_feedback',
]);

export const POSTGRES_CONFIG_PARAM_NAMES = [
  'effective_cache_size',
  'logical_decoding_work_mem',
  'maintenance_work_mem',
  'track_activity_query_size',
  'max_connections',
  'max_locks_per_transaction',
  'max_parallel_maintenance_workers',
  'max_parallel_workers',
  'max_parallel_workers_per_gather',
  'max_replication_slots',
  'max_slot_wal_keep_size',
  'max_standby_archive_delay',
  'max_standby_streaming_delay',
  'max_wal_size',
  'max_wal_senders',
  'max_worker_processes',
  'session_replication_role',
  'shared_buffers',
  'statement_timeout',
  'track_commit_timestamp',
  'wal_keep_size',
  'wal_sender_timeout',
  'work_mem',
  'checkpoint_timeout',
  'hot_standby_feedback',
] as const;
