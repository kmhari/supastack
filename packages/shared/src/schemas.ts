import { z } from 'zod';

// ─── primitives ─────────────────────────────────────────────────────────────
export const Email = z.string().email().toLowerCase();
export const Password = z.string().min(12).max(256);
export const Slug = z
  .string()
  .min(1)
  .max(63)
  .regex(/^[a-z0-9][a-z0-9-]*[a-z0-9]?$/, 'lowercase alphanumeric, hyphens, must start with letter/digit');
export const Ref = z.string().regex(/^[a-z0-9]{20}$/, '20 lowercase alphanumeric chars');
export const ApexDomain = z
  .string()
  .regex(/^[a-z0-9.-]+\.[a-z]{2,}$/i, 'valid apex domain (e.g., example.com)');

// ─── setup ──────────────────────────────────────────────────────────────────
export const SetupRequest = z.object({
  email: Email,
  password: Password,
  orgName: z.string().min(1).max(100),
  apexDomain: ApexDomain.optional(),
});
export type SetupRequest = z.infer<typeof SetupRequest>;

// ─── auth ───────────────────────────────────────────────────────────────────
export const LoginRequest = z.object({
  email: Email,
  password: z.string().min(1),
});
export type LoginRequest = z.infer<typeof LoginRequest>;

export const TokenCreateRequest = z.object({
  label: z.string().min(1).max(100),
});
export type TokenCreateRequest = z.infer<typeof TokenCreateRequest>;

// ─── members ────────────────────────────────────────────────────────────────
export const InviteCreateRequest = z.object({
  email: Email,
  role: z.enum(['admin', 'member']),
});
export type InviteCreateRequest = z.infer<typeof InviteCreateRequest>;

export const InviteAcceptRequest = z.object({
  token: z.string().min(32),
  password: Password,
});
export type InviteAcceptRequest = z.infer<typeof InviteAcceptRequest>;

// ─── instances ──────────────────────────────────────────────────────────────
export const InstanceCreateRequest = z.object({
  name: z.string().min(1).max(100),
  supabaseVersion: z.string().optional(),
  smtp: z
    .object({
      host: z.string().min(1),
      port: z.number().int().min(1).max(65535),
      user: z.string().min(1),
      password: z.string().min(1),
    })
    .optional(),
  enableSignup: z.boolean().default(true),
  jwtExpirySec: z.number().int().min(60).max(86400 * 30).default(3600),
  backupAutoEnabled: z.boolean().default(true),
  backupRetain: z.number().int().min(1).max(365).default(7),
});
export type InstanceCreateRequest = z.infer<typeof InstanceCreateRequest>;

export const InstancePatchRequest = z
  .object({
    name: z.string().min(1).max(100).optional(),
    backupAutoEnabled: z.boolean().optional(),
    backupRetain: z.number().int().min(1).max(365).optional(),
  })
  .strict();
export type InstancePatchRequest = z.infer<typeof InstancePatchRequest>;

export const InstanceUpgradeRequest = z.object({
  supabaseVersion: z.string().min(1),
  backupFirst: z.boolean().default(true),
});
export type InstanceUpgradeRequest = z.infer<typeof InstanceUpgradeRequest>;

export const CredentialRevealRequest = z.object({
  password: z.string().min(1),
});
export type CredentialRevealRequest = z.infer<typeof CredentialRevealRequest>;

// ─── org / backup store ─────────────────────────────────────────────────────
export const OrgPatchRequest = z
  .object({
    name: z.string().min(1).max(100).optional(),
    apexDomain: ApexDomain.optional(),
  })
  .strict();
export type OrgPatchRequest = z.infer<typeof OrgPatchRequest>;

export const BackupStoreConfig = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('local') }),
  z.object({
    kind: z.literal('s3'),
    endpoint: z.string().url().optional(),
    bucket: z.string().min(1),
    region: z.string().min(1),
    accessKeyId: z.string().min(1),
    secretAccessKey: z.string().min(1),
  }),
]);
export type BackupStoreConfig = z.infer<typeof BackupStoreConfig>;
