import { describe, expect, test, beforeAll } from 'vitest';
import { mkdtemp, writeFile, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import {
  renderInstanceEnv,
  renderVectorConfig,
  type ComposeTemplateInputs,
} from '../src/compose-template.js';

/**
 * Anti-Multibase regression test suite. Three concrete failures we observed:
 *  1. The dashboard provisioner produced an .env missing ~20 variables that
 *     the upstream Compose references (e.g., DOCKER_SOCKET_LOCATION).
 *  2. `POSTGRES_PASSWORD=...$GINIWZBA8` — Docker Compose substituted $GINIWZBA8
 *     to empty.
 *  3. DOCKER_SOCKET_LOCATION env was empty → `:/var/run/docker.sock:ro,z:
 *     empty section between colons` on `compose up`.
 *
 * These tests guarantee none of those can ship.
 */

let templateDir: string;

const baseInputs = (overrides: Partial<ComposeTemplateInputs> = {}): ComposeTemplateInputs => ({
  ref: 'abcdefghij0123456789',
  name: 'test',
  apex: 'selfbase.example.com',
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
  studioImage: 'selfbase/studio:test',
  templateDir,
  outDir: '/tmp/unused',
  ...overrides,
});

beforeAll(async () => {
  // Stand up a minimal upstream-shaped .env.example that references a small
  // set of vars (incl. DOCKER_SOCKET_LOCATION) so we can assert completeness.
  templateDir = await mkdtemp(path.join(tmpdir(), 'compose-tmpl-'));
  const envExample = [
    '# Test fixture mimicking upstream supabase/docker/.env.example',
    'POSTGRES_PASSWORD=your-super-secret-password',
    'JWT_SECRET=your-jwt-secret',
    'ANON_KEY=your-anon-key',
    'SERVICE_ROLE_KEY=your-service-role-key',
    'DASHBOARD_USERNAME=supabase',
    'DASHBOARD_PASSWORD=this_password_is_insecure_and_should_be_updated',
    'SECRET_KEY_BASE=UpNgUHJtAUS6/Sg3RUTzVAlb4hT8GTRX3GjEoCZeyM4ZkFvuO9oa9zCBKQyMtmGhfhpcjOu/0FzWcrCYbCxnIA==',
    'VAULT_ENC_KEY=your-encryption-key-32-chars-min',
    'POSTGRES_HOST=db',
    'POSTGRES_DB=postgres',
    'POSTGRES_PORT=5432',
    'POSTGRES_USER=postgres',
    'POOLER_PROXY_PORT_TRANSACTION=6543',
    'POOLER_DEFAULT_POOL_SIZE=20',
    'POOLER_MAX_CLIENT_CONN=100',
    'POOLER_TENANT_ID=your-tenant-id',
    'KONG_HTTP_PORT=8000',
    'KONG_HTTPS_PORT=8443',
    'PGRST_DB_SCHEMAS=public,storage,graphql_public',
    'SITE_URL=http://localhost:3000',
    'ADDITIONAL_REDIRECT_URLS=',
    'JWT_EXPIRY=3600',
    'DISABLE_SIGNUP=false',
    'API_EXTERNAL_URL=http://localhost:8000',
    'MAILER_URLPATHS_CONFIRMATION=/auth/v1/verify',
    'MAILER_URLPATHS_INVITE=/auth/v1/verify',
    'MAILER_URLPATHS_RECOVERY=/auth/v1/verify',
    'MAILER_URLPATHS_EMAIL_CHANGE=/auth/v1/verify',
    'ENABLE_EMAIL_SIGNUP=true',
    'ENABLE_EMAIL_AUTOCONFIRM=false',
    'SMTP_ADMIN_EMAIL=admin@example.com',
    'SMTP_HOST=supabase-mail',
    'SMTP_PORT=2500',
    'SMTP_USER=fake_mail_user',
    'SMTP_PASS=fake_mail_password',
    'SMTP_SENDER_NAME=fake_sender',
    'ENABLE_ANONYMOUS_USERS=false',
    'ENABLE_PHONE_SIGNUP=true',
    'ENABLE_PHONE_AUTOCONFIRM=true',
    'STUDIO_DEFAULT_ORGANIZATION=Default Organization',
    'STUDIO_DEFAULT_PROJECT=Default Project',
    'STUDIO_PORT=3000',
    'SUPABASE_PUBLIC_URL=http://localhost:8000',
    'IMGPROXY_ENABLE_WEBP_DETECTION=true',
    'FUNCTIONS_VERIFY_JWT=false',
    'LOGFLARE_PUBLIC_ACCESS_TOKEN=your-super-secret-and-long-logflare-key-public',
    'LOGFLARE_PRIVATE_ACCESS_TOKEN=your-super-secret-and-long-logflare-key-private',
    'DOCKER_SOCKET_LOCATION=/var/run/docker.sock',
    'GOOGLE_PROJECT_ID=GOOGLE_PROJECT_ID',
    'GOOGLE_PROJECT_NUMBER=GOOGLE_PROJECT_NUMBER',
    'PG_META_CRYPTO_KEY=your-pg-meta-crypto-key',
    'S3_PROTOCOL_ACCESS_KEY_ID=your-s3-access-key',
    'S3_PROTOCOL_ACCESS_KEY_SECRET=your-s3-secret',
    'MINIO_ROOT_PASSWORD=your-super-secret-minio-pw',
    '',
  ].join('\n');

  await writeFile(path.join(templateDir, '.env.example'), envExample);
});

describe('renderInstanceEnv — happy path', () => {
  test('emits all referenced variables with non-undefined values', async () => {
    const out = await renderInstanceEnv(baseInputs());
    // Every line is KEY=VALUE.
    const keys = out
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.slice(0, l.indexOf('=')));
    expect(keys).toContain('DOCKER_SOCKET_LOCATION');
    expect(keys).toContain('POSTGRES_PASSWORD');
    expect(keys).toContain('ANON_KEY');
    expect(keys).toContain('SERVICE_ROLE_KEY');
    expect(keys).toContain('PGRST_DB_SCHEMAS');
  });

  test('DOCKER_SOCKET_LOCATION is /var/run/docker.sock (anti-Multibase empty-value bug)', async () => {
    const out = await renderInstanceEnv(baseInputs());
    expect(out).toMatch(/^DOCKER_SOCKET_LOCATION=\/var\/run\/docker\.sock$/m);
  });

  test('SUPABASE_PUBLIC_URL uses https://<ref>.<apex>', async () => {
    const out = await renderInstanceEnv(baseInputs({ ref: 'aaaaaaaaaaaaaaaaaaaa', apex: 'x.io' }));
    expect(out).toMatch(/^SUPABASE_PUBLIC_URL=https:\/\/aaaaaaaaaaaaaaaaaaaa\.x\.io$/m);
  });

  test('POSTGRES_HOST is internal "db" (feature 005: sibling containers connect direct)', async () => {
    const out = await renderInstanceEnv(
      baseInputs({ ref: 'abcdefghijklmnopqrst', apex: 'selfbase.example.com' }),
    );
    expect(out).toMatch(/^POSTGRES_HOST=db$/m);
  });

  test('POSTGRES_DIRECT_HOST_PORT is set from ports.dbDirect (feature 005)', async () => {
    const out = await renderInstanceEnv(baseInputs());
    expect(out).toMatch(/^POSTGRES_DIRECT_HOST_PORT=30005$/m);
  });

  test('output is sorted (deterministic diffs)', async () => {
    const out = await renderInstanceEnv(baseInputs());
    const keys = out
      .split('\n')
      .filter((l) => l.trim())
      .map((l) => l.slice(0, l.indexOf('=')));
    const sorted = [...keys].sort();
    expect(keys).toEqual(sorted);
  });
});

