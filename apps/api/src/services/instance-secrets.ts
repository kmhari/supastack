import { randomBytes } from 'node:crypto';
import {
  assertSafeForEnv,
  encryptJson,
  generatePassword,
  loadMasterKey,
  signSupabaseJwt,
} from '@supastack/crypto';

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
 *
 * `postgresPasswordOverride` lets the operator supply their own Postgres
 * password from the create-project form. The override is hard-validated
 * with `assertSafeForEnv` before use so a typo'd `$` or quote can't slip
 * past the Docker Compose substitution layer.
 *
 * `jwtExpirySec` is the per-session JWT expiry (passed to GoTrue's
 * GOTRUE_JWT_EXP). It is NOT used as the expiry for the anon and
 * service_role API keys: those are long-lived bearer credentials (5
 * years) that the realtime container's own healthcheck calls hourly
 * with apikey=anon. If we expired them in 1h the healthcheck started
 * 401'ing and Docker marked realtime unhealthy after ~1h.
 */
const API_KEY_EXPIRY_SEC = 5 * 365 * 24 * 60 * 60; // 5 years

export function generateInstanceSecrets(opts: {
  jwtExpirySec: number;
  postgresPasswordOverride?: string;
}): InstanceSecrets {
  const jwtSecret = randomBytes(40).toString('base64');
  let postgresPassword: string;
  if (opts.postgresPasswordOverride) {
    assertSafeForEnv(opts.postgresPasswordOverride, 'postgresPassword');
    postgresPassword = opts.postgresPasswordOverride;
  } else {
    postgresPassword = generatePassword(32);
  }
  return {
    jwtSecret,
    anonKey: signSupabaseJwt(jwtSecret, { role: 'anon', expSec: API_KEY_EXPIRY_SEC }),
    serviceRoleKey: signSupabaseJwt(jwtSecret, {
      role: 'service_role',
      expSec: API_KEY_EXPIRY_SEC,
    }),
    postgresPassword,
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
