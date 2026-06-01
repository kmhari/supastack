/**
 * Studio IS_PLATFORM Mock API Server
 *
 * Core flow:
 *  - GoTrue auth endpoints (/token, /user, /mfa, etc.) — fully mocked with real JWTs
 *  - Profile / orgs / project → mock (hardcoded)
 *  - /platform/auth/{ref}/config → proxy to GoTrue /settings
 *  - /platform/pg-meta/{ref}/*  → proxy to pg-meta
 *  - Everything else            → 200 with empty/safe defaults + logged
 *
 * Env vars:
 *   PORT               default 4000
 *   KONG_URL           default http://localhost:8000
 *   GOTRUE_DIRECT_URL  e.g. http://192.168.80.7:9999 (preferred over Kong)
 *   PG_META_URL        default http://localhost:8081
 *   SERVICE_KEY        GoTrue service-role JWT
 *   JWT_SECRET         HS256 secret used to sign mock access tokens (default: fallback secret)
 *   PROJECT_REF        project ref slug (default: localproject)
 */

const express = require('express')
const crypto = require('crypto')
const { createProxyMiddleware } = require('http-proxy-middleware')

const PORT = process.env.PORT || 4000
const KONG_URL = process.env.KONG_URL || 'http://localhost:8000'
const GOTRUE_DIRECT_URL = process.env.GOTRUE_DIRECT_URL || ''
const PG_META_URL = process.env.PG_META_URL || 'http://localhost:8081'
const SERVICE_KEY = process.env.SERVICE_KEY || ''
const JWT_SECRET = process.env.JWT_SECRET || 'super-secret-jwt-token-with-at-least-32-characters-long'
const PROJECT_REF = process.env.PROJECT_REF || 'localproject'
const ORG_SLUG = 'local-org'
const ORG_ID = 1
const PROJECT_ID = 1

// ── JWT helpers ────────────────────────────────────────────────────────────
function b64url(str) {
  return Buffer.from(str).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function makeJwt(payload) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const body = b64url(JSON.stringify(payload))
  const sig = crypto.createHmac('sha256', JWT_SECRET).update(`${header}.${body}`).digest('base64')
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
  return `${header}.${body}.${sig}`
}

function mockSession() {
  const now = Math.floor(Date.now() / 1000)
  const exp = now + 3600
  const user = {
    id: '00000000-0000-0000-0000-000000000001',
    aud: 'authenticated',
    role: 'authenticated',
    email: 'admin@localhost',
    email_confirmed_at: '2024-01-01T00:00:00Z',
    confirmed_at: '2024-01-01T00:00:00Z',
    last_sign_in_at: new Date().toISOString(),
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2024-01-01T00:00:00Z',
    updated_at: new Date().toISOString(),
  }
  const access_token = makeJwt({
    aud: 'authenticated',
    exp,
    iat: now,
    iss: `http://148.113.1.164:4000/`,
    sub: user.id,
    email: user.email,
    phone: '',
    app_metadata: user.app_metadata,
    user_metadata: {},
    role: 'authenticated',
    aal: 'aal1',
    amr: [{ method: 'password', timestamp: now }],
    session_id: '00000000-0000-0000-0000-000000000002',
  })
  return {
    access_token,
    token_type: 'bearer',
    expires_in: 3600,
    expires_at: exp,
    refresh_token: 'mock-refresh-' + now,
    user,
  }
}

// ── Express setup ──────────────────────────────────────────────────────────
const app = express()
app.set('etag', false)  // prevent 304 Not Modified (causes undefined body in React Query)
app.use(express.json())
app.use(express.urlencoded({ extended: true }))