describe('renderInstanceEnv — anti-Multibase regressions', () => {
  test('rejects POSTGRES_PASSWORD containing $ (the huntvox failure)', async () => {
    const bad = baseInputs();
    bad.secrets.postgresPassword = 'UcCyyUTjHzqFxigbFiME5u$GINIWZBA8';
    await expect(renderInstanceEnv(bad)).rejects.toThrow(/POSTGRES_PASSWORD/);
  });

  test('rejects DASHBOARD_PASSWORD containing backtick', async () => {
    const bad = baseInputs();
    bad.secrets.dashboardPassword = 'has`tick';
    await expect(renderInstanceEnv(bad)).rejects.toThrow();
  });

  test('rejects JWT_SECRET containing whitespace', async () => {
    const bad = baseInputs();
    bad.secrets.jwtSecret = 'has space';
    await expect(renderInstanceEnv(bad)).rejects.toThrow();
  });
});

describe('renderInstanceEnv — completeness assertion', () => {
  test('throws if upstream .env.example references a variable we did not provide', async () => {
    // Add a fake variable to the template that the templater doesn't know.
    const tmpTemplate = await mkdtemp(path.join(tmpdir(), 'tmpl-extra-'));
    await writeFile(
      path.join(tmpTemplate, '.env.example'),
      'DOCKER_SOCKET_LOCATION=/var/run/docker.sock\nA_BRAND_NEW_FAKE_VAR=hello\n',
    );

    await expect(renderInstanceEnv(baseInputs({ templateDir: tmpTemplate }))).rejects.toThrow(
      /A_BRAND_NEW_FAKE_VAR/,
    );

    await rm(tmpTemplate, { recursive: true });
  });
});

