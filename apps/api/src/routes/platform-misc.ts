/**
 * Miscellaneous platform endpoints that Supabase Studio IS_PLATFORM=true
 * expects but aren't covered by other route files.
 */
import type { FastifyPluginAsync } from 'fastify';

export const platformMiscRoutes: FastifyPluginAsync = async (app) => {
  // Studio fetches this on load to determine which features to show.
  // Registered without prefix so it matches /platform/telemetry/feature-flags directly.
  app.get('/platform/telemetry/feature-flags', async (_req, reply) => {
    return reply.send({ flags: {} });
  });
};
