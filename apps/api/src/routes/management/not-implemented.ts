/**
 * Catch-all under `/v1/*` that emits the structured "not implemented for
 * this deployment" error (FR-024). Register this LAST in the mgmt group so
 * real routes match first; anything unmatched falls through to here.
 *
 * The error envelope is the cloud-shape `{ message, code, details }`,
 * formatted by `mgmt-api-errors.ts`.
 */
import type { FastifyPluginAsync } from 'fastify';
import { ManagementApiError } from '../../plugins/mgmt-api-errors.js';

export const notImplementedRoutes: FastifyPluginAsync = async (app) => {
  app.all('/*', async (req) => {
    throw new ManagementApiError(
      501,
      `This management endpoint is not implemented in selfbase. ` +
        `See https://supaviser.dev/docs/cli-compat for the supported subset.`,
      'not_implemented',
      { path: req.url.split('?')[0], method: req.method, upstream_only: true },
    );
  });
};