// ── CORS — permissive, credentials-compatible ─────────────────────────────
// Wildcards (*) are not allowed with credentials:include per CORS spec.
// Reflect the actual requested headers/methods instead.
app.use((req, res, next) => {
  const origin = req.headers.origin
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin)
    res.header('Access-Control-Allow-Credentials', 'true')
  } else {
    res.header('Access-Control-Allow-Origin', '*')
  }
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS,HEAD')
  // Reflect whatever headers the client is asking for
  const requestedHeaders = req.headers['access-control-request-headers']
  res.header(
    'Access-Control-Allow-Headers',
    requestedHeaders ||
      'Content-Type,Authorization,X-Client-Info,apikey,x-supabase-client,' +
      'x-connection-encrypted,x-pg-application-name,x-request-id,baggage,sentry-trace'
  )
  res.header('Access-Control-Expose-Headers', 'Content-Range,X-Content-Range,Authorization,X-Total-Count')
  res.header('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Origin store for proxy CORS injection (keyed by res object) ───────────
const _originStore = new Map()

// ── No-cache (prevents 304 / undefined body bugs in React Query) ───────────
app.use((req, res, next) => {
  res.header('Cache-Control', 'no-store, no-cache, must-revalidate')
  res.header('Pragma', 'no-cache')
  next()
})

// ── Request logger ─────────────────────────────────────────────────────────
const requestLog = []
const unhandledRoutes = {}

app.use((req, res, next) => {
  const start = Date.now()
  const qs = Object.keys(req.query).length ? ' ?' + new URLSearchParams(req.query).toString() : ''
  res.on('finish', () => {
    const ms = Date.now() - start
    const color = res.statusCode >= 400 ? '\x1b[31m' : res.statusCode >= 300 ? '\x1b[33m' : '\x1b[32m'
    console.log(`${color}${req.method} ${req.path}${qs} → ${res.statusCode}\x1b[0m (${ms}ms)`)
    if (requestLog.length < 1000) {
      requestLog.push({ method: req.method, path: req.path, qs: req.query, status: res.statusCode, ms })
    }
  })
  next()
})

// ══════════════════════════════════════════════════════════════════════════
// GOTRUE AUTH ENDPOINTS  (http://148.113.1.164:4000 = NEXT_PUBLIC_GOTRUE_URL)
// The GoTrue JS client calls these. We return valid signed JWTs so the
// client can parse them without errors.
// ══════════════════════════════════════════════════════════════════════════

// GoTrue settings / health
app.get('/', (req, res) => {
  res.json({
    version: '2.0.0',
    name: 'GoTrue Mock',
    description: 'Mock GoTrue server',
  })
})

app.get('/health', (req, res) => res.json({ status: 'ok' }))

// Sign in (password, refresh, PKCE)
app.post('/token', (req, res) => {
  const grant = req.query.grant_type || req.body?.grant_type
  console.log(`  [GOTRUE] /token grant_type=${grant}`)
  res.json(mockSession())
})

// Current user
app.get('/user', (req, res) => {
  res.json(mockSession().user)
})

// Update user
app.put('/user', (req, res) => res.json({ ...mockSession().user, ...req.body }))

// Sign out
app.post('/logout', (req, res) => res.sendStatus(204))

// MFA assurance level — critical for withAuth to unblock
app.get('/mfa/authenticator/assurance-level', (req, res) => {
  res.json({ currentLevel: 'aal1', nextLevel: 'aal1' })
})

// Factors list
app.get('/factors', (req, res) => res.json([]))

// Sign up (return same mock session so Studio doesn't fail)
app.post('/signup', (req, res) => res.json(mockSession()))

// OTP / magic link / recover — just acknowledge
app.post('/otp', (req, res) => res.json({ message_id: 'mock' }))
app.post('/recover', (req, res) => res.json({ message_id: 'mock' }))
app.post('/verify', (req, res) => res.json(mockSession()))

// OAuth authorize redirect — redirect to callback with mock code
app.get('/authorize', (req, res) => {
  const redirectTo = req.query.redirect_to || `http://148.113.1.164:3000/auth/callback`
  res.redirect(`${redirectTo}?code=mock-oauth-code&provider=mock`)
})

// Admin endpoints (service-role calls)
app.get('/admin/users', (req, res) => res.json({ users: [], aud: 'authenticated' }))
app.post('/admin/users', (req, res) => res.json({ ...mockSession().user, ...req.body }))
app.get('/admin/users/:id', (req, res) => res.json({ ...mockSession().user, id: req.params.id }))
app.put('/admin/users/:id', (req, res) => res.json({ ...mockSession().user, ...req.body }))
app.delete('/admin/users/:id', (req, res) => res.sendStatus(200))
app.get('/admin/factors', (req, res) => res.json([]))
app.delete('/admin/users/:uid/factors/:fid', (req, res) => res.sendStatus(200))

// GoTrue settings endpoint — captcha disabled so Studio skips HCaptcha execute()
app.get('/settings', (req, res) => {
  res.json({
    external: {
      email: true, phone: false, apple: false, azure: false,
      bitbucket: false, discord: false, facebook: false, figma: false,
      github: false, gitlab: false, google: false, keycloak: false,
      linkedin: false, notion: false, slack: false, spotify: false,
      twitch: false, twitter: false, workos: false, zoom: false,
    },
    disable_signup: false,
    autoconfirm: true,
    mailer_autoconfirm: true,
    phone_autoconfirm: true,
    sms_provider: '',
    mfa_enabled: false,
    saml_enabled: false,
    captcha: { enabled: false, provider: '' },
    security: { captcha: { enabled: false, provider: '' } },
  })
})

// Catch-all for other GoTrue paths — return empty/204
app.all(/^\/(token|user|mfa|factors|verify|otp|recover|signup|logout|authorize|callback|admin|settings)/, (req, res) => {
  console.warn(`\x1b[35m[GOTRUE UNHANDLED] ${req.method} ${req.path}\x1b[0m`)
  if (req.method === 'GET') return res.json({})
  res.sendStatus(204)
})

// ══════════════════════════════════════════════════════════════════════════
// PROXY: /platform/auth/{ref}/config  →  GoTrue /settings
// ══════════════════════════════════════════════════════════════════════════
const gotrueTarget = GOTRUE_DIRECT_URL || KONG_URL
const gotruePath = GOTRUE_DIRECT_URL ? '/settings' : '/auth/v1/settings'

app.use('/platform/auth/:ref/config', (req, res, next) => {
  if (req.headers.origin) _originStore.set(res, req.headers.origin)
  res.on('finish', () => _originStore.delete(res))
  next()
})
app.use(
  '/platform/auth/:ref/config',
  createProxyMiddleware({
    target: gotrueTarget,
    changeOrigin: true,
    pathRewrite: () => gotruePath,
    on: {
      proxyReq: (proxyReq, req) => {
        proxyReq.setHeader('Authorization', `Bearer ${SERVICE_KEY}`)
        if (!GOTRUE_DIRECT_URL) proxyReq.setHeader('apikey', SERVICE_KEY)
        // Re-buffer body consumed by express.json()
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyStr = JSON.stringify(req.body)
          proxyReq.setHeader('Content-Type', 'application/json')
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr))
          proxyReq.write(bodyStr)
        }
      },
      proxyRes: (proxyRes) => {
        delete proxyRes.headers['access-control-allow-origin']
        delete proxyRes.headers['access-control-allow-credentials']
        delete proxyRes.headers['access-control-allow-headers']
        delete proxyRes.headers['access-control-allow-methods']
        delete proxyRes.headers['access-control-expose-headers']
      },
      error: (err, req, res) => {
        console.error('Auth config proxy error:', err.message)
        res.status(502).json({ error: 'auth proxy failed', detail: err.message })
      },
    },
  })
)

