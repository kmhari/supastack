/**
 * Writer 1 (provision) after migration onto the unified writer — feature 121
 * T012, US1.
 *
 * The pre-existing suite at `tests/compose-template.test.ts` covers the
 * anti-Multibase regressions on the eleven generated secrets. This file covers
 * what changed: the ~50 values that were NOT guarded before, and the promise
 * that a rejection happens before anything is created on disk (C4).
 *
 * Byte-identity for well-formed input is asserted by `env-golden.test.ts`
 * against the corpus captured before this migration; the case below re-asserts
 * it through the public entry point so a reader of this file sees the claim.
 */
import { describe, expect, test, beforeAll } from 'vitest';
import { mkdtemp, writeFile, readFile, rm, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  renderInstanceEnv,
  writeInstanceStack,
  type ComposeTemplateInputs,
} from '../../src/compose-template.js';
import { GOLDEN_CASES, GOLDEN_DIR } from '../fixtures/env-golden/corpus.js';
import { assertNoSecretInMessage, captureThrow, parseEnvBack } from '../helpers/env-assert.js';

let templateDir: string;

/** Minimal upstream-shaped `.env.example` — only the vars these cases touch. */
const ENV_EXAMPLE = [
  'POSTGRES_PASSWORD=x',
  'JWT_SECRET=x',
  'STUDIO_DEFAULT_ORGANIZATION=Default Organization',
  'SMTP_HOST=supabase-mail',
  'SMTP_USER=fake_mail_user',
  'SMTP_PASS=fake_mail_password',
  'DOCKER_SOCKET_LOCATION=/var/run/docker.sock',
  '',
].join('\n');

const inputs = (overrides: Partial<ComposeTemplateInputs> = {}): ComposeTemplateInputs => ({
  ref: 'abcdefghij0123456789',
  name: 'test',
  apex: 'supastack.example.com',
  ports: {
    kong: 30000,
    studio: 30001,
    postgres: 30002,
    pooler: 30003,
    analytics: 30004,
    dbDirect: 30005,
  },
  secrets: {
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
  },
  config: { enableSignup: true, jwtExpirySec: 3600 },
  studioImage: 'kmhariharasudhan/supastack-studio:test',
  templateDir,
  outDir: '/tmp/unused-by-renderInstanceEnv',
  ...overrides,
});

const smtp = (overrides: Partial<NonNullable<ComposeTemplateInputs['smtp']>> = {}) => ({
  host: 'smtp.mailgun.org',
  port: 587,
  user: 'postmaster@mail.example',
  password: 'MailgunPassw0rd',
  ...overrides,
});

beforeAll(async () => {
  templateDir = await mkdtemp(path.join(tmpdir(), 'compose-tmpl-121-'));
  await writeFile(path.join(templateDir, '.env.example'), ENV_EXAMPLE);
});

describe('writer 1 — happy path', () => {
  test('an ordinary name with a space still provisions (plan Risk 2 / research Q5)', async () => {
    const out = await renderInstanceEnv(inputs({ name: 'My Project' }));
    expect(out).toMatch(/^STUDIO_DEFAULT_ORGANIZATION=My Project$/m);
    expect(out).toMatch(/^SMTP_SENDER_NAME=My Project$/m);
  });

  test('output parses back to exactly the pairs it declares (FR-006)', async () => {
    const out = await renderInstanceEnv(inputs({ name: 'Acme Analytics', smtp: smtp() }));
    const { entries, map } = parseEnvBack(out);
    expect(new Set(entries.map((e) => e.name)).size).toBe(entries.length);
    expect(map.SMTP_HOST).toBe('smtp.mailgun.org');
    expect(map.SMTP_USER).toBe('postmaster@mail.example');
    expect(map.STUDIO_DEFAULT_PROJECT).toBe('Acme Analytics');
  });

  test('renders byte-identically to the pre-change corpus (SC-003 / C6)', async () => {
    const full = GOLDEN_CASES.find((c) => c.id === 'full-smtp');
    expect(full).toBeDefined();
    const rendered = await renderInstanceEnv(full!.inputs);
    expect(rendered).toBe(await readFile(path.join(GOLDEN_DIR, 'full-smtp.env'), 'utf8'));
  });
});

describe('writer 1 — sad path: the values that used to bypass the guard', () => {
  test('a line break in name is refused (SEC-064 — the COMPOSE_FILE redirect)', async () => {
    const payload = 'proj\nCOMPOSE_FILE=/tmp/attacker.yml';
    const err = await captureThrow(() => renderInstanceEnv(inputs({ name: payload })));
    expect((err as Error).message).toMatch(
      /STUDIO_DEFAULT_(ORGANIZATION|PROJECT)|SMTP_SENDER_NAME/,
    );
    expect((err as Error).message).not.toContain('COMPOSE_FILE');
  });

  test('a $ in smtp.host is refused (SEC-065 — host-env expansion)', async () => {
    const payload = 'smtp.${MASTER_KEY}.example';
    const err = await captureThrow(() =>
      renderInstanceEnv(inputs({ smtp: smtp({ host: payload }) })),
    );
    assertNoSecretInMessage(err, payload, 'SMTP_HOST');
  });

  test('a backtick in smtp.user is refused', async () => {
    await expect(
      renderInstanceEnv(inputs({ smtp: smtp({ user: 'user`whoami`' }) })),
    ).rejects.toThrow(/SMTP_/);
  });

  test('a quote in smtp.password is refused, and the password is not echoed', async () => {
    const payload = 'pa"ssword-that-must-not-leak';
    const err = await captureThrow(() =>
      renderInstanceEnv(inputs({ smtp: smtp({ password: payload }) })),
    );
    assertNoSecretInMessage(err, payload, 'SMTP_PASS');
  });

  test('a generated secret with a space is still refused — the strict rule survived', async () => {
    const bad = inputs();
    bad.secrets.jwtSecret = 'has space';
    await expect(renderInstanceEnv(bad)).rejects.toThrow(/JWT_SECRET/);
  });

  test('a name whose trailing space Compose would strip is refused', async () => {
    await expect(renderInstanceEnv(inputs({ name: 'Trailing ' }))).rejects.toThrow();
  });
});

describe('writer 1 — rejection creates nothing on disk (FR-003 / C4)', () => {
  test('writeInstanceStack leaves no instance directory behind when a value is refused', async () => {
    const parent = await mkdtemp(path.join(tmpdir(), 'compose-out-121-'));
    const outDir = path.join(parent, 'abcdefghij0123456789');

    await expect(
      writeInstanceStack(inputs({ name: 'proj\nCOMPOSE_FILE=/tmp/attacker.yml', outDir })),
    ).rejects.toThrow();

    await expect(access(outDir)).rejects.toThrow();
    await rm(parent, { recursive: true });
  });
});
