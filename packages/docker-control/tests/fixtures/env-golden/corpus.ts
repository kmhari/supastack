/**
 * Byte-identity corpus (feature 121, T001 / SC-003).
 *
 * These input sets were rendered against the renderer as it stood BEFORE the
 * env-writer hardening and the outputs committed alongside as `*.env`. Every
 * later step of the feature must leave those files byte-for-byte unchanged —
 * that is what makes "this is a validation addition, not a behaviour change"
 * evidence rather than assertion.
 *
 * If a change makes a golden file differ for well-formed input, the change is
 * wrong. Do not regenerate the goldens to make a test pass.
 *
 * Rendered against the REAL vendored template (`infra/supabase-template`), not
 * a fixture, so the corpus also pins the completeness assertion against the
 * .env.example we actually ship.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ComposeTemplateInputs } from '../../../src/compose-template.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** `infra/supabase-template` — the .env.example the completeness check reads. */
export const REAL_TEMPLATE_DIR = path.resolve(HERE, '../../../../../infra/supabase-template');

/** Directory holding the committed `<case>.env` golden files. */
export const GOLDEN_DIR = HERE;

const SECRETS: ComposeTemplateInputs['secrets'] = {
  jwtSecret: 'AAAA1111BBBB2222CCCC3333DDDD4444',
  anonKey: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoiYW5vbiJ9.x',
  serviceRoleKey: 'eyJhbGciOiJIUzI1NiJ9.eyJyb2xlIjoic2VydmljZV9yb2xlIn0.y',
  postgresPassword: 'SafeAlphaNum123',
  dashboardPassword: 'AlsoSafe9876',
  secretKeyBase: 'BaseAlphaNum0123456789',
  vaultEncKey: 'VaultKey0123456789ABCDEF',
  logflarePublicAccessToken: 'LFP0123456789',
  logflarePrivateAccessToken: 'LFR0123456789',
  pgMetaCryptoKey: 'PGM0123456789ABCDEF',
  s3ProtocolAccessKeyId: 'S3KEY0123456789',
  s3ProtocolAccessKeySecret: 'S3SECRET0123456789',
  minioRootPassword: 'MINIO0123456789',
};

const base = (overrides: Partial<ComposeTemplateInputs> = {}): ComposeTemplateInputs => ({
  ref: 'abcdefghij0123456789',
  name: 'corpus',
  apex: 'supastack.example.com',
  ports: {
    kong: 30000,
    studio: 30001,
    postgres: 30002,
    pooler: 30003,
    analytics: 30004,
    dbDirect: 30005,
  },
  secrets: { ...SECRETS },
  config: { enableSignup: true, jwtExpirySec: 3600 },
  studioImage: 'kmhariharasudhan/supastack-studio:test',
  templateDir: REAL_TEMPLATE_DIR,
  outDir: '/tmp/unused-by-renderInstanceEnv',
  ...overrides,
});

export interface GoldenCase {
  /** File name stem — the golden lives at `<stem>.env`. */
  id: string;
  /** Why this case is in the corpus. */
  why: string;
  inputs: ComposeTemplateInputs;
}

export const GOLDEN_CASES: GoldenCase[] = [
  {
    id: 'minimal',
    why: 'no SMTP block — the default provisioning shape, exercises the upstream stub values',
    inputs: base(),
  },
  {
    id: 'full-smtp',
    why: 'every operator-supplied field populated — the untrusted-input surface at its widest',
    inputs: base({
      name: 'Acme Analytics',
      smtp: {
        host: 'smtp.mailgun.org',
        port: 587,
        user: 'postmaster@mail.acme.example',
        password: 'MailgunPassw0rd',
      },
    }),
  },
  {
    id: 'unicode-name',
    why: 'non-ASCII plus interior spaces — must survive untouched (research Q5 case E)',
    inputs: base({ name: 'Ünïcode Prøject 日本' }),
  },
  {
    id: 'name-with-spaces',
    why: 'the plan Risk 2 / research Q5 case — an ordinary human-readable name',
    inputs: base({ name: 'My Project' }),
  },
  {
    id: 'long-name',
    why: 'the schema maximum (100 chars) — nothing truncates or wraps',
    inputs: base({ name: 'L'.repeat(100) }),
  },
  {
    id: 'optionals-empty',
    why: 'signup disabled, non-default expiry, single-char name — the other end of every toggle',
    inputs: base({ name: 'x', config: { enableSignup: false, jwtExpirySec: 60 } }),
  },
];