// ══════════════════════════════════════════════════════════════════════════
// PROXY: /platform/pg-meta/{ref}/*  →  pg-meta
// express.json() consumes the body stream, so we must re-buffer it in proxyReq.
// ══════════════════════════════════════════════════════════════════════════
app.use('/platform/pg-meta/:ref', (req, res, next) => {
  if (req.headers.origin) _originStore.set(res, req.headers.origin)
  res.on('finish', () => _originStore.delete(res))
  next()
})
app.use(
  '/platform/pg-meta/:ref',
  createProxyMiddleware({
    target: PG_META_URL,
    changeOrigin: true,
    pathRewrite: (path) => path.replace(/^\/platform\/pg-meta\/[^/]+/, ''),
    on: {
      proxyReq: (proxyReq, req) => {
        // Strip x-connection-encrypted — pg-meta inside Docker cannot reach
        // external IPs. Let pg-meta use its own internal Postgres connection.
        proxyReq.removeHeader('x-connection-encrypted')
        proxyReq.removeHeader('authorization')
        // Re-buffer body that express.json() already consumed
        if (req.body && Object.keys(req.body).length > 0) {
          const bodyStr = JSON.stringify(req.body)
          proxyReq.setHeader('Content-Type', 'application/json')
          proxyReq.setHeader('Content-Length', Buffer.byteLength(bodyStr))
          proxyReq.write(bodyStr)
        }
      },
      proxyRes: (proxyRes) => {
        // pg-meta returns access-control-allow-origin: * — delete it so our
        // Express CORS middleware's reflected origin header takes precedence.
        delete proxyRes.headers['access-control-allow-origin']
        delete proxyRes.headers['access-control-allow-credentials']
      },
      error: (err, req, res) => {
        console.error('pg-meta proxy error:', err.message)
        res.status(502).json({ error: 'pg-meta proxy failed', detail: err.message })
      },
    },
  })
)

// ══════════════════════════════════════════════════════════════════════════
// PLATFORM ENDPOINTS
// ══════════════════════════════════════════════════════════════════════════

// Profile
app.get('/platform/profile', (req, res) => {
  res.json({
    auth0_id: 'mock|000000000000000000000001',
    disabled_features: [],
    first_name: 'Local',
    free_project_limit: 2,
    gotrue_id: '00000000-0000-0000-0000-000000000001',
    id: 1,
    is_alpha_user: false,
    is_sso_user: false,
    last_name: 'Admin',
    mobile: null,
    primary_email: 'admin@localhost',
    username: 'localadmin',
  })
})

app.put('/platform/profile', (req, res) => res.json({ ...req.body }))
app.patch('/platform/profile', (req, res) => res.json({ ...req.body }))
app.get('/platform/profile/access-tokens', (req, res) => res.json([]))
app.post('/platform/profile/access-tokens', (req, res) =>
  res.json({ id: 1, name: req.body?.name || 'token', token: 'sbp_mock_token', created_at: new Date().toISOString() })
)
app.delete('/platform/profile/access-tokens/:id', (req, res) => res.sendStatus(204))
app.get('/platform/profile/permissions', (req, res) => {
  // Return a single wildcard permission granting full access to all resources
  // on the local org. This satisfies all useAsyncCheckPermissions() checks.
  res.json([
    {
      actions: ['%'],
      resources: ['%'],
      organization_slug: ORG_SLUG,
      project_refs: [],
      restrictive: false,
      condition: null,
    },
  ])
})
app.get('/platform/profile/scoped-access-tokens', (req, res) => res.json([]))
app.get('/platform/profile/audit', (req, res) => res.json({ result: [], count: 0 }))

// Organizations
app.get('/platform/organizations', (req, res) => {
  res.json([{
    billing_email: 'admin@localhost',
    billing_partner: null,
    id: ORG_ID,
    integration_source: null,
    is_owner: true,
    name: 'Local Org',
    opt_in_tags: [],
    organization_missing_address: false,
    organization_missing_tax_id: false,
    organization_requires_mfa: false,
    plan: { id: 'free', name: 'Free' },
    restriction_data: null,
    restriction_status: null,
    slug: ORG_SLUG,
    stripe_customer_id: null,
    subscription_id: null,
    usage_billing_enabled: false,
  }])
})

app.get('/platform/organizations/:slug', (req, res) => {
  res.json({
    billing_email: 'admin@localhost', billing_partner: null, id: ORG_ID,
    integration_source: null, is_owner: true, name: 'Local Org', opt_in_tags: [],
    organization_missing_address: false, organization_missing_tax_id: false,
    organization_requires_mfa: false, plan: { id: 'free', name: 'Free' },
    restriction_data: null, restriction_status: null, slug: ORG_SLUG,
    stripe_customer_id: null, subscription_id: null, usage_billing_enabled: false,
  })
})

app.get('/platform/organizations/:slug/projects', (req, res) => {
  const limit = parseInt(req.query.limit) || 96
  const offset = parseInt(req.query.offset) || 0
  res.json({ pagination: { count: 1, limit, offset }, projects: [mockProject()] })
})
app.get('/platform/organizations/:slug/members', (req, res) =>
  res.json([{ gotrue_id: '00000000-0000-0000-0000-000000000001', username: 'localadmin', primary_email: 'admin@localhost', role_ids: [1] }])
)
app.get('/platform/organizations/:slug/roles', (req, res) =>
  res.json({ org_scoped_roles: [{ id: 1, name: 'Owner', description: null, base_role_id: 1, projects: [] }], project_scoped_roles: [] })
)
app.get('/platform/organizations/:slug/billing/subscription', (req, res) =>
  res.json({
    plan: { id: 'free', name: 'Free' },
    billing_via_partner: false,
    usage_billing_enabled: false,
    project_addons: [],       // DowngradeModal calls .flatMap() on this
    addons: [],
  })
)
app.get('/platform/organizations/:slug/billing/plans', (req, res) => res.json([{ id: 'free', name: 'Free' }]))
app.get('/platform/organizations/:slug/billing/credits/balance', (req, res) => res.json({ balance: 0 }))
app.get('/platform/organizations/:slug/entitlements', (req, res) => res.json({ entitlements: [] }))
app.get('/platform/organizations/:slug/usage', (req, res) => res.json({ usage_billing_enabled: false, usages: [] }))
app.get('/platform/organizations/:slug/usage/daily', (req, res) => res.json({ usages: [] }))
app.get('/platform/organizations/:slug/audit', (req, res) => res.json({ result: [], count: 0 }))
app.get('/platform/organizations/:slug/sso', (req, res) => res.json([]))
app.get('/platform/organizations/:slug/apps', (req, res) => res.json([]))
app.get('/platform/organizations/:slug/apps/installations', (req, res) => res.json([]))
app.get('/platform/organizations/:slug/oauth/apps', (req, res) => res.json([]))
app.get('/platform/organizations/:slug/members/mfa/enforcement', (req, res) => res.json({ required: false }))
app.get('/platform/organizations/:slug/members/invitations/:token', (req, res) => res.json({ token: req.params.token }))

