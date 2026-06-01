import { decryptJson, loadMasterKey } from '@supastack/crypto';
import { db, schema } from '@supastack/db';
import {
  composeAllHealthy,
  composeUp,
  writeInstanceStack,
  type ComposeContext,
} from '@supastack/docker-control';
import { logger } from '@supastack/shared';
import { Queue } from 'bullmq';
import { eq } from 'drizzle-orm';
import { Redis } from 'ioredis';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import pg from 'pg';
import { fetch } from 'undici';
import { QUEUES } from '../queues.js';
import { probeAuthWithStoredPassword } from '../services/pg-password-probe.js';
import { applyProvisionDefaults } from '../services/pg-provision-defaults.js';
import { handleVaultEnable } from './vault-enable-job.js';

const TEMPLATE_DIR = process.env.SUPABASE_TEMPLATE_DIR ?? '/app/infra/supabase-template';
const INSTANCES_DIR = process.env.INSTANCES_DIR ?? '/var/supastack/instances';
const STUDIO_IMAGE = process.env.STUDIO_IMAGE ?? 'supastack/studio:latest';
const API_URL = process.env.SUPASTACK_API_URL ?? 'http://api:3001';
const HEALTH_TIMEOUT_MS = 180_000; // 3 min

/**
 * Provision a new managed Supabase instance.
 *
 * Pipeline (matches plan.md §"Provisioning Flow"):
 *   1. Read row, decrypt secrets
 *   2. Read apex domain from org row (needed for URL fields in .env)
 *   3. Render .env via packages/docker-control compose-template — completeness
 *      assertion + char-safety + docker compose config -q round-trip
 *   4. docker compose -p supastack-<ref> up -d
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
      const { decryptJson: dj } = await import('@supastack/crypto');
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
        // portDbDirect may be null for instances created before feature 005.
        // Default to portPostgres in that case so docker compose doesn't reject
        // (the per-instance supavisor is gone, so portPostgres is unused; we
        // can safely reuse it for db's host port mapping on legacy instances).
        dbDirect: row.portDbDirect ?? row.portPostgres,
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
    const ctx: ComposeContext = { projectName: `supastack-${ref}`, dir: outDir };
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

    // 6b. Prevention probe (feature 008 US3 FR-014): actively verify the
    //     per-instance Postgres accepts the stored password BEFORE marking
    //     the instance running. POSTGRES_PASSWORD is only honored on first
    //     init — a leftover data dir from a prior failed provision would
    //     silently ship a project no one can connect to. Catch it here.
    const probe = await probeAuthWithStoredPassword(ref);
    if (!probe.ok && probe.isAuthClass) {
      const msg =
        'pg_password_drift_at_provision — per-instance Postgres rejected the stored password after ' +
        `${probe.attempts} attempts. Likely a leftover data dir bootstrapped with a different password. ` +
        `Recover via POST /api/v1/instances/${ref}/reset-pg-password then retry provision.`;
      log.error({ probe }, 'provision auth probe failed (auth-class)');
      throw new Error(msg);
    }
    if (!probe.ok) {
      throw new Error(
        `provision auth probe failed (non-auth) after ${probe.attempts} attempts: ${probe.lastError ?? '?'}`,
      );
    }
    log.info({ attempts: probe.attempts }, 'auth probe ok — stored password matches');

    // 6c. Feature 010 — enable supabase_vault before marking running (FR-001
    //     + FR-005). Synchronous because dashboard saves require vault from
    //     the very first request. If this fails, the instance must NOT
    //     reach 'running'.
    log.info('enabling supabase_vault');
    await handleVaultEnable({ ref, source: 'provision' });
    log.info('vault enabled');

    // 6d. Feature 016 — set statement_timeout = 8s database-wide so execute_sql
    //     and db query are protected from runaway queries from first use.
    const pgDefaults = new pg.Client({
      host: 'host.docker.internal',
      port: row.portDbDirect ?? row.portPostgres,
      user: 'supabase_admin',
      password: secrets.postgresPassword,
      database: 'postgres',
      ssl: false,
      connectionTimeoutMillis: 5000,
    });
    await pgDefaults.connect();
    try {
      await applyProvisionDefaults(pgDefaults);
    } finally {
      await pgDefaults.end().catch(() => {});
    }
    log.info('provision defaults applied');

    // 7. Mark running
    await db()
      .update(schema.supabaseInstances)
      .set({ status: 'running', provisionError: null, updatedAt: new Date() })
      .where(eq(schema.supabaseInstances.ref, ref));
    log.info('instance running');

    // 7b. Register this project as a tenant in the top-level supavisor (feature
    //     005 Phase 5). Best-effort — non-fatal so a supavisor outage doesn't
    //     prevent provisioning. The api's daily reconciler will catch any drift.
    try {
      await registerPoolerTenant(ref);
      log.info({ ref }, 'pooler tenant registered');
    } catch (err) {
      log.warn({ err: (err as Error).message }, 'pooler tenant registration failed; non-fatal');
    }

    // 8. Enqueue per-project ACME cert issuance for db.<ref>.<apex> (feature 005
    //    Option B). Non-blocking: instance is already 'running' and reachable
    //    via the wildcard cert; the per-project cert lands within ~30s and lets
    //    strict-TLS clients (rustls, sqlx, supabase db diff) connect cleanly.
    if (apex) {
      try {
        await enqueuePgEdgeCertIssue(ref);
        log.info({ ref }, 'pg-edge cert issuance enqueued');
      } catch (err) {
        log.warn(
          { err: (err as Error).message },
          'failed to enqueue pg-edge cert issuance; non-fatal',
        );
      }
    }
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

async function registerPoolerTenant(ref: string): Promise<void> {
  const res = await fetch(`${API_URL}/internal/pooler/tenants`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ ref }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`pooler register ${res.status}: ${text.slice(0, 200)}`);
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

let _pgEdgeQueue: Queue | null = null;
async function enqueuePgEdgeCertIssue(ref: string): Promise<void> {
  const url = process.env.REDIS_URL;
  if (!url) throw new Error('REDIS_URL not set');
  if (!_pgEdgeQueue) {
    _pgEdgeQueue = new Queue(QUEUES.pgEdgeCertIssue, {
      connection: new Redis(url, { maxRetriesPerRequest: null }),
    });
  }
  await _pgEdgeQueue.add(
    'issue',
    { ref },
    {
      attempts: 3,
      backoff: { type: 'exponential', delay: 5000 },
      removeOnComplete: 50,
      removeOnFail: 50,
    },
  );
}

// Touch fs import so the lint passes even if path manipulation gets simpler later.
void fs;