// Minimal slice of the vendored vanilla vector.yml (source + router) — the parts
// renderVectorConfig rewrites. Mirrors infra/supabase-template/volumes/logs/vector.yml.
const VANILLA_VECTOR = `sources:
  docker_host:
    type: docker_logs
    exclude_containers:
      - supabase-vector

transforms:
  project_logs:
    type: remap
    inputs:
      - docker_host
    source: |-
      .appname = del(.container_name)
  router:
    type: route
    inputs:
      - project_logs
    route:
      kong: '.appname == "supabase-kong" || .appname == "supabase-envoy"'
      auth: '.appname == "supabase-auth"'
      rest: '.appname == "supabase-rest"'
      realtime: '.appname == "realtime-dev.supabase-realtime"'
      storage: '.appname == "supabase-storage"'
      functions: '.appname == "supabase-edge-functions"'
      db: '.appname == "supabase-db"'
`;

describe('renderVectorConfig — supastack container-name routing', () => {
  const REF = 'abcdefghij0123456789';
  const out = () => renderVectorConfig(VANILLA_VECTOR, REF);

  test('rewrites every route condition to ref-qualified container names', () => {
    const o = out();
    expect(o).toContain(`kong: '.appname == "supastack-${REF}-kong-1"'`);
    expect(o).toContain(`auth: '.appname == "supastack-${REF}-auth-1"'`);
    expect(o).toContain(`rest: '.appname == "supastack-${REF}-rest-1"'`);
    expect(o).toContain(`realtime: '.appname == "supastack-${REF}-realtime-1"'`);
    expect(o).toContain(`storage: '.appname == "supastack-${REF}-storage-1"'`);
    // vanilla service "edge-functions" → supastack container "functions"
    expect(o).toContain(`functions: '.appname == "supastack-${REF}-functions-1"'`);
    expect(o).toContain(`db: '.appname == "supastack-${REF}-db-1"'`);
  });

  test('scopes docker_logs to this project + excludes its own vector', () => {
    const o = out();
    expect(o).toContain(`include_containers:\n      - supastack-${REF}-`);
    expect(o).toContain(`exclude_containers:\n      - supastack-${REF}-vector-1`);
  });

  test('leaves NO vanilla supabase-*/realtime-dev appname condition behind', () => {
    expect(out()).not.toMatch(/\.appname == "(supabase-|realtime-dev)/);
  });

  test('throws if an expected route condition is missing (guards silent log-drop)', () => {
    const broken = VANILLA_VECTOR.replace(`auth: '.appname == "supabase-auth"'`, 'auth: removed');
    expect(() => renderVectorConfig(broken, REF)).toThrow(/route condition not found/);
  });

  test('throws if the docker_logs source block is missing', () => {
    const broken = VANILLA_VECTOR.replace('      - supabase-vector', '      - other');
    expect(() => renderVectorConfig(broken, REF)).toThrow(/docker_logs source block not found/);
  });

  // Drift guard: runs against the ACTUAL vendored template. If a future re-vendor
  // changes the vector.yml route/source strings, renderVectorConfig throws here —
  // failing CI loudly instead of silently re-dropping every project's logs.
  test('transforms the real vendored template without leaving vanilla names', async () => {
    const real = await readFile(
      new URL('../../../infra/supabase-template/volumes/logs/vector.yml', import.meta.url),
      'utf8',
    );
    const o = renderVectorConfig(real, REF);
    expect(o).toContain(`auth: '.appname == "supastack-${REF}-auth-1"'`);
    expect(o).toContain(`functions: '.appname == "supastack-${REF}-functions-1"'`);
    expect(o).toContain(`include_containers:\n      - supastack-${REF}-`);
    expect(o).not.toMatch(/\.appname == "(supabase-|realtime-dev)/);
  });
});
