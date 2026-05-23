import { fetch } from 'undici';
import { logger } from '@selfbase/shared';

const CADDY_ADMIN_URL = process.env.CADDY_ADMIN_URL ?? 'http://caddy:2019';
const API_URL = process.env.SELFBASE_API_URL ?? 'http://api:3001';

/**
 * Debounced caddy reload. Multiple instance-state changes within DEBOUNCE_MS
 * coalesce into one reload. The job runs from the BullMQ scheduler tick OR
 * is enqueued directly by the API after a state change.
 *
 * Implementation: the worker calls the API's internal reload endpoint, which
 * builds the JSON config from the DB and POSTs it to Caddy admin /load. We
 * keep the config-building logic in the API (not the worker) so both share
 * one source of truth.
 */
let lastReloadAt = 0;
const DEBOUNCE_MS = 200;

export async function handleCaddyReload(): Promise<void> {
  const now = Date.now();
  if (now - lastReloadAt < DEBOUNCE_MS) {
    logger.debug('caddy reload debounced');
    return;
  }
  lastReloadAt = now;

  // The API exposes an internal endpoint that builds + posts the config.
  // (lives at apps/api/src/services/caddy-reload.ts and is called from a
  // tiny internal route in Phase 3 wiring. For now we call Caddy directly.)
  // We probe Caddy admin first so an empty DB / cold start doesn't fail.
  try {
    // Caddy 2.7+ admin origin check — include Origin matching the configured list.
    const probe = await fetch(`${CADDY_ADMIN_URL}/config/`, {
      headers: { origin: CADDY_ADMIN_URL },
    });
    if (!probe.ok && probe.status !== 404) {
      throw new Error(`caddy admin not reachable (${probe.status})`);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'caddy not reachable; skipping reload');
    return;
  }

  // In Phase 3 the API will be the writer; for now the worker triggers the
  // build via the API to keep the source-of-truth in one place. The route
  // lands in Phase 3.
  try {
    const res = await fetch(`${API_URL}/internal/caddy/reload`, { method: 'POST' });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'api internal reload returned non-2xx');
    }
  } catch (err) {
    logger.debug({ err: (err as Error).message }, 'api internal reload not yet wired');
  }
}
