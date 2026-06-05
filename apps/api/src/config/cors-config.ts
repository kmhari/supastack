import type { FastifyCorsOptions } from '@fastify/cors';

/**
 * Feature 107 — scoped CORS for the control-plane API served at `api.<apex>`
 * (and the dual-served apex). The dashboard (`https://<apex>`) calls the API
 * cross-origin; this is the single auditable allow-list. Never `*` — the API is
 * credentialed-capable (Bearer JWT). `credentials: false`: dashboard→API auth is
 * a Bearer `Authorization` header, not a cookie (the only cookie, `sb-access-token`,
 * is read solely by the `/v1/oauth/authorize` navigation, anchored at the apex).
 */

/**
 * Request headers the dashboard/Studio + supabase-js/CLI send that aren't CORS-safe
 * by default. Reviewed when the vendored Studio is upgraded (FR-005). The custom
 * `x-*` set is HAR-observed; the rest are standard supabase-js / postgrest headers.
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
    allowedHeaders: [...ALLOWED_REQUEST_HEADERS],
    credentials: false,
    maxAge: 600,
  };
}
