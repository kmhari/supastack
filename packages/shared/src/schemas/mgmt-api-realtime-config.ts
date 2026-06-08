import { z } from 'zod';

export const RealtimeConfigSchema = z.object({
  max_concurrent_users: z.number().int().positive(),
});

export const RealtimeConfigPatchSchema = z.object({
  max_concurrent_users: z.number().int().positive().optional(),
}).strict();

export type RealtimeConfig = z.infer<typeof RealtimeConfigSchema>;
export type RealtimeConfigPatch = z.infer<typeof RealtimeConfigPatchSchema>;

export const REALTIME_DEFAULTS: RealtimeConfig = {
  max_concurrent_users: 200,
};