// Projects — paginated (Version: 2 header)
app.get('/platform/projects', (req, res) => {
  const limit = parseInt(req.query.limit) || 96
  const offset = parseInt(req.query.offset) || 0
  res.json({ pagination: { count: 1, limit, offset }, projects: [mockProject()] })
})
app.get('/platform/projects/:ref', (req, res) => res.json(mockProject(req.params.ref)))
app.patch('/platform/projects/:ref', (req, res) => res.json(mockProject(req.params.ref)))

app.get('/platform/projects/:ref/settings', (req, res) => {
  res.json({
    jwt_secret: JWT_SECRET,
    anon_key: process.env.ANON_KEY || '',
    service_role_key: SERVICE_KEY || '',
  })
})

app.get('/platform/projects/:ref/api', (req, res) => {
  res.json({
    autoApiService: {
      endpoint: `http://148.113.1.164:8000`,
      defaultApiKey: process.env.ANON_KEY || '',
      serviceApiKey: SERVICE_KEY || '',
    },
  })
})

app.get('/platform/projects/:ref/api/rest', (req, res) => {
  res.json({ endpoint: `http://148.113.1.164:8000/rest/v1`, schema: 'public', extraSearchPath: ['public', 'extensions'], maxRows: 1000 })
})

app.get('/platform/projects/:ref/config/postgrest', (req, res) => {
  res.json({ db_schema: 'public', db_extra_search_path: 'public,extensions', max_rows: 1000, db_pool: 15, jwt_secret: JWT_SECRET })
})
app.patch('/platform/projects/:ref/config/postgrest', (req, res) => res.json(req.body))

app.get('/platform/projects/:ref/config/storage', (req, res) => {
  res.json({ fileSizeLimit: 52428800, features: { imageTransformation: { enabled: true } } })
})

// Billing addons — must have available_addons[] and selected_addons[]
app.get('/platform/projects/:ref/billing/addons', (req, res) => {
  res.json({ available_addons: [], selected_addons: [] })
})

app.get('/platform/projects/:ref/config/pgbouncer', (req, res) => {
  res.json({ pool_mode: 'transaction', default_pool_size: 15, ignore_startup_parameters: 'extra_float_digits' })
})
app.get('/platform/projects/:ref/config/pgbouncer/status', (req, res) => res.json({ active: true }))
app.get('/platform/projects/:ref/config/secrets/update-status', (req, res) => res.json({ updating: false }))

app.get('/platform/projects/:ref/members', (req, res) =>
  res.json({ members: [{ primary_email: 'admin@localhost', user_id: '00000000-0000-0000-0000-000000000001', username: 'localadmin' }] })
)

