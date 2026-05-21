import { randomBytes } from 'node:crypto';
import { encryptJson, generatePassword, loadMasterKey, signSupabaseJwt } from '@selfbase/crypto';

/**
 * The decrypted secret blob shape, mirroring contracts/compose-env.md.
 * Stored encrypted at rest as `supabase_instances.encrypted_secrets`.
 */
export interface InstanceSecrets {
  jwtSecret: string;
  anonKey: string;
  serviceRoleKey: string;
  postgresPassword: string;
  dashboardPassword: string;
  secretKeyBase: string;
  vaultEncKey: string;
  logflarePublicAccessToken: string;
  logflarePrivateAccessToken: string;
  pgMetaCryptoKey: string;
  s3ProtocolAccessKeyId: string;
  s3ProtocolAccessKeySecret: string;
  minioRootPassword: string;
}

/**
 * Generate a fresh set of per-instance secrets. Every password field uses
 * `generatePassword` (alphanumeric only — anti-Multibase). JWT keys are real
 * HS256 tokens signed with the jwtSecret (anti-SupaConsole).
 */
export function generateInstanceSecrets(opts: { jwtExpirySec: number }): InstanceSecrets {
  const jwtSecret = randomBytes(40).toString('base64');
  return {
    jwtSecret,
    anonKey: signSupabaseJwt(jwtSecret, { role: 'anon', expSec: opts.jwtExpirySec }),
    serviceRoleKey: signSupabaseJwt(jwtSecret, {
      role: 'service_role',
      expSec: opts.jwtExpirySec,
    }),
    postgresPassword: generatePassword(32),
    dashboardPassword: generatePassword(16),
    secretKeyBase: randomBytes(48).toString('base64').replace(/[/+=]/g, 'A').slice(0, 64),
    vaultEncKey: randomBytes(16).toString('hex'),
    logflarePublicAccessToken: generatePassword(32),
    logflarePrivateAccessToken: generatePassword(32),
    pgMetaCryptoKey: randomBytes(16).toString('hex'),
    s3ProtocolAccessKeyId: randomBytes(16).toString('hex'),
    s3ProtocolAccessKeySecret: randomBytes(32).toString('hex'),
    minioRootPassword: randomBytes(16).toString('hex'),
  };
}

export function encryptInstanceSecrets(secrets: InstanceSecrets): Buffer {
  return encryptJson(secrets, loadMasterKey());
}
