import { z } from 'zod';

// ─── primitives ─────────────────────────────────────────────────────────────
export const Email = z.string().email().toLowerCase();
export const Password = z.string().min(8).max(256);
export const Slug = z
  .string()
  .min(1)
  .max(63)
  .regex(
    /^[a-z0-9][a-z0-9-]*[a-z0-9]?$/,
    'lowercase alphanumeric, hyphens, must start with letter/digit',
  );
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
  // Optional postgres password override. When omitted, the server generates
  // a strong 32-char alphanumeric. When provided, it MUST pass the same
  // env-safety check the server enforces on generated values (no `$`,
  // backtick, quote, backslash, or whitespace — Docker Compose would
  // otherwise reinterpret the value).
  dbPassword: z
    .string()
    .min(8)
    .max(128)
    .regex(/^[^\s$`\\"']+$/, 'must not contain spaces, $, `, \\, single, or double quotes')
    .optional(),
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
  jwtExpirySec: z
    .number()
    .int()
    .min(60)
    .max(86400 * 30)
    .default(3600),
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

// ─── wildcard certs ──────────────────────────────────────────────────────────
export const ChallengeRecord = z.object({
  name: z.string(),
  value: z.string(),
});

export const DnsCheckResult = z.object({
  name: z.string(),
  value: z.string(),
  found: z.boolean(),
});

export const WildcardCertInitiateResponse = z.object({
  apex: z.string(),
  status: z.literal('awaiting_dns'),
  challengeRecords: z.array(ChallengeRecord),
  ttlHint: z.number(),
});
export type WildcardCertInitiateResponse = z.infer<typeof WildcardCertInitiateResponse>;

export const WildcardCertVerifyResponse = z.object({
  status: z.enum(['awaiting_dns', 'issued', 'failed']),
  dnsChecks: z.array(DnsCheckResult).optional(),
  allDnsReady: z.boolean().optional(),
  notBefore: z.string().optional(),
  notAfter: z.string().optional(),
  message: z.string().optional(),
});
export type WildcardCertVerifyResponse = z.infer<typeof WildcardCertVerifyResponse>;

export const RenewalHistoryItem = z.object({
  triggeredBy: z.enum(['initial', 'manual']),
  outcome: z.enum(['success', 'failure', 'in_progress']),
  errorMessage: z.string().nullable(),
  certNotAfter: z.string().nullable(),
  startedAt: z.string(),
  finishedAt: z.string().nullable(),
});

export const WildcardCertStatusResponse = z.object({
  cert: z
    .object({
      apex: z.string(),
      status: z.enum(['pending', 'awaiting_dns', 'verifying', 'issued', 'failed', 'disabled']),
      challengeRecords: z.array(ChallengeRecord),
      dnsChecks: z.array(DnsCheckResult).optional(),
      allDnsReady: z.boolean().optional(),
      notBefore: z.string().nullable(),
      notAfter: z.string().nullable(),
      renewalDue: z.boolean(),
      issuedAt: z.string().nullable(),
      lastError: z.string().nullable(),
      renewalHistory: z.array(RenewalHistoryItem),
    })
    .nullable(),
});
export type WildcardCertStatusResponse = z.infer<typeof WildcardCertStatusResponse>;

// ─── backup store ────────────────────────────────────────────────────────────
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
