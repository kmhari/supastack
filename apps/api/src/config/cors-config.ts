import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * Feature 107 — scoped CORS for the control-plane API served at `api.<apex>`
 * (and the dual-served apex). The dashboard (`https://<apex>`) calls the API
 * cross-origin; this is the single auditable allow-list. Never `*` — the API is
 * credentialed (the Studio fetcher uses `credentials: 'include'`, so the browser
 * BLOCKS the response unless `Access-Control-Allow-Credentials: true` is set AND the
 * origin is EXACT — never `*`). Our auth is still the Bearer `Authorization` header;
 * the `sb-access-token` cookie rides along but is ignored for API auth.
 */

/**
 * The KNOWN request headers the dashboard/Studio + supabase-js/CLI send (HAR-observed
 * custom `x-*` + standard supabase-js/postgrest). **Documentation/audit only** — the
 * runtime CORS reflects whatever the browser requests (see corsOptions), because an
 * explicit list silently breaks when the Studio adds a header (it sends `version`).
 */
export const ALLOWED_REQUEST_HEADERS = [
  'authorization',
  'content-type',
  'accept',
  'accept-profile',
  'content-profile',
  'prefer',
  'range',
  'cache-control',
  'pragma',
  'apikey',
  'x-client-info',
  'x-upsert',
  'x-connection-encrypted',
  'x-pg-application-name',
  'x-request-id',
] as const;

export const ALLOWED_METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'] as const;

/**
 * Exact browser origins allowed to call the credentialed API. The dashboard apex
 * only; local dev origins are added ONLY in non-production.
 */
export function allowedOrigins(): string[] {
  const apex = process.env.SUPASTACK_APEX;
  const origins: string[] = [];
  if (apex) origins.push(`https://${apex}`);
  if (process.env.NODE_ENV !== 'production') {
    origins.push('http://localhost:5173', 'http://localhost:3000');
  }
  return origins;
}

/**
 * `@fastify/cors` options. The `origin` callback echoes the request origin ONLY
 * when it is in the allow-list (never `*`); a foreign or absent origin gets no
 * `Access-Control-Allow-Origin` header.
 */
export function corsOptions(): FastifyCorsOptions {
  const allowed = new Set(allowedOrigins());
  return {
    origin: (origin, cb) => {
      // No Origin (same-origin browser / CLI / server-to-server) → no CORS header needed.
      if (!origin) return cb(null, false);
      // Allowed → reflect the exact origin; foreign → false (no grant).
      cb(null, allowed.has(origin));
    },
    methods: [...ALLOWED_METHODS],
    // Reflect the browser's requested headers (Access-Control-Request-Headers) — do
    // NOT pin an explicit list. The ORIGIN is the security boundary (scoped above);
    // reflecting headers for an already-allowed origin is safe AND robust. An explicit
    // allow-list silently breaks the moment the Studio sends a header we didn't list
    // (it sends `version`, and more across Studio versions). `@fastify/cors` reflects
    // when `allowedHeaders` is omitted. (ALLOWED_REQUEST_HEADERS below stays as the
    // documented "known" set for audit, but runtime allows whatever is requested.)
    // The Studio fetcher sets `credentials: 'include'` (data/fetchers.ts:36), so the
    // browser blocks the response unless Allow-Credentials is true AND the origin is
    // exact (it is — never `*`). Our auth is Bearer; the cookie rides along, ignored.
    credentials: true,
    maxAge: 600,
  };
}
