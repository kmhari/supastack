// selfbase-functions-main:v3
//
// Vault-backed envVars injection. User-managed secrets live in per-project
// `vault.secrets` (single source of truth). The runtime fetches them with a
// short in-process TTL cache and passes them via `envVars` to
// EdgeRuntime.userWorkers.create() — so `Deno.env.get('OPENAI_API_KEY')` in
// user code returns the live vault value without ever restarting this
// container.
//
// Spec: specs/010-secrets-management — research.md Decision 3 + FR-014/015/016.
// Also continues to support eszip-aware loading from selfbase feature 003 US3.
import * as jose from 'https://deno.land/x/jose@v4.14.4/index.ts'
import { Client as PgClient } from 'https://deno.land/x/postgres@v0.19.3/mod.ts'

console.log('main function started (selfbase-functions-main:v3 — vault-backed envVars)')

const JWT_SECRET = Deno.env.get('JWT_SECRET')
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')
const VERIFY_JWT = Deno.env.get('VERIFY_JWT') === 'true'

// ─── Vault injection (feature 010) ───────────────────────────────────────────
//
// Read user-managed secrets from per-project Postgres `vault.decrypted_secrets`
// with a 5-second TTL cache. Cache invalidation is passive (no Redis, no HTTP
// poke) — propagation budget is one TTL window. Reserved names are filtered
// out at injection time as defense in depth (api also rejects them at write).

const VAULT_DB_URL =
  Deno.env.get('SELFBASE_VAULT_DB_URL') ?? Deno.env.get('SUPABASE_DB_URL') ?? ''
const VAULT_TTL_MS = parseInt(Deno.env.get('SELFBASE_VAULT_TTL_MS') ?? '5000', 10)
const PROJECT_REF = Deno.env.get('SB_REF') ?? 'unknown-ref'

// Load reserved names from JSON materialized by packages/shared/scripts/...
// Use absolute path: edge-runtime compiles source into /var/tmp/sb-compile-edge-runtime/
// at startup, so `import.meta.url` doesn't resolve back to the volume mount.
// The mount is always at /home/deno/functions/main (per docker-compose).
let RESERVED_NAMES: ReadonlySet<string> = new Set()
try {
  const reservedRaw = await Deno.readTextFile(
    '/home/deno/functions/main/reserved-secrets.json',
  )
  const parsed = JSON.parse(reservedRaw) as { reserved: string[] }
  RESERVED_NAMES = new Set(parsed.reserved)
  console.log(
    `[selfbase-vault] loaded ${RESERVED_NAMES.size} reserved names (will be filtered from vault injection)`,
  )
} catch (e) {
  console.warn(
    `[selfbase-vault] reserved-secrets.json not loaded (${(e as Error).message}); reserved-name guard inactive — relying on api write-time guard only`,
  )
}

type VaultCache = { ts: number; envVars: Record<string, string> }
let vaultCache: VaultCache | null = null
let inflightRefresh: Promise<Record<string, string>> | null = null

async function refreshVault(): Promise<Record<string, string>> {
  if (!VAULT_DB_URL) {
    // No DB URL configured — empty injection, single warning.
    if (!vaultCache) {
      console.warn(
        `[selfbase-vault] no SELFBASE_VAULT_DB_URL/SUPABASE_DB_URL configured; user secrets unavailable for ${PROJECT_REF}`,
      )
    }
    return {}
  }
  const client = new PgClient(VAULT_DB_URL)
  const started = Date.now()
  try {
    await client.connect()
    // vault.create_secret() leaves key_id NULL by design; filter by name presence.
    const res = await client.queryObject<{ name: string; decrypted_secret: string }>(
      "SELECT name, decrypted_secret FROM vault.decrypted_secrets WHERE name IS NOT NULL",
    )
    const fresh: Record<string, string> = {}
    let filtered = 0
    for (const row of res.rows) {
      if (RESERVED_NAMES.has(row.name)) {
        filtered++
        continue
      }
      fresh[row.name] = row.decrypted_secret
    }
    const durationMs = Date.now() - started
    console.log(
      `[selfbase-vault] refreshed ${res.rows.length} secrets (filtered ${filtered} reserved) for ${PROJECT_REF} in ${durationMs}ms`,
    )
    return fresh
  } finally {
    try { await client.end() } catch { /* swallow */ }
  }
}

