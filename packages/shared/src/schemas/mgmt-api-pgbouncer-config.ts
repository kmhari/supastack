import { z } from 'zod';

const POOL_MODES = ['transaction', 'session', 'statement'] as const;

export const PgbouncerConfigSchema = z.object({
  pool_mode: z.enum(POOL_MODES),
  default_pool_size: z.number().int().positive(),
  ignore_startup_parameters: z.string(),
  max_client_conn: z.number().int().positive(),
  connection_string: z.string(),
});

export const PgbouncerConfigPatchSchema = z.object({
  pool_mode: z.enum(POOL_MODES).optional(),
  default_pool_size: z.number().int().positive().optional(),
  ignore_startup_parameters: z.string().optional(),
  max_client_conn: z.number().int().positive().optional(),
}).strict();

export type PgbouncerConfig = z.infer<typeof PgbouncerConfigSchema>;
export type PgbouncerConfigPatch = z.infer<typeof PgbouncerConfigPatchSchema>;

export const PGBOUNCER_DEFAULTS: PgbouncerConfig = {
  pool_mode: 'transaction',
  default_pool_size: 15,
  ignore_startup_parameters: 'extra_float_digits',
  max_client_conn: 200,
  connection_string: '',
};