app.get('/platform/projects/:ref/analytics/endpoints/service-health', (req, res) => res.json({ services: [] }))
app.get('/platform/projects/:ref/daily-stats', (req, res) => res.json({ data: [] }))
app.get('/platform/projects/:ref/infra-monitoring', (req, res) => res.json({ data: [] }))
app.get('/platform/projects/:ref/notifications/advisor/exceptions', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/pause/status', (req, res) => res.json({ initiated_at: null, status: 'not_pausing' }))

app.get('/platform/projects/:ref/content', (req, res) => res.json({ data: [], cursor: null }))
app.get('/platform/projects/:ref/content/count', (req, res) => res.json({ count: 0 }))
app.get('/platform/projects/:ref/content/folders', (req, res) => res.json({ data: [] }))
app.get('/platform/projects/:ref/content/folders/:id', (req, res) => res.json({ id: req.params.id }))
app.get('/platform/projects/:ref/content/item/:id', (req, res) => res.status(404).json({ error: 'not found' }))
app.post('/platform/projects/:ref/content', (req, res) => res.json({ ...req.body, id: Date.now() }))

app.get('/platform/projects/:ref/databases', (req, res) => res.json([{
  cloud_provider: 'LOCAL', connectionString: `postgresql://postgres:postgres@148.113.1.164:5432/postgres`,
  connection_string_read_only: null, db_host: '148.113.1.164', db_name: 'postgres', db_port: 5432,
  identifier: req.params.ref, inserted_at: new Date().toISOString(), region: 'local',
  restUrl: `http://148.113.1.164:8000`, size: 'micro', status: 'ACTIVE_HEALTHY',
}]))

app.get('/platform/projects/:ref/restore/versions', (req, res) => res.json([]))
app.get('/platform/projects/:ref/privatelink/associations', (req, res) => res.json({ associations: [] }))

app.get('/platform/replication/:ref/sources', (req, res) => res.json([]))
app.get('/platform/replication/:ref/destinations', (req, res) => res.json([]))
app.get('/platform/replication/:ref/pipelines', (req, res) => res.json([]))

app.get('/platform/storage/:ref/analytics-buckets', (req, res) => res.json([]))
app.get('/platform/storage/:ref/buckets', (req, res) => res.json([]))
app.get('/platform/storage/:ref/credentials', (req, res) => res.json([]))
app.get('/platform/storage/:ref/vector-buckets', (req, res) => res.json([]))
app.get('/platform/storage/:ref/archive', (req, res) => res.json({}))

app.get('/platform/notifications', (req, res) => res.json([]))
app.get('/platform/notifications/summary', (req, res) => res.json({ unread: 0 }))
app.patch('/platform/notifications', (req, res) => res.sendStatus(204))

app.get('/platform/integrations', (req, res) => res.json([]))
// Per-org integrations list — must return array
app.get('/platform/integrations/:slug', (req, res) => res.json([]))
app.get('/platform/integrations/github/authorization', (req, res) => res.json({ app: null }))
app.get('/platform/integrations/github/connections', (req, res) => res.json([]))
app.get('/platform/integrations/github/repositories', (req, res) => res.json({ data: [] }))

app.get('/platform/stripe/invoices/overdue', (req, res) => res.json([]))
app.get('/platform/deployment-mode', (req, res) => res.json({ mode: 'self_hosted' }))
app.get('/platform/telemetry/feature-flags', (req, res) => res.json({ flags: {} }))
app.get('/platform/projects-resource-warnings', (req, res) => res.json([]))

app.post('/v1/projects/:ref/network-bans/retrieve', (req, res) => res.json({ banned_ipv4_addresses: [] }))
app.delete('/v1/projects/:ref/network-bans', (req, res) => res.sendStatus(204))
app.get('/v1/projects/:ref/network-restrictions', (req, res) => res.json({ entitlement: 'disallowed', config: { dbAllowedCidrs: [], dbAllowedCidrsReadReplicas: [] } }))
app.post('/v1/projects/:ref/network-restrictions/apply', (req, res) => res.json({ ...req.body }))
app.get('/v1/projects/:ref/branches', (req, res) => res.json([]))
app.get('/v1/projects/:ref/custom-hostname', (req, res) => res.json({ status: 'not_started', customHostname: null, data: {} }))
app.get('/v1/projects/:ref/upgrade/eligibility', (req, res) => res.json({ eligible: false, current_app_version: 'supabase-postgres-15.0.0.55' }))
app.get('/v1/projects/:ref/upgrade/status', (req, res) => res.json({ status: 'ready' }))

// Service health — must return array of { name, status } objects
app.get('/v1/projects/:ref/health', (req, res) => {
  const services = (req.query.services ? String(req.query.services).split(',') : ['auth','rest','realtime','storage','db'])
  res.json(services.map(name => ({ name, status: 'ACTIVE_HEALTHY', error: null })))
})

// Load balancers — must be array (used in DataApi, Settings/Infrastructure)
app.get('/platform/projects/:ref/load-balancers', (req, res) => res.json([]))

// Read replicas
app.get('/platform/projects/:ref/read-replicas', (req, res) => res.json([]))
app.get('/v1/projects/:ref/read-replicas', (req, res) => res.json([]))

// Disk
app.get('/platform/projects/:ref/disk', (req, res) => res.json({ size_gb: 8, type: 'gp3', iops: 3000, throughput_mbps: 125 }))
app.get('/platform/projects/:ref/disk/util', (req, res) => res.json({ usage_bytes: 0, total_bytes: 8589934592 }))

// Service versions
app.get('/platform/projects/:ref/service-versions', (req, res) => res.json({}))

// Edge functions service status
app.get('/v1/projects/:ref/functions/deployed-size', (req, res) => res.json({ deployed_size: 0 }))

// Realtime inspection
app.get('/platform/projects/:ref/live-queries', (req, res) => res.json([]))
app.get('/v1/projects/:ref/api-keys', (req, res) => res.json([
  { name: 'anon', type: 'anon', prefix: 'anon', key: process.env.ANON_KEY || '' },
  { name: 'service_role', type: 'service_role', prefix: 'service_role', key: process.env.SERVICE_KEY || '' },
]))
app.get('/v1/projects/:ref/secrets', (req, res) => res.json([]))
app.post('/v1/projects/:ref/secrets', (req, res) => res.sendStatus(201))
app.delete('/v1/projects/:ref/secrets', (req, res) => res.sendStatus(204))
app.get('/v1/projects/:ref/functions', (req, res) => res.json([]))
app.get('/v1/projects/:ref/config/auth/third-party-auth', (req, res) => res.json([]))
app.get('/v1/projects/:ref/config/auth/signing-keys', (req, res) => res.json([]))
// run-lints — returns array of lint objects directly
app.get('/platform/projects/:ref/run-lints', (req, res) => res.json([]))

// ── Missing endpoints added from full /platform/ scan ─────────────────────

// Auth management (SSR-only in Cloud — proxy to GoTrue via service key)
app.get('/platform/auth/:ref/users', (req, res) => res.json({ users: [], aud: 'authenticated' }))
app.post('/platform/auth/:ref/users', (req, res) => res.json({ id: 'mock-user-id', email: req.body?.email }))
app.put('/platform/auth/:ref/users/:id', (req, res) => res.json({ ...req.body }))
app.delete('/platform/auth/:ref/users/:id', (req, res) => res.sendStatus(200))
app.get('/platform/auth/:ref/users/:id/factors', (req, res) => res.json([]))
app.delete('/platform/auth/:ref/users/:id/factors', (req, res) => res.sendStatus(200))
app.post('/platform/auth/:ref/invite', (req, res) => res.json({ id: 'mock', email: req.body?.email }))
app.post('/platform/auth/:ref/magiclink', (req, res) => res.json({}))
app.post('/platform/auth/:ref/otp', (req, res) => res.json({}))
app.post('/platform/auth/:ref/recover', (req, res) => res.json({}))
app.get('/platform/auth/:ref/config/hooks', (req, res) => res.json({ hooks: [] }))
app.patch('/platform/auth/:ref/config/hooks', (req, res) => res.json(req.body))
app.post('/platform/auth/:ref/templates/:template/reset', (req, res) => res.sendStatus(200))
app.post('/platform/auth/:ref/validate/spam', (req, res) => res.json({ is_spam: false }))

// Project operations (mutations — just acknowledge)
app.post('/platform/projects/:ref/pause', (req, res) => res.json({ status: 'GOING_DOWN' }))
app.post('/platform/projects/:ref/restart', (req, res) => res.sendStatus(200))
app.post('/platform/projects/:ref/restart-services', (req, res) => res.sendStatus(200))
app.post('/platform/projects/:ref/restore', (req, res) => res.json({ status: 'RESTORING' }))
app.post('/platform/projects/:ref/resize', (req, res) => res.sendStatus(200))
app.post('/platform/projects/:ref/transfer', (req, res) => res.json({}))
app.get('/platform/projects/:ref/transfer/preview', (req, res) => res.json({}))
app.patch('/platform/projects/:ref/db-password', (req, res) => res.sendStatus(200))
app.get('/platform/projects/:ref/config/realtime', (req, res) => res.json({ max_concurrent_users: 200 }))
app.patch('/platform/projects/:ref/config/realtime', (req, res) => res.json(req.body))
app.get('/platform/projects/:ref/config/secrets', (req, res) => res.json([]))
app.patch('/platform/projects/:ref/config/secrets', (req, res) => res.json(req.body))
app.get('/platform/projects/:ref/disk/custom-config', (req, res) => res.json({}))
app.post('/platform/projects/:ref/disk/custom-config', (req, res) => res.json(req.body))
app.post('/platform/projects/:ref/disk', (req, res) => res.json({ size_gb: 8 }))
app.get('/platform/projects/:ref/resources/:id', (req, res) => res.json({ id: req.params.id }))
app.patch('/platform/projects/:ref/resources/:id', (req, res) => res.json(req.body))
app.patch('/platform/projects/:ref/settings/sensitivity', (req, res) => res.json(req.body))
app.get('/platform/projects/:ref/api-keys/temporary', (req, res) => res.json({ anon_key: process.env.ANON_KEY || '', service_role_key: SERVICE_KEY || '' }))
app.get('/platform/projects/:ref/analytics/endpoints/auth.metrics', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/functions.combined-stats', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/functions.req-stats', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/functions.resource-usage', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/logs.all', (req, res) => res.json({ result: [], count: 0 }))
app.get('/platform/projects/:ref/analytics/endpoints/logs.all.otel', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/usage.api-counts', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/endpoints/usage.api-requests-count', (req, res) => res.json({ result: [] }))
app.get('/platform/projects/:ref/analytics/log-drains', (req, res) => res.json([]))
app.post('/platform/projects/:ref/analytics/log-drains', (req, res) => res.json({ token: 'mock', ...req.body }))
app.put('/platform/projects/:ref/analytics/log-drains/:token', (req, res) => res.json(req.body))
app.delete('/platform/projects/:ref/analytics/log-drains/:token', (req, res) => res.sendStatus(204))
app.post('/platform/projects/:ref/privatelink/associations/aws-account', (req, res) => res.json({}))
app.get('/platform/projects/:ref/privatelink/associations/aws-account/:id', (req, res) => res.json({}))

// Database backups
app.get('/platform/database/:ref/backups', (req, res) => res.json({ backups: [], tierId: 'free', tierKey: 'FREE' }))
app.get('/platform/database/:ref/backups/downloadable-backups', (req, res) => res.json({ backups: [] }))
app.post('/platform/database/:ref/backups/download', (req, res) => res.json({ url: null }))
app.post('/platform/database/:ref/backups/restore', (req, res) => res.json({ status: 'restoring' }))
app.post('/platform/database/:ref/backups/restore-physical', (req, res) => res.json({ status: 'restoring' }))
app.post('/platform/database/:ref/backups/pitr', (req, res) => res.json({ status: 'restoring' }))
app.post('/platform/database/:ref/backups/enable-physical-backups', (req, res) => res.sendStatus(200))
app.post('/platform/database/:ref/clone', (req, res) => res.json({ status: 'cloning' }))
app.post('/platform/database/:ref/hook-enable', (req, res) => res.sendStatus(200))

// Org member/billing mutations
app.get('/platform/organizations/:slug/members/reached-free-project-limit', (req, res) => res.json({ reached_free_project_limit: false }))
app.get('/platform/organizations/:slug/members/invitations', (req, res) => res.json([]))
app.post('/platform/organizations/:slug/members/invitations', (req, res) => res.json({ id: 1 }))
app.delete('/platform/organizations/:slug/members/invitations/:id', (req, res) => res.sendStatus(204))
app.patch('/platform/organizations/:slug/members/:gotrue_id', (req, res) => res.json(req.body))
app.delete('/platform/organizations/:slug/members/:gotrue_id', (req, res) => res.sendStatus(204))
app.post('/platform/organizations/:slug/members/:gotrue_id/roles/:role_id', (req, res) => res.sendStatus(200))
app.delete('/platform/organizations/:slug/members/:gotrue_id/roles/:role_id', (req, res) => res.sendStatus(204))
// Invoices — array directly; HEAD returns X-Total-Count for pagination
app.head('/platform/organizations/:slug/billing/invoices', (req, res) => {
  res.setHeader('X-Total-Count', '0')
  res.sendStatus(200)
})
app.get('/platform/organizations/:slug/billing/invoices', (req, res) => res.json([]))
app.post('/platform/organizations/:slug/billing/subscription/confirm', (req, res) => res.json({}))
app.post('/platform/organizations/:slug/billing/upgrade-request', (req, res) => res.sendStatus(200))
app.post('/platform/organizations/:slug/payments/setup-intent', (req, res) => res.json({ client_secret: null }))
app.get('/platform/organizations/:slug/available-versions', (req, res) => res.json([]))
app.post('/platform/organizations/cloud-marketplace', (req, res) => res.json({}))
app.post('/platform/organizations/confirm-subscription', (req, res) => res.json({}))
app.get('/platform/organizations/:slug/apps/:app_id', (req, res) => res.json({}))
app.patch('/platform/organizations/:slug/apps/:app_id', (req, res) => res.json(req.body))
app.delete('/platform/organizations/:slug/apps/:app_id', (req, res) => res.sendStatus(204))
app.post('/platform/organizations/:slug/apps/:app_id/signing-keys', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/organizations/:slug/apps/:app_id/signing-keys/:key_id', (req, res) => res.sendStatus(204))
app.post('/platform/organizations/:slug/apps/installations', (req, res) => res.json({}))
app.delete('/platform/organizations/:slug/apps/installations/:id', (req, res) => res.sendStatus(204))
app.get('/platform/organizations/:slug/oauth/apps/:id', (req, res) => res.json({}))
app.post('/platform/organizations/:slug/oauth/apps', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/organizations/:slug/oauth/apps/:id', (req, res) => res.sendStatus(204))
app.post('/platform/organizations/:slug/oauth/apps/:id/revoke', (req, res) => res.sendStatus(200))
app.get('/platform/organizations/:slug/oauth/authorizations/:id', (req, res) => res.json({}))
app.post('/platform/organizations/:slug/oauth/apps/:id/client-secrets', (req, res) => res.json({ secret: 'mock' }))
app.delete('/platform/organizations/:slug/oauth/apps/:id/client-secrets/:sid', (req, res) => res.sendStatus(204))
app.get('/platform/oauth/authorizations/:id', (req, res) => res.json({}))
app.patch('/platform/organizations/:slug/members/mfa/enforcement', (req, res) => res.json(req.body))
app.post('/platform/organizations/:slug/members/invitations/:token', (req, res) => res.json({}))

// Feedback (fire-and-forget)
app.post('/platform/feedback/send', (req, res) => res.sendStatus(200))
app.post('/platform/feedback/upgrade', (req, res) => res.sendStatus(200))
app.post('/platform/feedback/downgrade', (req, res) => res.sendStatus(200))
app.patch('/platform/feedback/conversations/:id/custom-fields', (req, res) => res.json({}))

// Account management
app.post('/platform/signup', (req, res) => res.json({}))
app.post('/platform/reset-password', (req, res) => res.json({}))
app.post('/platform/update-email', (req, res) => res.json({}))
app.post('/platform/profile/audit-login', (req, res) => res.sendStatus(200))

// Stripe
app.post('/platform/stripe/setup-intent', (req, res) => res.json({ client_secret: null }))

// Storage object operations
app.post('/platform/storage/:ref/buckets/:id/empty', (req, res) => res.json({}))
app.post('/platform/storage/:ref/buckets/:id/objects/list', (req, res) => res.json([]))
app.post('/platform/storage/:ref/buckets/:id/objects/sign', (req, res) => res.json({ signedURL: null }))
app.post('/platform/storage/:ref/buckets/:id/objects/sign-multi', (req, res) => res.json([]))
app.post('/platform/storage/:ref/buckets/:id/objects/public-url', (req, res) => res.json({ publicURL: null }))
app.post('/platform/storage/:ref/buckets/:id/objects/move', (req, res) => res.json({}))
app.delete('/platform/storage/:ref/buckets/:id/objects', (req, res) => res.sendStatus(204))
app.post('/platform/storage/:ref/credentials', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/storage/:ref/credentials/:id', (req, res) => res.sendStatus(204))
app.post('/platform/storage/:ref/vector-buckets', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/storage/:ref/vector-buckets/:id', (req, res) => res.sendStatus(204))
app.post('/platform/storage/:ref/vector-buckets/:id/indexes', (req, res) => res.json({}))
app.delete('/platform/storage/:ref/vector-buckets/:id/indexes/:name', (req, res) => res.sendStatus(204))
app.post('/platform/storage/:ref/analytics-buckets', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/storage/:ref/analytics-buckets/:id', (req, res) => res.sendStatus(204))
app.get('/platform/storage/:ref/analytics-buckets/:id/namespaces', (req, res) => res.json([]))
app.post('/platform/storage/:ref/analytics-buckets/:id/namespaces', (req, res) => res.json({}))

// Additional replication sub-paths
app.get('/platform/replication/:ref/sources/:source_id/tables', (req, res) => res.json([]))
app.get('/platform/replication/:ref/sources/:source_id/publications', (req, res) => res.json([]))
app.post('/platform/replication/:ref/sources/:source_id/publications', (req, res) => res.json({}))
app.delete('/platform/replication/:ref/sources/:source_id/publications/:name', (req, res) => res.sendStatus(204))
app.post('/platform/replication/:ref/destinations-pipelines', (req, res) => res.json({}))
app.delete('/platform/replication/:ref/destinations-pipelines/:did/:pid', (req, res) => res.sendStatus(204))
app.post('/platform/replication/:ref/destinations/validate', (req, res) => res.json({ valid: true }))
app.post('/platform/replication/:ref/destinations', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/replication/:ref/destinations/:id', (req, res) => res.sendStatus(204))
app.patch('/platform/replication/:ref/destinations/:id', (req, res) => res.json(req.body))
app.post('/platform/replication/:ref/pipelines', (req, res) => res.json({ id: 'mock' }))
app.delete('/platform/replication/:ref/pipelines/:id', (req, res) => res.sendStatus(204))
app.post('/platform/replication/:ref/pipelines/:id/start', (req, res) => res.sendStatus(200))
app.post('/platform/replication/:ref/pipelines/:id/stop', (req, res) => res.sendStatus(200))
app.get('/platform/replication/:ref/pipelines/:id/status', (req, res) => res.json({ status: 'stopped' }))
app.get('/platform/replication/:ref/pipelines/:id/version', (req, res) => res.json({ version: '1.0.0' }))
app.get('/platform/replication/:ref/pipelines/:id/replication-status', (req, res) => res.json({}))
app.post('/platform/replication/:ref/pipelines/:id/rollback-tables', (req, res) => res.json({}))
app.post('/platform/replication/:ref/pipelines/validate', (req, res) => res.json({ valid: true }))
app.get('/platform/replication/:ref/tenants', (req, res) => res.json([]))
app.post('/platform/replication/:ref/tenants-sources', (req, res) => res.json({}))
app.delete('/platform/replication/:ref/tenants', (req, res) => res.sendStatus(204))

// Notification mutations
app.patch('/platform/notifications/archive-all', (req, res) => res.sendStatus(204))

// Catch-all for unhandled platform routes
app.all('/platform/*', (req, res) => {
  const key = `${req.method} ${req.path}`
  unhandledRoutes[key] = (unhandledRoutes[key] || 0) + 1
  console.warn(`\x1b[33m[UNHANDLED×${unhandledRoutes[key]}] ${req.method} ${req.path}\x1b[0m`)
  if (req.method === 'GET') return res.json({})
  res.sendStatus(204)
})

// Catch-all for unhandled v1 routes
app.all('/v1/*', (req, res) => {
  const key = `${req.method} ${req.path}`
  unhandledRoutes[key] = (unhandledRoutes[key] || 0) + 1
  console.warn(`\x1b[33m[UNHANDLED-V1×${unhandledRoutes[key]}] ${req.method} ${req.path}\x1b[0m`)
  if (req.method === 'GET') return res.json({})
  res.sendStatus(204)
})

// ── Fake hCaptcha API script ───────────────────────────────────────────────
// Stores the callback registered in render(), calls it immediately on execute().
app.get('/1/api.js', (req, res) => {
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8')
  res.send(`
(function() {
  var _callbacks = {};
  var _widgetId = 0;
  window.hcaptcha = {
    render: function(el, opts) {
      var id = ++_widgetId;
      _callbacks[id] = { callback: opts && opts.callback, expiredCallback: opts && opts['expired-callback'] };
      console.log('[mock-hcaptcha] render', id, typeof _callbacks[id].callback);
      return id;
    },
    execute: function(id, opts) {
      var token = 'mock-captcha-token-' + Date.now();
      console.log('[mock-hcaptcha] execute', id, 'calling callback');
      // Call the onVerify callback the React component registered
      setTimeout(function() {
        if (_callbacks[id] && typeof _callbacks[id].callback === 'function') {
          _callbacks[id].callback(token);
        }
      }, 10);
      if (opts && opts.async) {
        return Promise.resolve({ response: token, key: 'mock' });
      }
    },
    reset: function(id) {},
    remove: function(id) { delete _callbacks[id]; },
    getResponse: function(id) { return 'mock-captcha-token'; }
  };
  if (typeof window.hCaptchaOnLoad === 'function') {
    window.hCaptchaOnLoad();
  }
  console.log('[mock-hcaptcha] loaded - auto-passing enabled');
})();
  `)
})

// ── Debug endpoints ────────────────────────────────────────────────────────
app.get('/debug/unhandled', (req, res) => {
  const sorted = Object.entries(unhandledRoutes).sort((a, b) => b[1] - a[1]).map(([route, count]) => ({ route, count }))
  res.json({ total: sorted.length, routes: sorted })
})

app.get('/debug/log', (req, res) => res.json({ total: requestLog.length, requests: requestLog }))

app.get('/debug/summary', (req, res) => {
  const counts = {}
  for (const r of requestLog) {
    const n = r.path.replace(/\/[a-f0-9-]{20,}\b/g, '/{id}')
    const key = `${r.method} ${n}`
    counts[key] = (counts[key] || 0) + 1
  }
  const sorted = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([route, count]) => ({ route, count }))
  res.json({ total: sorted.length, routes: sorted })
})

// ── Helpers ────────────────────────────────────────────────────────────────
function mockProject(ref = PROJECT_REF) {
  return {
    cloud_provider: 'LOCAL',
    connectionString: `postgresql://postgres:postgres@148.113.1.164:5432/postgres`,
    db_host: '148.113.1.164',
    dbVersion: '150009',
    high_availability: false,
    id: PROJECT_ID,
    infra_compute_size: 'nano',
    inserted_at: '2024-01-01T00:00:00.000Z',
    integration_source: null,
    is_branch_enabled: false,
    is_physical_backups_enabled: false,
    name: 'Local Project',
    organization_id: ORG_ID,
    parent_project_ref: null,
    ref,
    region: 'local',
    restUrl: `http://148.113.1.164:8000/rest/v1`,
    status: 'ACTIVE_HEALTHY',
    subscription_id: 'sub_mock',
    updated_at: new Date().toISOString(),
    volumeSizeGb: 8,
    // Required by org-projects-infinite-query / projects-infinite-query
    databases: [{
      cloud_provider: 'LOCAL',
      identifier: ref,
      infra_compute_size: 'nano',
      inserted_at: '2024-01-01T00:00:00.000Z',
      region: 'local',
      status: 'ACTIVE_HEALTHY',
      type: 'PRIMARY',
    }],
  }
}

app.listen(PORT, () => {
  console.log(`\x1b[36mStudio mock API listening on :${PORT}\x1b[0m`)
  console.log(`  Project ref : ${PROJECT_REF}`)
  console.log(`  JWT secret  : ${JWT_SECRET.slice(0, 10)}...`)
  console.log(`  GoTrue URL  : ${gotrueTarget}`)
})
