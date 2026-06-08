import { promises as fs } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { assertSafeForEnv } from '@supastack/crypto';

/**
 * Inputs accepted by the per-instance .env generator. Every value is typed
 * — the templater never accepts a free-form string→string map.
 */
export interface ComposeTemplateInputs {
  /** 20-char ref */
  ref: string;
  name: string;
  apex: string; // e.g., "selfbase.example.com"
  /** Allocated host ports */
  ports: {
    kong: number;
    studio: number;
    postgres: number;
    pooler: number;
    analytics: number;
    /** Host port for the per-instance db (feature 005). The top-level
     *  pg-edge-proxy in the api container connects via host.docker.internal:<port>. */
    dbDirect: number;
  };
  /** Decrypted per-instance secrets */
  secrets: {
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
  };
  config: {
    enableSignup: boolean;
    jwtExpirySec: number;
  };
  /** Optional SMTP config from create-time form */
  smtp?: {
    host: string;
    port: number;
    user: string;
    password: string;
  };
  /** Studio image to use */
  studioImage: string;
  /** Path to the vendored supabase template directory */
  templateDir: string;
  /** Output directory where the per-instance compose stack will live */
  outDir: string;
}

/**
 * Generate the per-instance .env from a typed input struct. Strict checks:
 *  - every variable referenced in the upstream `.env.example` MUST be present
 *  - no value may contain $, backtick, backslash, quote, whitespace
 *  - `docker compose --env-file <env> config -q` must round-trip cleanly
 */
