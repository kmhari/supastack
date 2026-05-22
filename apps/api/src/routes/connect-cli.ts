/**
 * Dashboard helpers for the Connect-CLI page.
 *
 * Spec: contracts/management-api.yaml (out-of-band — internal dashboard
 * surface), spec.md FR-002.
 *
 *   GET  /api/v1/cli/profile.toml  — text/plain TOML snippet pre-filled
 *                                    with this deployment's apex
 *   POST /api/v1/cli/mint-token    — one-click "create a CLI token" flow
 *
 * Both endpoints are auth-gated by the global authPlugin (bearer OR
 * session cookie). Lives on the dashboard `/api/v1` prefix, NOT the
 * `/v1` management surface — the dashboard envelope `{error: {...}}`
 * applies here, not the cloud envelope.
 */
import type { FastifyPluginAsync } from 'fastify';
import { db, schema } from '@selfbase/db';
import { eq } from 'drizzle-orm';
import { errors } from '@selfbase/shared';
import { mintApiToken } from '../services/api-tokens.js';

interface MintBody {
  label?: string;
}

export const connectCliRoutes: FastifyPluginAsync = async (app) => {
  // ─── GET /cli/profile.toml ────────────────────────────────────────────
  app.get('/cli/profile.toml', async (req, reply) => {
    app.requireAuth(req);
    const rows = await db()
      .select({ apex: schema.org.apexDomain })
      .from(schema.org)
      .limit(1);
    const apex = rows[0]?.apex;
    if (!apex) {
      throw errors.invalidInput(
        'This deployment has no apex domain configured. Complete setup before connecting the CLI.',
      );
    }
    const toml = [
      'name          = "selfbase"',
      `api_url       = "https://api.${apex}"`,
      `dashboard_url = "https://${apex}/dashboard"`,
      `project_host  = "${apex}"`,
      '',
    ].join('\n');
    reply
      .header('content-type', 'text/plain; charset=utf-8')
      .header('content-disposition', 'attachment; filename="selfbase.toml"')
      .send(toml);
  });

  // ─── POST /cli/mint-token ─────────────────────────────────────────────
  app.post('/cli/mint-token', async (req, reply) => {
    const user = app.requireAuth(req);
    const body = (req.body ?? {}) as MintBody;
    const label = (body.label?.trim() || `cli-${new Date().toISOString().slice(0, 10)}`).slice(0, 80);
    const { raw, id, prefix } = await mintApiToken(db(), user.id, label);
    reply.status(201).send({ token: raw, label, prefix, id });
  });
};
