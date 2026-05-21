import { promises as fs } from 'node:fs';
import path from 'node:path';
import { eq } from 'drizzle-orm';
import { fetch } from 'undici';
import { db, schema } from '@selfbase/db';
import { decryptJson, loadMasterKey } from '@selfbase/crypto';
import { logger } from '@selfbase/shared';
import {
  composeUp,
  composeAllHealthy,
  writeInstanceStack,
  type ComposeContext,
} from '@selfbase/docker-control';

const TEMPLATE_DIR = process.env.SUPABASE_TEMPLATE_DIR ?? '/app/infra/supabase-template';
const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/selfbase/instances';
const STUDIO_IMAGE = process.env.STUDIO_IMAGE ?? 'selfbase/studio:latest';
const API_URL = process.env.SELFBASE_API_URL ?? 'http://api:3001';
const HEALTH_TIMEOUT_MS = 180_000; // 3 min

/**
 * Provision a new managed Supabase instance.
 *
 * Pipeline (matches plan.md §"Provisioning Flow"):
 *   1. Read row, decrypt secrets
 *   2. Read apex domain from org row (needed for URL fields in .env)
 *   3. Render .env via packages/docker-control compose-template — completeness
 *      assertion + char-safety + docker compose config -q round-trip
 *   4. docker compose -p selfbase-<ref> up -d
 *   5. Poll docker compose ps until all containers healthy or HEALTH_TIMEOUT_MS
 *   6. Trigger Caddy reload via API internal endpoint
 *   7. Set status=running
 *
 * On any error: set status=failed, populate provision_error, leave the
 * directory for inspection (per FR-034). NO partial cleanup.
 */
export async function handleProvision(payload: { ref: string }): Promise<void> {
  const ref = payload.ref;
  const log = logger.child({ job: 'provision', ref });

  let row: typeof schema.supabaseInstances.$inferSelect | undefined;
  try {
    [row] = await db()
      .select()
      .from(schema.supabaseInstances)
      .where(eq(schema.supabaseInstances.ref, ref))
      .limit(1);
    if (!row) throw new Error(`instance ${ref} not found`);
    if (row.status !== 'provisioning') {
      log.warn({ status: row.status }, 'instance is not in provisioning state — skipping');
      return;
    }

    // 1. Read apex domain
    const [orgRow] = await db()
      .select({ apex: schema.org.apexDomain, name: schema.org.name })
      .from(schema.org)
      .limit(1);
    const apex = orgRow?.apex;
    if (!apex) {
      throw new Error('apex_domain not configured on org — set it via PATCH /org first');
    }

    // 2. Decrypt secrets
    const secrets = decryptJson<{
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
    }>(row.encryptedSecrets, loadMasterKey());

    // SMTP password decrypt (if configured)
    let smtpPassword: string | undefined;
    if (row.createSmtpPassEncrypted) {
      const { decryptJson: dj } = await import('@selfbase/crypto');
      smtpPassword = dj<{ password: string }>(
        row.createSmtpPassEncrypted,
        loadMasterKey(),
      ).password;
    }

    const outDir = path.join(INSTANCES_DIR, ref);
    log.info({ outDir }, 'rendering compose stack');

    // 3. Render + validate compose stack
    await writeInstanceStack({
      ref,
      name: row.name,
      apex,
      ports: {
        kong: row.portKong,
        studio: row.portStudio,
        postgres: row.portPostgres,
        pooler: row.portPooler,
        analytics: row.portAnalytics,
      },
      secrets,
      config: {
        enableSignup: row.createEnableSignup,
        jwtExpirySec: row.createJwtExpirySec,
      },
      smtp:
        row.createSmtpHost && row.createSmtpPort && row.createSmtpUser && smtpPassword
          ? {
              host: row.createSmtpHost,
              port: row.createSmtpPort,
              user: row.createSmtpUser,
              password: smtpPassword,
            }
          : undefined,
      studioImage: STUDIO_IMAGE,
      templateDir: TEMPLATE_DIR,
      outDir,
    });

    // 4. Compose up
    const ctx: ComposeContext = { projectName: `selfbase-${ref}`, dir: outDir };
    log.info({ projectName: ctx.projectName }, 'docker compose up -d');
    await composeUp(ctx);

    // 5. Wait for health
    log.info('waiting for instance to become healthy');
    const start = Date.now();
    let healthy = false;
    while (Date.now() - start < HEALTH_TIMEOUT_MS) {
      if (await composeAllHealthy(ctx)) {
        healthy = true;
        break;
      }
      await new Promise((r) => setTimeout(r, 3_000));
    }
    if (!healthy) {
      throw new Error(
        `instance did not become healthy within ${HEALTH_TIMEOUT_MS / 1000}s — see docker compose ps + logs in ${outDir}`,
      );
    }
    log.info({ elapsedSec: Math.round((Date.now() - start) / 1000) }, 'all containers healthy');

    // 6. Reload Caddy so the new <ref>.<apex> route is live
    await triggerCaddyReload();

    // 7. Mark running
    await db()
      .update(schema.supabaseInstances)
      .set({ status: 'running', provisionError: null, updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));
    log.info('instance running');
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log.error({ err }, 'provision failed');
    if (row) {
      await db()
        .update(schema.supabaseInstances)
        .set({ status: 'failed', provisionError: message, updatedAt: new Date() })
        .where(eq(schema.supabaseInstances.ref, ref));
    }
    // Re-throw so BullMQ marks the job failed (operator sees it in the queue).
    throw err;
  }
}

async function triggerCaddyReload(): Promise<void> {
  try {
    const res = await fetch(`${API_URL}/internal/caddy/reload`, { method: 'POST' });
    if (!res.ok) {
      logger.warn({ status: res.status }, 'caddy reload returned non-2xx (instance still running)');
    }
  } catch (err) {
    logger.warn(
      { err: (err as Error).message },
      'caddy reload request failed (instance still running)',
    );
  }
}

// Touch fs import so the lint passes even if path manipulation gets simpler later.
void fs;