export async function renderInstanceEnv(inputs: ComposeTemplateInputs): Promise<string> {
  const { secrets, ports, config, smtp, ref, name, apex, studioImage } = inputs;

  // 1. Hard guard: every secret + password is safe for an env file (anti-Multibase).
  assertSafeForEnv(secrets.postgresPassword, 'POSTGRES_PASSWORD');
  assertSafeForEnv(secrets.dashboardPassword, 'DASHBOARD_PASSWORD');
  assertSafeForEnv(secrets.jwtSecret, 'JWT_SECRET');
  assertSafeForEnv(secrets.secretKeyBase, 'SECRET_KEY_BASE');
  assertSafeForEnv(secrets.vaultEncKey, 'VAULT_ENC_KEY');
  assertSafeForEnv(secrets.pgMetaCryptoKey, 'PG_META_CRYPTO_KEY');
  assertSafeForEnv(secrets.s3ProtocolAccessKeyId, 'S3_PROTOCOL_ACCESS_KEY_ID');
  assertSafeForEnv(secrets.s3ProtocolAccessKeySecret, 'S3_PROTOCOL_ACCESS_KEY_SECRET');
  assertSafeForEnv(secrets.minioRootPassword, 'MINIO_ROOT_PASSWORD');
  assertSafeForEnv(secrets.logflarePublicAccessToken, 'LOGFLARE_PUBLIC_ACCESS_TOKEN');
  assertSafeForEnv(secrets.logflarePrivateAccessToken, 'LOGFLARE_PRIVATE_ACCESS_TOKEN');

  // 2. Read upstream .env.example as the source-of-truth for required vars.
  const envExamplePath = path.join(inputs.templateDir, '.env.example');
  const envExample = await fs.readFile(envExamplePath, 'utf8');
  const referencedVars = parseEnvKeys(envExample);

  // 3. Build the value map. KEY: every var the upstream compose references
  //    MUST have an entry (even empty string).
  const url = `https://${ref}.${apex}`;
  const values: Record<string, string | number> = {
    // Identity
    PROJECT_REF: ref,
    STUDIO_DEFAULT_ORGANIZATION: name,
    STUDIO_DEFAULT_PROJECT: name,

    // Secrets
    JWT_SECRET: secrets.jwtSecret,
    ANON_KEY: secrets.anonKey,
    SERVICE_ROLE_KEY: secrets.serviceRoleKey,
    POSTGRES_PASSWORD: secrets.postgresPassword,
    DASHBOARD_USERNAME: 'supabase',
    DASHBOARD_PASSWORD: secrets.dashboardPassword,
    SECRET_KEY_BASE: secrets.secretKeyBase,
    VAULT_ENC_KEY: secrets.vaultEncKey,
    LOGFLARE_PUBLIC_ACCESS_TOKEN: secrets.logflarePublicAccessToken,
    LOGFLARE_PRIVATE_ACCESS_TOKEN: secrets.logflarePrivateAccessToken,
    PG_META_CRYPTO_KEY: secrets.pgMetaCryptoKey,
    S3_PROTOCOL_ACCESS_KEY_ID: secrets.s3ProtocolAccessKeyId,
    S3_PROTOCOL_ACCESS_KEY_SECRET: secrets.s3ProtocolAccessKeySecret,
    MINIO_ROOT_PASSWORD: secrets.minioRootPassword,

    // Ports
    // Caddy terminates TLS for every per-instance subdomain, so Kong only
    // needs its HTTP port published. The HTTPS port (8443) used to be
    // mapped to STUDIO_PORT's numeric slot, swallowing Studio's host
    // binding and producing "400 Bad Request — plain HTTP sent to HTTPS
    // port" when Caddy proxied /studio to it.
    KONG_HTTP_PORT: ports.kong,
    // We don't publish Kong's HTTPS port (Caddy fronts TLS for everyone),
    // but the upstream .env.example declares the key and the completeness
    // assertion below requires every declared key to have a value. Stick
    // with the upstream default; nothing reaches the container on this
    // port from outside.
    KONG_HTTPS_PORT: 8443,
    STUDIO_PORT: ports.studio,
    // POSTGRES_PORT is the INTERNAL Docker network port — all sibling
    // containers (auth, rest, etc.) connect to db:5432 via this.
    POSTGRES_PORT: 5432,
    // Host port where db:5432 is published, used by the top-level
    // pg-edge-proxy in the api container (feature 005).
    POSTGRES_DIRECT_HOST_PORT: ports.dbDirect,
    // POOLER_PROXY_PORT_TRANSACTION is referenced by upstream .env.example;
    // unused now that the per-instance supavisor service is removed
    // (feature 005). Kept as a dead value to satisfy completeness check.
    POOLER_PROXY_PORT_TRANSACTION: ports.pooler,
    LOGFLARE_PORT: ports.analytics,

    // URLs
    SUPABASE_PUBLIC_URL: url,
    API_EXTERNAL_URL: url,
    SITE_URL: url,
    ADDITIONAL_REDIRECT_URLS: '',

    // Auth / feature flags
    DISABLE_SIGNUP: config.enableSignup ? 'false' : 'true',
    JWT_EXPIRY: config.jwtExpirySec,
    ENABLE_EMAIL_SIGNUP: 'true',
    ENABLE_EMAIL_AUTOCONFIRM: 'false',
    ENABLE_ANONYMOUS_USERS: 'false',
    ENABLE_PHONE_SIGNUP: 'false',
    ENABLE_PHONE_AUTOCONFIRM: 'false',

    // SMTP — use upstream stub values when not configured so gotrue's
    // envconfig (which int-parses SMTP_PORT) doesn't refuse to boot. SMTP
    // send attempts will fail gracefully when the user triggers auth flows,
    // but the rest of the instance (REST/Realtime/Studio) runs fine.
    SMTP_ADMIN_EMAIL: smtp?.user ?? 'admin@example.com',
    SMTP_HOST: smtp?.host ?? 'supabase-mail',
    SMTP_PORT: smtp?.port ?? 2500,
    SMTP_USER: smtp?.user ?? 'fake_mail_user',
    SMTP_PASS: smtp?.password ?? 'fake_mail_password',
    SMTP_SENDER_NAME: name,
    MAILER_URLPATHS_INVITE: '/auth/v1/verify',
    MAILER_URLPATHS_CONFIRMATION: '/auth/v1/verify',
    MAILER_URLPATHS_RECOVERY: '/auth/v1/verify',
    MAILER_URLPATHS_EMAIL_CHANGE: '/auth/v1/verify',

    // DB — internal Docker network hostname. ALL per-instance containers
    // (supavisor, auth, rest, storage, etc.) use this to connect to the
    // per-instance Postgres on the docker network.
    //
    // NOTE: this also drives Studio's Direct Connection panel display, which
    // means Studio shows 'db:5432' (internal). Fixing the display to show
    // the public 'db.<ref>.<apex>:5432' requires a separate env var that
    // the upstream Studio image reads — tracked as a follow-up issue. The
    // initial attempt to set POSTGRES_HOST=db.<ref>.<apex> broke supavisor
    // and all sibling container connections.
    POSTGRES_HOST: 'db',
    POSTGRES_DB: 'postgres',
    POSTGRES_USER: 'postgres',
    PGRST_DB_SCHEMAS: 'public,storage,graphql_public',
    POOLER_DEFAULT_POOL_SIZE: '20',
    POOLER_MAX_CLIENT_CONN: '100',
    POOLER_TENANT_ID: ref,

    // Docker / system
    DOCKER_SOCKET_LOCATION: '/var/run/docker.sock', // the var Multibase forgot
    FUNCTIONS_VERIFY_JWT: 'false',
    IMGPROXY_ENABLE_WEBP_DETECTION: 'true',
    STUDIO_IMAGE: studioImage,

    // Optional integrations — present but empty by default (operators configure later).
    GOOGLE_PROJECT_ID: '',
    GOOGLE_PROJECT_NUMBER: '',

    // Newer upstream additions (post-vendor refresh) — empty/sane defaults.
    ANON_KEY_ASYMMETRIC: '',
    SERVICE_ROLE_KEY_ASYMMETRIC: '',
    SUPABASE_PUBLISHABLE_KEY: '',
    SUPABASE_SECRET_KEY: '',
    JWT_JWKS: '',
    JWT_KEYS: '',
    CERTBOT_EMAIL: '',
    GLOBAL_S3_BUCKET: 'local',
    MINIO_ROOT_USER: 'supabase',
    STORAGE_TENANT_ID: ref,
    IMGPROXY_AUTO_WEBP: 'true',
    OPENAI_API_KEY: '',
    PGRST_DB_EXTRA_SEARCH_PATH: 'public',
    PGRST_DB_MAX_ROWS: '1000',
    POOLER_DB_POOL_SIZE: '5',
    PROXY_DOMAIN: '',
    REGION: 'local',
  };

  // 4. Completeness assertion (anti-Multibase missing-vars regression).
  const missing = [...referencedVars].filter((v) => !(v in values));
  if (missing.length > 0) {
    throw new Error(
      `compose-template: ${missing.length} variable(s) referenced by the upstream template have no value: ${missing.sort().join(', ')}`,
    );
  }

  // 5. Emit. Keys are sorted for deterministic diffs.
  const keys = Object.keys(values).sort();
  return keys.map((k) => `${k}=${values[k]}`).join('\n') + '\n';
}

