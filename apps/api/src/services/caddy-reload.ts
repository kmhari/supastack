import { fetch } from 'undici';
import { logger } from '@selfbase/shared';
import { buildCaddyConfig } from './caddy-config.js';

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? 'http://caddy:2019';

/**
 * Atomically reload Caddy's full config. Idempotent — calling twice with no
 * underlying change is a no-op from the dashboard's perspective.
 */
export async function reloadCaddy(): Promise<void> {
  const config = await buildCaddyConfig();
  const res = await fetch(`${CADDY_ADMIN_URL}/load`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      // Caddy 2.7+ admin requires Origin header that matches the configured
      // `origins` list (in apps/caddy/Caddyfile and caddy-config.ts admin block).
      origin: CADDY_ADMIN_URL,
    },
    body: JSON.stringify(config),
  });
  if (!res.ok) {
    const body = await res.text();
    logger.error({ status: res.status, body }, 'caddy /load failed');
    throw new Error(`caddy reload failed (${res.status}): ${body.slice(0, 300)}`);
  }
  logger.info('caddy reloaded');
}