async function getEnvVars(): Promise<Record<string, string>> {
  const now = Date.now()
  if (vaultCache && now - vaultCache.ts < VAULT_TTL_MS) {
    return vaultCache.envVars
  }
  // Single in-flight refresh promise — concurrent callers during a miss
  // share one DB query (request coalescing, SC-010).
  if (!inflightRefresh) {
    inflightRefresh = (async () => {
      try {
        const fresh = await refreshVault()
        vaultCache = { ts: Date.now(), envVars: fresh }
        return fresh
      } catch (err) {
        const cachedNames = vaultCache ? Object.keys(vaultCache.envVars) : []
        if (vaultCache) {
          console.warn(
            `[selfbase-vault] refresh failed for ${PROJECT_REF}; serving ${cachedNames.length} cached secrets: ${(err as Error).message}`,
          )
          return vaultCache.envVars
        } else {
          console.error(
            `[selfbase-vault] refresh failed for ${PROJECT_REF}; no cache; worker will spawn with no user secrets: ${(err as Error).message}`,
          )
          return {}
        }
      } finally {
        inflightRefresh = null
      }
    })()
  }
  return await inflightRefresh
}

// Pre-warm the cache at boot — first request shouldn't pay the cold-cache penalty.
getEnvVars().catch(() => {/* logged inside */})

// Test-only export for the unit tests at main.test.ts. Production code
// shouldn't import this; it's reachable only via `if (Deno.env.get(...))`
// gates the test runner sets.
export const __selfbaseTest = { getEnvVars, refreshVault, resetCache: () => { vaultCache = null; inflightRefresh = null } }

// Create JWKS for ES256/RS256 tokens (newer tokens)
let SUPABASE_JWT_KEYS: ReturnType<typeof jose.createRemoteJWKSet> | null = null
if (SUPABASE_URL) {
  try {
    SUPABASE_JWT_KEYS = jose.createRemoteJWKSet(
      new URL('/auth/v1/.well-known/jwks.json', SUPABASE_URL)
    )
  } catch (e) {
    console.error('Failed to fetch JWKS from SUPABASE_URL:', e)
  }
}

function getAuthToken(req: Request) {
  const authHeader = req.headers.get('authorization')
  if (!authHeader) {
    throw new Error('Missing authorization header')
  }
  const [bearer, token] = authHeader.split(' ')
  if (bearer !== 'Bearer') {
    throw new Error(`Auth header is not 'Bearer {token}'`)
  }
  return token
}

async function isValidLegacyJWT(jwt: string): Promise<boolean> {
  if (!JWT_SECRET) {
    console.error('JWT_SECRET not available for HS256 token verification')
    return false
  }
  const encoder = new TextEncoder();
  const secretKey = encoder.encode(JWT_SECRET)
  try {
    await jose.jwtVerify(jwt, secretKey);
  } catch (e) {
    console.error('Symmetric Legacy JWT verification error', e);
    return false;
  }
  return true;
}

async function isValidJWT(jwt: string): Promise<boolean> {
  if (!SUPABASE_JWT_KEYS) {
    console.error('JWKS not available for ES256/RS256 token verification')
    return false
  }
  try {
    await jose.jwtVerify(jwt, SUPABASE_JWT_KEYS)
  } catch (e) {
    console.error('Asymmetric JWT verification error', e);
    return false
  }
  return true;
}