/**
 * Write the per-instance compose stack to disk and run `docker compose config -q`
 * to verify it parses. Returns the resolved instance directory.
 */
export async function writeInstanceStack(inputs: ComposeTemplateInputs): Promise<string> {
  const env = await renderInstanceEnv(inputs);
  await fs.mkdir(inputs.outDir, { recursive: true });

  // Copy the entire template directory into the per-instance dir.
  await copyDir(inputs.templateDir, inputs.outDir, ['.env.example']); // we replace .env.example

  // Write the rendered .env (mode 0600 — secrets at rest on disk).
  await fs.writeFile(path.join(inputs.outDir, '.env'), env, { mode: 0o600 });

  // Round-trip with `docker compose config -q`.
  await dockerComposeConfigCheck(inputs.outDir);

  return inputs.outDir;
}

// ─── helpers ────────────────────────────────────────────────────────────────

function parseEnvKeys(envExampleContent: string): Set<string> {
  const out = new Set<string>();
  for (const line of envExampleContent.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq < 1) continue;
    out.add(trimmed.slice(0, eq).trim());
  }
  return out;
}

async function copyDir(src: string, dst: string, skipFiles: string[]): Promise<void> {
  await fs.mkdir(dst, { recursive: true });
  const entries = await fs.readdir(src, { withFileTypes: true });
  for (const entry of entries) {
    if (skipFiles.includes(entry.name)) continue;
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      await copyDir(srcPath, dstPath, []);
    } else if (entry.isFile()) {
      await fs.copyFile(srcPath, dstPath);
    }
    // Symlinks intentionally skipped
  }
}

async function dockerComposeConfigCheck(dir: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn('docker', ['compose', '--env-file', '.env', 'config', '-q'], {
      cwd: dir,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stderr = '';
    child.stderr.on('data', (b) => (stderr += b.toString()));
    child.on('error', (err) => reject(new Error(`docker compose not available: ${err.message}`)));
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`docker compose config -q failed (exit ${code}): ${stderr.trim()}`));
    });
  });
}