async function isValidHybridJWT(jwt: string): Promise<boolean> {
  const { alg: jwtAlgorithm } = jose.decodeProtectedHeader(jwt)
  if (jwtAlgorithm === 'HS256') {
    console.log(`Legacy token type detected, attempting ${jwtAlgorithm} verification.`)
    return await isValidLegacyJWT(jwt)
  }
  if (jwtAlgorithm === 'ES256' || jwtAlgorithm === 'RS256') {
    return await isValidJWT(jwt)
  }
  return false;
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'OPTIONS' && VERIFY_JWT) {
    try {
      const token = getAuthToken(req)
      const isValidJWT = await isValidHybridJWT(token);
      if (!isValidJWT) {
        return new Response(JSON.stringify({ msg: 'Invalid JWT' }), {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    } catch (e) {
      console.error(e)
      return new Response(JSON.stringify({ msg: e.toString() }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    }
  }

  const url = new URL(req.url)
  const { pathname } = url
  const path_parts = pathname.split('/')
  const service_name = path_parts[1]

  if (!service_name || service_name === '') {
    const error = { msg: 'missing function name in request' }
    return new Response(JSON.stringify(error), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const servicePath = `/home/deno/functions/${service_name}`
  console.error(`serving the request with ${servicePath}`)

  const memoryLimitMb = 150
  // Shorter worker timeout so envVars (vault secrets) refresh propagates
  // within the TTL window (5s). Without this, edge-runtime pools user
  // workers by servicePath for workerTimeoutMs and the first envVars map
  // sticks for that whole window — defeating vault-driven propagation.
  // Trade-off: more cold-starts under sustained load. For selfbase's
  // operator-facing secret-rotation UX this is the right call.
  const workerTimeoutMs = 4 * 1000
  const noModuleCache = false

  // ─── envVars: platform env merged with vault secrets ───────────────────────
  //
  // Order matters: vault first, then platform env on top, so reserved names
  // (SUPABASE_URL, JWT_SECRET, etc.) always win even if a stale vault row
  // somehow contains them. The reserved-name filter inside getEnvVars() is
  // belt; this merge order is suspenders.
  const platformEnv = Deno.env.toObject()
  const vaultEnv = await getEnvVars()
  const merged: Record<string, string> = { ...vaultEnv, ...platformEnv }
  const envVars = Object.keys(merged).map((k) => [k, merged[k]])

  // Per-function meta.json — written by selfbase's function-deploy service.
  // Indicates which form the function takes on disk: raw source files vs
  // a single .eszip bundle. Falls back to servicePath-loading if absent.
  let maybeEszip: Uint8Array | undefined = undefined
  let maybeEntrypoint: string | undefined = undefined
  let importMapPath: string | null = null
  try {
    const metaRaw = await Deno.readTextFile(`${servicePath}/meta.json`)
    const meta = JSON.parse(metaRaw)
    if (meta?.import_map_path) importMapPath = meta.import_map_path
    if (meta?.source_path === 'bundle.eszip') {
      maybeEszip = await Deno.readFile(`${servicePath}/bundle.eszip`)
      maybeEntrypoint = meta.entrypoint_path ?? undefined
      console.error(`loading ${service_name} from eszip (${maybeEszip.byteLength} bytes)`)
    }
  } catch (_e) {
    // No meta.json — legacy/raw-source path. Use servicePath as-is.
  }

  try {
    const opts: Record<string, unknown> = {
      servicePath,
      memoryLimitMb,
      workerTimeoutMs,
      noModuleCache,
      importMapPath,
      envVars,
    }
    if (maybeEszip) opts.maybeEszip = maybeEszip
    if (maybeEntrypoint) opts.maybeEntrypoint = maybeEntrypoint
    const worker = await EdgeRuntime.userWorkers.create(opts)
    return await worker.fetch(req)
  } catch (e) {
    const error = { msg: e.toString() }
    return new Response(JSON.stringify(error), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
